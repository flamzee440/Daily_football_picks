import type { Config } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";

const db = getDatabase();
const COOKIE = "dfp_session";
const defaults: Record<string,string> = {
  master: `# DAILY FOOTBALL PICKS — DECISION GUIDANCE

API-Football is the exclusive source of fixtures, match information, bookmaker markets and decimal odds. Gemini Decision 1 evaluates only the supplied provider data.

Prioritize evidence quality, consistency between provider prediction summaries and team comparisons, market stability, and missing information. Do not assume injuries, lineups, form, weather or other facts absent from the supplied data. Never invent fixtures, prices, statistics or sources. Do not treat bookmaker odds as proof that a selection will win. Reject unsupported or highly volatile selections. The application independently verifies provider records and assembles the final slip. Never force a selection merely to reach the combined-odds target.`
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
async function geminiDecisionRequest(input:string,questions:Record<string,any>,stage:string) {
  const key=secret("GEMINI_API_KEY");
  const response=await fetch("https://generativelanguage.googleapis.com/v1beta/decisions",{
    method:"POST",headers:{"content-type":"application/json","x-goog-api-key":key},
    body:JSON.stringify({model:"gemini-decision-1",input,questions}),signal:AbortSignal.timeout(45000)
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error("Gemini Decision 1 "+stage+" failed: "+(data?.error?.message||data?.message||("HTTP "+response.status)));
  if(!data?.answers||typeof data.answers!=="object")throw new Error("Gemini Decision 1 returned no typed answers.");
  return data;
}
async function runGeminiCandidateScoring(master:string,inputData:any,candidates:any[]) {
  const questions:Record<string,any>={};
  candidates.forEach((candidate,index)=>{
    questions["candidate_"+String(index).padStart(3,"0")]={
      type:"score",
      instructions:"Evaluate candidate "+index+" from the supplied CANDIDATES list for conservative football accumulator suitability. Use only the API-Football fixture, prediction, comparison and odds information supplied. Consider exact market type, evidence consistency, missing information and volatility. Do not infer unavailable team news or treat odds as a probability. Return a high rating only when the supplied evidence genuinely supports the selection.",
      criteria:[
        "0 — Reject: evidence is missing, contradictory, or the market is too volatile.",
        "1 — Weak: little support or substantial uncertainty; do not include.",
        "2 — Mixed: some support, but not strong enough for the published slip.",
        "3 — Favorable: useful provider evidence supports the selection and major concerns are limited.",
        "4 — Strong: multiple consistent provider indicators support the selection and the market is comparatively stable."
      ]
    };
  });
  const input=JSON.stringify({task:"Score each candidate independently. Do not create new candidates or return prose. All candidates are exact market and odds records from API-Football.",administrator_guidance:master,provider_data:inputData,candidates:candidates.map((c,index)=>({index,...c}))});
  const result=await geminiDecisionRequest(input,questions,"candidate evaluation");
  return candidates.map((candidate,index)=>{
    const answer=result.answers["candidate_"+String(index).padStart(3,"0")];
    if(!answer||answer.type!=="score")return {index,score:-1,confidence:0,safety_probability:0,safety_confidence:0};
    const score=Number(answer.score),confidence=Number(answer.confidence);
    return {index,score:Number.isFinite(score)?score:-1,confidence:Number.isFinite(confidence)?confidence:0,safety_probability:Number.isFinite(score)?Math.max(0,Math.min(1,score/4)):0,safety_confidence:Number.isFinite(confidence)?confidence:0};
  });
}
function nigeriaToday() {
  const parts=new Intl.DateTimeFormat("en-GB", {timeZone:"Africa/Lagos",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const part=(type:string)=>parts.find(x=>x.type===type)?.value||"";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function buildSlip(candidates:any[],answers:any[],date:string): Record<string,any> {
  const scored=candidates.map((candidate,index)=>{
    const review=answers.find((item:any)=>Number(item?.index)===index);
    const score=Number(review?.score??-1),confidence=Number(review?.confidence??0),suitability=Number(review?.safety_probability??0),odds=Number(candidate.decimal_odds);
    return {candidate,index,score,confidence,suitability,odds,review};
  }).filter(x=>Number.isFinite(x.odds)&&x.odds>1&&x.score>=3&&x.confidence>=0.55&&x.suitability>=0.75).sort((a,b)=>b.score-a.score||b.confidence-a.confidence);
  const pool=scored.slice(0,24);let best:any[]|null=null,bestQuality=-Infinity;
  const walk=(start:number,chosen:any[],product:number)=>{
    if(chosen.length&&product>=2&&product<=2.30){
      const quality=chosen.reduce((sum,x)=>sum+x.score*x.confidence,0)/chosen.length-(chosen.length-1)*0.015;
      if(quality>bestQuality){bestQuality=quality;best=[...chosen];}return;
    }
    if(chosen.length>=4||product>2.30)return;
    for(let i=start;i<pool.length;i++)walk(i+1,[...chosen,pool[i]],product*pool[i].odds);
  };
  walk(0,[],1);
  if(!best)return {date,title:"Daily Football Picks",selections:[],combined_odds:null,confidence_note:"No combination met the Decision 1 evidence threshold and the 2.00–2.30 combined-odds target. No bet is recommended.",research_notes:["The app did not force weak selections to reach the odds target."],recommendation:"NO BET",decision_summary:{candidates_received:candidates.length,candidates_accepted:scored.length,model:"gemini-decision-1"}};
  const selections=best.map(x=>({match:x.candidate.match,competition:x.candidate.competition||"Football",kickoff:x.candidate.kickoff_nigeria_time||"",market:x.candidate.market_name,prediction:x.candidate.selection,odds:x.odds,reason:"Gemini Decision 1 suitability score: "+x.score.toFixed(2)+"/4 (confidence "+x.confidence.toFixed(2)+"). Based only on supplied API-Football data; verify current odds and lineups.",sources:[{title:"API-Football fixture and bookmaker odds data",url:"https://www.api-football.com/"}],decision_score:Number(x.score.toFixed(2)),decision_confidence:Number(x.confidence.toFixed(3))}));
  const combined=best.reduce((p,x)=>p*x.odds,1);
  return {date,title:"Daily Football Picks",selections,combined_odds:Number(combined.toFixed(2)),confidence_note:"Decision 1 suitability scores reflect supplied provider evidence, not guaranteed win probabilities. Confirm current odds and lineups before placing any bet.",research_notes:["Fixture, match and bookmaker odds data supplied by API-Football.","API-Football prediction enrichment included only where available.","Gemini Decision 1 evaluated the supplied candidates in one Decisions API request.","The app independently assembled the slip and calculated combined odds."],recommendation:"BET WITH CAUTION",decision_summary:{candidates_received:candidates.length,candidates_accepted:scored.length,selected:selections.length,model:"gemini-decision-1"}};
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
      if(path==="admin/test-gemini" && req.method==="POST") {
        const {question}=await body(req),prompt=String(question||"").trim();
        if(!prompt||prompt.length>4000)return json({error:"Enter a football scenario of up to 4,000 characters."},400);
        const result=await geminiDecisionRequest(prompt,{suitability:{type:"score",instructions:"How suitable is this football selection for a cautious accumulator, based only on the facts supplied?",criteria:["0 — Reject: unsupported or highly risky.","1 — Weak: major uncertainty.","2 — Mixed: insufficient evidence.","3 — Favorable: meaningful supporting evidence.","4 — Strong: multiple consistent supporting indicators."]}},"connection test");
        const answer=result.answers.suitability;
        return json({ok:true,model:"gemini-decision-1",score:answer?.score??null,confidence:answer?.confidence??null,probabilities:answer?.probabilities??{}});
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
        const master=rows[0]?.prompt_text||defaults.master,date=nigeriaToday();
        console.info("[daily-football-picks] Fetching fixtures and odds from API-Football");
        const footballData=await loadApiFootballData(date);
        const publishNoBet=async(message:string,notes:string[])=>{
          const pick={date,title:"Daily Football Picks",selections:[],combined_odds:null,confidence_note:message,recommendation:"NO BET",research_notes:notes,decision_summary:{model:"gemini-decision-1"}};
          await db.sql`INSERT INTO daily_picks(pick_date,payload,status) VALUES (${date},${JSON.stringify(pick)}::jsonb,'published') ON CONFLICT(pick_date) DO UPDATE SET payload=EXCLUDED.payload,status='published',created_at=NOW()`;
          return pick;
        };
        if(!footballData.fixtures.length||!footballData.oddsRecords.length){
          const pick=await publishNoBet("API-Football returned no upcoming fixtures with available bookmaker odds for today. No bet is recommended.",["Data source: API-Football.","Fixtures returned: "+footballData.fixtures.length,"Verified odds records: "+footballData.oddsRecords.length]);
          return json({ok:true,pick,model_requests:0,api_football_requests:footballData.apiRequests,api_football_remaining:footballData.remaining,request_breakdown:{api_football:footballData.apiRequests,gemini_decision:0}});
        }
        const bestByMarket=new Map<string,any>();
        for(const record of footballData.oddsRecords){
          const odds=Number(record.decimal_odds);if(!Number.isFinite(odds)||odds<1.15||odds>2.50)continue;
          const key=[record.fixture_id,record.market_name,record.selection].join("|"),existing=bestByMarket.get(key);
          if(!existing||odds>Number(existing.decimal_odds))bestByMarket.set(key,record);
        }
        const candidates=[...bestByMarket.values()].slice(0,100);
        if(!candidates.length){
          const pick=await publishNoBet("API-Football returned no bookmaker selections within the configured candidate odds range. No bet is recommended.",["No fixture or odds were invented."]);
          return json({ok:true,pick,model_requests:0,api_football_requests:footballData.apiRequests,api_football_remaining:footballData.remaining,request_breakdown:{api_football:footballData.apiRequests,gemini_decision:0}});
        }
        const inputData={date,provider:"API-Football",fixtures:footballData.fixtures,bookmaker_odds:footballData.oddsRecords,api_football_predictions:footballData.predictionData};
        console.info("[daily-football-picks] Sending API-Football data to Gemini Decision 1",{fixtures:footballData.fixtures.length,candidates:candidates.length});
        const answers=await runGeminiCandidateScoring(master.replaceAll("{{NIGERIA_DATE}}",date),inputData,candidates);
        const final=buildSlip(candidates,answers,date);
        await db.sql`INSERT INTO daily_picks(pick_date,payload,status) VALUES (${date},${JSON.stringify(final)}::jsonb,'published') ON CONFLICT(pick_date) DO UPDATE SET payload=EXCLUDED.payload,status='published',created_at=NOW()`;
        console.info("[daily-football-picks] Gemini Decision 1 workflow completed: one Decisions API request");
        return json({ok:true,pick:final,model:"gemini-decision-1",model_requests:1,api_football_requests:footballData.apiRequests,api_football_remaining:footballData.remaining,request_breakdown:{api_football:footballData.apiRequests,gemini_decision:1}});
      }
    }
    return json({error:"Not found."},404);
  } catch(error) {
    console.error(error);
    return json({error:error instanceof Error?error.message:"Unexpected server error."},500);
  }
};
export const config:Config={path:"/api/*"};