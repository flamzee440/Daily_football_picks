import type { Config } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";

const db = getDatabase();
const COOKIE = "dfp_session";
const defaults: Record<string,string> = {
  master: `# DAILY FOOTBALL PICKS — API-FOOTBALL DATA ANALYSIS

You are the football analysis and prediction stage of this application. The application supplies real fixtures, bookmaker market prices and (when available) API-Football prediction summaries. Analyse ONLY the supplied data.

## Analysis rules
- Use only fixtures and odds included in the supplied API-FOOTBALL DATA. Never invent a fixture, team, kickoff, market, bookmaker, price, injury, lineup, statistic, form record or source.
- Consider the supplied API-Football prediction summary, team comparison, recent head-to-head summary and available market prices. Treat provider predictions as evidence to assess, not as guaranteed truth.
- Compare the available markets and identify selections with a defensible risk/reward profile. Prefer stable markets and avoid speculative markets when evidence is thin.
- Do not claim to know recent form, injuries, suspensions, lineups, weather or referee information unless those facts are explicitly present in the supplied data. List important missing information as a limitation.
- A market selection and its decimal odds MUST be copied exactly from one supplied odds record. Include its fixture_id, bookmaker, market_name, selection and decimal_odds without alteration.
- Do not estimate or fabricate bookmaker prices. Do not create a candidate if the supplied odds record is missing.
- Never describe a bet as certain, fixed, safe or guaranteed. If the evidence is weak, return no candidates.

## Combined odds objective
The application seeks a small combination with total decimal odds between 2.00 and 2.30. Do not force a weak selection to reach the target. The application independently applies its risk filters and assembles the final slip.

## Required JSON output
Return JSON only:
{
  "date": "{{NIGERIA_DATE}}",
  "research_summary": "Briefly describe the supplied fixtures, market coverage and main findings.",
  "candidates": [
    {
      "fixture_id": 123,
      "match": "Home Team vs Away Team",
      "competition": "Competition",
      "kickoff_nigeria_time": "ISO 8601 kickoff",
      "bookmaker": "Exact bookmaker name from supplied data",
      "market_name": "Exact market name from supplied data",
      "selection": "Exact selection value from supplied data",
      "market": "Exact market name",
      "prediction": "Exact selection value",
      "decimal_odds": 1.50,
      "estimated_probability": 0.70,
      "supporting_evidence": ["Evidence grounded in supplied data"],
      "potential_risks": ["Relevant risks and missing information"]
    }
  ],
  "research_limitations": ["Data not supplied or unavailable"]
}
Return an empty candidates array if there is no well-supported selection. Do not output Markdown fences.`
};

function json(data: unknown, status=200, headers: Record<string,string>={}) {
  return Response.json(data, { status, headers });
}
function secret(name:string) {
  const value=Netlify.env.get(name);
  if(!value) throw new Error(`Missing Netlify environment variable: ${name}`);
  return value;
}
async function tokenFor(user:{id:number,email:string}) {
  const key=new TextEncoder().encode(secret("SESSION_SECRET"));
  return new SignJWT({email:user.email}).setProtectedHeader({alg:"HS256"}).setSubject(String(user.id)).setIssuedAt().setExpirationTime("7d").sign(key);
}
async function currentUser(req:Request) {
  const raw=req.headers.get("cookie")?.split(";").map(x=>x.trim()).find(x=>x.startsWith(COOKIE+"="))?.slice(COOKIE.length+1);
  if(!raw) return null;
  try {
    const {payload}=await jwtVerify(decodeURIComponent(raw),new TextEncoder().encode(secret("SESSION_SECRET")));
    return {id:Number(payload.sub),email:String(payload.email)};
  } catch { return null; }
}
function sessionCookie(token:string) {
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`;
}
function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
async function body(req:Request) { return await req.json().catch(()=>({})); }
async function kiloChatCompletion(messages:any[], stage:string) {
  const response=await fetch("https://ai-gateway.kilo.ai/api/v1/chat/completions",{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({
      model:"kilo-auto/free",
      messages,
      temperature:0.2,
      max_tokens:12000
    })
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok) {
    const detail=data?.error?.message || data?.message || `Kilo request failed (${response.status})`;
    throw new Error(`Kilo ${stage} stage: ${detail}`);
  }
  const text=data?.choices?.[0]?.message?.content;
  if(typeof text!=="string" || !text.trim()) throw new Error("Kilo returned an empty response.");
  return text;
}
function parseModelJson(text:string, stage:string) {
  const cleaned=text.replace(/^```json\s*/i,"").replace(/\s*```$/,"").trim();
  const first=cleaned.indexOf("{");
  const last=cleaned.lastIndexOf("}");
  if(first<0||last<=first) throw new Error(`Kilo ${stage} stage returned no valid JSON object.`);
  try { return JSON.parse(cleaned.slice(first,last+1)); }
  catch { throw new Error(`Kilo ${stage} stage returned invalid JSON. Please run the workflow again.`); }
}
async function runKiloResearch(prompt:string, input:string) {
  const instructions=prompt+"\n\nIMPORTANT OUTPUT RULE: Return only one valid JSON object matching the requested schema. Do not wrap it in Markdown fences. You are not browsing the web. The user message contains structured API-Football data. Only select exact fixture, bookmaker, market, selection and decimal_odds combinations present in that data. Never invent or adjust odds, fixtures, statistics, team news, injuries or source URLs. If evidence is insufficient, omit the candidate.";
  const text=await kiloChatCompletion([{role:"system",content:instructions},{role:"user",content:"INPUT DATA:\n"+input}],"research");
  return parseModelJson(text,"research");
}
async function runKiloDecision(input:string) {
  const instructions=`You are the independent final risk reviewer for a football-picks workflow. Evaluate EVERY candidate in the supplied input. Do not conduct new fixture research and do not assume missing facts are true. Score evidence quality and conservative accumulator suitability. Reject stale or unverified odds, weak evidence, unclear fixtures, major lineup uncertainty, volatile markets, and unsupported probability claims. Do not select based on odds alone. Return one result for each candidate, preserving its zero-based index. Use conservative estimates. A score of 3 or 4 requires strong current evidence. Safety probability means your estimated probability that the selection itself wins, not a guarantee. Confidence measures how well the evidence supports your assessment.
Return valid JSON only in this shape: { "reviews": [ { "index": 0, "score": 0, "confidence": 0.0, "safety_probability": 0.0, "safety_confidence": 0.0, "reason": "short explanation" } ] }
Score must be 0 to 4. All probability/confidence values must be between 0 and 1. Include every candidate exactly once.`;
  const text=await kiloChatCompletion([{role:"system",content:instructions},{role:"user",content:"CANDIDATES TO REVIEW:\n"+input}],"decision");
  const parsed=parseModelJson(text,"decision");
  if(!Array.isArray(parsed?.reviews)) throw new Error("Kilo decision stage returned no candidate reviews.");
  return parsed.reviews as any[];
}
function nigeriaToday() {
  const parts=new Intl.DateTimeFormat("en-GB", {timeZone:"Africa/Lagos",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const part=(type:string)=>parts.find(x=>x.type===type)?.value||"";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function buildSlip(candidates:any[], answers:any[], date:string): Record<string,any> {
  const scored=candidates.map((candidate,index)=>{
    const review=answers.find((item:any)=>Number(item?.index)===index);
    const score=Number(review?.score ?? -1);
    const scoreConfidence=Number(review?.confidence ?? 0);
    const safeProbability=Number(review?.safety_probability ?? 0);
    const safeConfidence=Number(review?.safety_confidence ?? 0);
    const odds=Number(candidate.decimal_odds ?? candidate.odds);
    return {candidate,index,score,scoreConfidence,safeProbability,safeConfidence,odds,review};
  }).filter(x=>Number.isFinite(x.odds)&&x.odds>1&&x.score>=3.0&&x.scoreConfidence>=0.55&&x.safeProbability>=0.75&&x.safeConfidence>=0.60)
    .sort((a,b)=>b.score-a.score || b.safeProbability-a.safeProbability);
  const pool=scored.slice(0,24);
  let best:any[]|null=null;
  let bestQuality=-Infinity;
  const walk=(start:number,chosen:any[],product:number)=>{
    if(chosen.length && product>=2.00 && product<=2.30) {
      const avg=chosen.reduce((sum,x)=>sum+x.score*x.scoreConfidence*x.safeProbability,0)/chosen.length;
      const riskPenalty=chosen.reduce((sum,x)=>sum+(1-x.safeProbability),0);
      const quality=avg-riskPenalty*0.15-(chosen.length-1)*0.015;
      if(quality>bestQuality){bestQuality=quality;best=[...chosen];}
      return;
    }
    if(chosen.length>=4||product>2.30) return;
    for(let i=start;i<pool.length;i++) walk(i+1,[...chosen,pool[i]],product*pool[i].odds);
  };
  walk(0,[],1);
  if(!best) return {
    date,title:"Daily Football Picks",selections:[],combined_odds:null,
    confidence_note:"No combination met the strict evidence and risk thresholds while reaching the 2.00–2.30 target. No bet is recommended.",
    research_notes:["The system did not force weak selections to reach the odds target."],
    recommendation:"NO BET",
    decision_summary:{candidates_received:candidates.length,candidates_accepted:scored.length,model:"kilo-auto/free"}
  };
  const selections=best.map(x=>({
    match:x.candidate.match,
    competition:x.candidate.competition||"Football",
    kickoff:x.candidate.kickoff_nigeria_time||x.candidate.kickoff||"",
    market:x.candidate.market,
    prediction:x.candidate.prediction||x.candidate.market,
    odds:x.odds,
    reason:[...(x.candidate.supporting_evidence||[]).slice(0,2),x.review?.reason].filter(Boolean).join(" "),
    sources:x.candidate.sources||[],
    decision_score:Number(x.score.toFixed(2)),
    decision_confidence:Number(x.scoreConfidence.toFixed(3)),
    safety_probability:Number(x.safeProbability.toFixed(3))
  }));
  const combined=best.reduce((p,x)=>p*x.odds,1);
  return {
    date,title:"Daily Football Picks",selections,combined_odds:Number(combined.toFixed(2)),
    confidence_note:"Selections passed the configured evidence and risk filters. No betting outcome is guaranteed; confirm odds and lineups before placing any bet.",
    research_notes:["Fixture and bookmaker odds data supplied by API-Football.","API-Football prediction enrichment supplied where available.","Kilo analysed only supplied provider data; unsupported selections were rejected by the application.","Independent candidate scoring: one Kilo API request.","Final slip assembly and combined-odds calculation: application code."],
    recommendation:"BET WITH CAUTION",
    decision_summary:{candidates_received:candidates.length,candidates_accepted:scored.length,selected:selections.length,model:"kilo-auto/free"}
  };
}


type ApiFootballEnvelope = { response?: any[]; errors?: any; results?: number; paging?: { total?: number } };
async function apiFootballRequest(path:string) {
  const key=Netlify.env.get("API_FOOTBALL_KEY");
  if(!key) throw new Error("API_FOOTBALL_KEY is missing from Netlify environment variables.");
  const response=await fetch("https://v3.football.api-sports.io/"+path,{
    headers:{"x-apisports-key":key,"accept":"application/json"}
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error("API-Football request failed ("+response.status+"). Check the API key and daily quota.");
  if(data?.errors && Object.keys(data.errors).length) {
    const detail=Object.values(data.errors).map(String).join("; ");
    throw new Error("API-Football: "+detail);
  }
  return {data:data as ApiFootballEnvelope,remaining:response.headers.get("x-ratelimit-requests-remaining")};
}
function fixtureSummary(item:any) {
  return {
    fixture_id:Number(item?.fixture?.id),
    match:String(item?.teams?.home?.name||"")+" vs "+String(item?.teams?.away?.name||""),
    competition:String(item?.league?.name||"Football"),
    country:String(item?.league?.country||""),
    kickoff_nigeria_time:String(item?.fixture?.date||""),
    kickoff_timestamp:Number(item?.fixture?.timestamp||0),
    status:String(item?.fixture?.status?.short||""),
    venue:String(item?.fixture?.venue?.name||"")
  };
}
async function loadApiFootballData(date:string) {
  const fixturesResult=await apiFootballRequest("fixtures?date="+encodeURIComponent(date)+"&timezone=Africa%2FLagos");
  const now=Math.floor(Date.now()/1000);
  const fixtures=(fixturesResult.data.response||[]).map(fixtureSummary)
    .filter(f=>f.fixture_id && f.kickoff_timestamp>now && ["NS","TBD"].includes(f.status))
    .slice(0,100);
  if(!fixtures.length) return {fixtures:[],oddsRecords:[],predictionData:[],apiRequests:1,remaining:fixturesResult.remaining};
  const fixtureById=new Map(fixtures.map(f=>[f.fixture_id,f]));
  const firstOdds=await apiFootballRequest("odds?date="+encodeURIComponent(date)+"&page=1");
  const oddsPages=[...(firstOdds.data.response||[])];
  const totalPages=Math.min(Number(firstOdds.data.paging?.total||1),3);
  const otherPages=await Promise.all(Array.from({length:Math.max(0,totalPages-1)},(_,i)=>apiFootballRequest("odds?date="+encodeURIComponent(date)+"&page="+(i+2))));
  for(const page of otherPages) oddsPages.push(...(page.data.response||[]));
  const oddsRecords:any[]=[];
  for(const event of oddsPages) {
    const fixtureId=Number(event?.fixture?.id);
    const fixture=fixtureById.get(fixtureId);
    if(!fixture) continue;
    for(const bookmaker of (event?.bookmakers||[]).slice(0,5)) {
      for(const market of (bookmaker?.bets||[]).slice(0,16)) {
        for(const value of (market?.values||[]).slice(0,20)) {
          const odd=Number(value?.odd);
          if(!Number.isFinite(odd)||odd<=1) continue;
          oddsRecords.push({
            fixture_id:fixtureId,
            match:fixture.match,
            competition:fixture.competition,
            kickoff_nigeria_time:fixture.kickoff_nigeria_time,
            bookmaker:String(bookmaker?.name||""),
            market_name:String(market?.name||""),
            selection:String(value?.value||""),
            decimal_odds:odd
          });
        }
      }
    }
  }
  // Predictions enrich a small, representative set of matches without exhausting the daily API quota.
  const predictionFixtureIds=[...new Set(oddsRecords.map(x=>x.fixture_id))].slice(0,5);
  const predictionResults=await Promise.all(predictionFixtureIds.map(async id=>{
    try {
      const result=await apiFootballRequest("predictions?fixture="+id);
      const row=result.data.response?.[0];
      if(!row) return null;
      return {fixture_id:id,predictions:row.predictions||{},teams:row.teams||{},comparison:row.comparison||{},h2h:(row.h2h||[]).slice(0,5),league:row.league||{}};
    } catch(error) {
      console.warn("[daily-football-picks] Prediction enrichment unavailable for fixture",id,error);
      return null;
    }
  }));
  const remainingValues=[fixturesResult.remaining,firstOdds.remaining,...otherPages.map(x=>x.remaining)].filter(x=>x!==null);
  return {
    fixtures,
    oddsRecords:oddsRecords.slice(0,700),
    predictionData:predictionResults.filter(Boolean),
    apiRequests:2+otherPages.length+predictionFixtureIds.length,
    remaining:remainingValues.length?remainingValues[remainingValues.length-1]:null
  };
}
function validateApiCandidates(candidates:any[],data:any) {
  const allowed=data.oddsRecords as any[];
  const verified:any[]=[];
  for(const candidate of candidates.slice(0,40)) {
    const fixtureId=Number(candidate?.fixture_id);
    const odds=Number(candidate?.decimal_odds);
    const match=allowed.find(record =>
      record.fixture_id===fixtureId &&
      record.bookmaker===String(candidate?.bookmaker||"") &&
      record.market_name===String(candidate?.market_name||candidate?.market||"") &&
      record.selection===String(candidate?.selection||candidate?.prediction||"") &&
      Math.abs(record.decimal_odds-odds)<0.0001
    );
    if(!match) continue;
    verified.push({
      ...match,
      market:match.market_name,
      prediction:match.selection,
      estimated_probability:Number(candidate?.estimated_probability)||0,
      supporting_evidence:Array.isArray(candidate?.supporting_evidence)?candidate.supporting_evidence.slice(0,4):[],
      potential_risks:Array.isArray(candidate?.potential_risks)?candidate.potential_risks.slice(0,4):[],
      sources:[{title:"API-Football fixture and bookmaker odds data",url:"https://www.api-football.com/"}]
    });
  }
  return verified;
}

function adminAllowed(req:Request) {
  const expected=Netlify.env.get("ADMIN_KEY");
  return !!expected && req.headers.get("x-admin-key")===expected;
}
function today() { return new Date().toISOString().slice(0,10); }

export default async (req:Request) => {
  const url=new URL(req.url);
  const path=url.pathname.replace(/^\/api\/?/,"").replace(/\/$/,"");
  try {
    if(path==="health" && req.method==="GET") return json({ok:true,service:"daily-football-picks"});
    if(path==="signup" && req.method==="POST") {
      const {email,password}=await body(req);
      const normalized=String(email||"").trim().toLowerCase();
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)||String(password||"").length<10) return json({error:"Enter a valid email and a password of at least 10 characters."},400);
      const hash=await bcrypt.hash(String(password),12);
      const rows=await db.sql<{id:number,email:string}>`INSERT INTO users(email,password_hash) VALUES (${normalized},${hash}) RETURNING id,email`;
      const token=await tokenFor(rows[0]);
      return json({user:rows[0]},201,{"set-cookie":sessionCookie(token)});
    }
    if(path==="login" && req.method==="POST") {
      const {email,password}=await body(req);
      const normalized=String(email||"").trim().toLowerCase();
      const rows=await db.sql<{id:number,email:string,password_hash:string}>`SELECT id,email,password_hash FROM users WHERE email=${normalized} LIMIT 1`;
      if(!rows[0]||!await bcrypt.compare(String(password||""),rows[0].password_hash)) return json({error:"Email or password is incorrect."},401);
      const token=await tokenFor(rows[0]);
      return json({user:{id:rows[0].id,email:rows[0].email}},200,{"set-cookie":sessionCookie(token)});
    }
    if(path==="logout" && req.method==="POST") return json({ok:true},200,{"set-cookie":clearCookie()});
    if(path==="me" && req.method==="GET") {
      const user=await currentUser(req);
      return user?json({user}):json({user:null},401);
    }
    if(path==="picks" && req.method==="GET") {
      const rows=await db.sql<{payload:any,pick_date:string}>`SELECT payload,pick_date FROM daily_picks WHERE status='published' ORDER BY pick_date DESC LIMIT 1`;
      return json({pick:rows[0]?.payload||null});
    }
    if(path.startsWith("admin/")) {
      if(!adminAllowed(req)) return json({error:"Admin key required."},401);
      if(path==="admin/test-ai" && req.method==="POST") {
        const {question}=await body(req);
        const prompt=String(question||"").trim();
        if(!prompt||prompt.length>4000) return json({error:"Enter a test question of up to 4,000 characters."},400);
        const answer=await kiloChatCompletion([{role:"user",content:prompt}],"connection test");
        return json({ok:true,answer,model:"kilo-auto/free"});
      }
      if(path==="admin/prompts" && req.method==="GET") {
        const rows=await db.sql<{prompt_key:string,prompt_text:string,updated_at:string}>`SELECT prompt_key,prompt_text,updated_at FROM prompts`;
        const prompts={...defaults};
        for(const row of rows) prompts[row.prompt_key]=row.prompt_text;
        if(!prompts.master) prompts.master=defaults.master;
        return json({prompts:{master:prompts.master}});
      }
      if(path==="admin/prompts" && req.method==="POST") {
        const {prompts}=await body(req);
        const value=String(prompts?.master||"").trim();
        if(!value||value.length>30000) return json({error:"The master prompt is empty or too long."},400);
        await db.sql`INSERT INTO prompts(prompt_key,prompt_text,updated_at) VALUES (${"master"},${value},NOW()) ON CONFLICT(prompt_key) DO UPDATE SET prompt_text=EXCLUDED.prompt_text,updated_at=NOW()`;
        return json({ok:true});
      }
      if(path==="admin/run" && req.method==="POST") {
        const rows=await db.sql<{prompt_key:string,prompt_text:string}>`SELECT prompt_key,prompt_text FROM prompts WHERE prompt_key='master' LIMIT 1`;
        const master=rows[0]?.prompt_text || defaults.master;
        const date=nigeriaToday();
        console.info("[daily-football-picks] Fetching fixtures and available odds from API-Football");
        const footballData=await loadApiFootballData(date);
        if(!footballData.fixtures.length || !footballData.oddsRecords.length) {
          const noBet={date,title:"Daily Football Picks",selections:[],combined_odds:null,confidence_note:"API-Football did not return upcoming fixtures with available bookmaker odds for today. No bet is recommended; no fixture or price was invented.",recommendation:"NO BET",research_notes:["Data source: API-Football.","Fixtures returned: "+footballData.fixtures.length,"Verified odds records: "+footballData.oddsRecords.length]};
          await db.sql`INSERT INTO daily_picks(pick_date,payload,status) VALUES (${date},${JSON.stringify(noBet)}::jsonb,'published') ON CONFLICT(pick_date) DO UPDATE SET payload=EXCLUDED.payload,status='published',created_at=NOW()`;
          return json({ok:true,pick:noBet,model_requests:0,api_football_requests:footballData.apiRequests,api_football_remaining:footballData.remaining,request_breakdown:{api_football:footballData.apiRequests,kilo_research:0,kilo_decision:0}});
        }
        const researchInput={
          date,
          source:"API-Football",
          source_note:"Only supplied fixtures and bookmaker odds are eligible. Prediction enrichment is present only for listed fixture IDs.",
          fixtures:footballData.fixtures,
          bookmaker_odds:footballData.oddsRecords,
          api_football_predictions:footballData.predictionData
        };
        console.info("[daily-football-picks] Sending verified API-Football data to Kilo", {fixtures:footballData.fixtures.length,odds:footballData.oddsRecords.length});
        const research=await runKiloResearch(master.replaceAll("{{NIGERIA_DATE}}",date),`Nigerian date: ${date}. Analyse only this API-Football data. Return candidates only when the exact fixture_id, bookmaker, market_name, selection and decimal_odds exist in bookmaker_odds. Never make up missing team information or odds.\n\nAPI-FOOTBALL DATA:\n${JSON.stringify(researchInput)}`);
        const proposed=Array.isArray(research?.candidates)?research.candidates:[];
        const candidates=validateApiCandidates(proposed,footballData);
        if(!candidates.length) {
          const noBet={date,title:"Daily Football Picks",selections:[],combined_odds:null,confidence_note:"No credible candidate selections were returned by the research stage. No bet is recommended.",recommendation:"NO BET",research_notes:research?.research_limitations||[]};
          await db.sql`INSERT INTO daily_picks(pick_date,payload,status) VALUES (${date},${JSON.stringify(noBet)}::jsonb,'published') ON CONFLICT(pick_date) DO UPDATE SET payload=EXCLUDED.payload,status='published',created_at=NOW()`;
          return json({ok:true,pick:noBet,model_requests:1,api_football_requests:footballData.apiRequests,api_football_remaining:footballData.remaining,request_breakdown:{api_football:footballData.apiRequests,kilo_research:1,kilo_decision:0}});
        }
        console.info("[daily-football-picks] Kilo decision request started", {candidate_count:candidates.length});
        const answers=await runKiloDecision(JSON.stringify({date,research_summary:research.research_summary,candidates}));
        const final=buildSlip(candidates,answers,date);
        final.research_summary=research.research_summary||"";
        final.research_limitations=research.research_limitations||[];
        await db.sql`INSERT INTO daily_picks(pick_date,payload,status) VALUES (${date},${JSON.stringify(final)}::jsonb,'published') ON CONFLICT(pick_date) DO UPDATE SET payload=EXCLUDED.payload,status='published',created_at=NOW()`;
        console.info("[daily-football-picks] Kilo workflow completed: 2 model requests maximum");
        return json({ok:true,pick:final,model_requests:2,api_football_requests:footballData.apiRequests,api_football_remaining:footballData.remaining,request_breakdown:{api_football:footballData.apiRequests,kilo_research:1,kilo_decision:1}});
      }
    }
    return json({error:"Not found."},404);
  } catch(error) {
    console.error(error);
    return json({error:error instanceof Error?error.message:"Unexpected server error."},500);
  }
};
export const config:Config={path:"/api/*"};