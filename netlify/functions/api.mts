import type { Config } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";

const db = getDatabase();
const COOKIE = "dfp_session";
const defaults: Record<string,string> = {
  master: "# MASTER PROMPT — DAILY FOOTBALL RESEARCH & LOW-RISK BETTING SELECTIONS\n\n## ROLE AND OBJECTIVE\nAct as an advanced football research and betting analysis system. Research today's football fixtures and identify the strongest evidence-backed betting opportunities. The highest priority is reducing risk, verifying information, and avoiding weak selections. Do not chase odds or force a bet.\n\n## DATE AND FIXTURES\nUse today's actual date in Nigeria (Africa/Lagos time): {{NIGERIA_DATE}}.\nResearch professional football matches scheduled to take place on that Nigerian calendar date. Check kickoff times and time zones carefully. Exclude completed, postponed, cancelled, or incorrectly dated fixtures. Consider relevant leagues and competitions worldwide, not only the most popular leagues.\n\n## DEEP RESEARCH FOR EACH POTENTIAL MATCH\nInvestigate:\n- Recent form over the last 5–10 matches, with appropriate weighting for opponent strength.\n- League position, points, season performance, and the importance of the fixture.\n- Home and away performance.\n- Goals scored and conceded, including first-half and second-half patterns.\n- Over/under trends, both-teams-to-score trends, clean sheets, and team-goal patterns.\n- Head-to-head history only where it is relevant and not misleading.\n- Tactical systems, playing styles, likely formations, and matchup advantages.\n- Injuries, suspensions, unavailable players, expected lineups, squad depth, rotation, and fixture congestion.\n- Referee identity and relevant disciplinary/penalty history when reliably available.\n- Motivation, title/relegation/qualification pressure, and competition context.\n- Weather and pitch conditions if materially relevant.\n- Current decimal odds, bookmaker/source, and the time odds were checked; note meaningful market movement if verifiable.\n\nUse current, credible sources. Give more weight to recent and relevant evidence than old head-to-head records. Do not infer unavailable facts. Distinguish verified facts from estimates and explicitly flag missing or uncertain information.\n\n## ALL SUITABLE BETTING MARKETS\nEvaluate all markets where reliable data exists, including match result, double chance, draw no bet, Asian handicap, total goals, team goals, both teams to score, first-half markets, corners, cards, and other relevant statistical markets. Choose the market with the strongest evidence-backed case, not simply the highest odds. Avoid volatile or poorly supported markets.\n\n## STRICT RISK FILTER\nReject candidates with stale or unverifiable odds, unclear fixture details, major unresolved lineup uncertainty, important missing team news, unreliable statistics, unstable tactical circumstances, excessive volatility, or weak evidence. Never invent fixtures, odds, injuries, referee details, statistics, sources, or probabilities. An estimated probability must be a reasoned estimate, not a guarantee.\n\n## ODDS OBJECTIVE\nThe preferred combined decimal odds are 2.00–2.30. The risk preference is the lowest credible risk. Prefer a small number of strong independent selections. Never add a weak selection just to reach 2.00. If the evidence does not support a credible combination at 2.00 or higher, return no qualifying slip rather than forcing one. Individual odds must be current and sourced.\n\n## OUTPUT FOR THE INDEPENDENT DECISION STAGE\nReturn valid JSON only. Do not create the final accumulator yourself. Return up to 40 researched candidate selections in this structure:\n{\n  \"date\": \"{{NIGERIA_DATE}}\",\n  \"research_summary\": \"Concise summary of the fixtures researched and important findings.\",\n  \"candidates\": [\n    {\n      \"match\": \"Home Team vs Away Team\",\n      \"competition\": \"Competition name\",\n      \"kickoff_nigeria_time\": \"ISO 8601 time with Nigeria offset or clearly stated Nigeria time\",\n      \"market\": \"Specific betting market\",\n      \"prediction\": \"Exact selection\",\n      \"decimal_odds\": 1.50,\n      \"estimated_probability\": 0.80,\n      \"supporting_evidence\": [\"Verified supporting evidence with relevant figures.\"],\n      \"potential_risks\": [\"Material uncertainty or reason this selection could fail.\"],\n      \"referee_notes\": \"Verified relevant referee information or state unavailable.\",\n      \"lineup_injury_notes\": \"Verified team news or state unavailable.\",\n      \"odds_source\": \"Bookmaker or odds source and time checked.\",\n      \"sources\": [{\"title\":\"Source title\",\"url\":\"https://example.com\",\"published\":\"Date if available\"}]\n    }\n  ],\n  \"research_limitations\": [\"Important unavailable or uncertain information.\"]\n}\n\nReturn an empty candidates array if no credible opportunities exist. Ensure odds are decimal numbers greater than 1.00 and all sources actually support the claims.\n\n## FINAL PRINCIPLES\nEvidence and safety come before quantity and odds. Do not describe any bet as certain, fixed, or guaranteed. The next stage will independently score and reject candidates. The application, not this research call, will calculate the final combined odds."
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
async function openAIResponse(input:string, useBrowserSearch:boolean) {
  const key=secret("OPENAI_API_KEY");
  const payload:any={
    model:"gpt-5.4-mini",
    input,
    reasoning:{effort:"low"}
  };
  if(useBrowserSearch) {
    payload.tools=[{type:"web_search"}];
    payload.tool_choice="required";
  }
  const response=await fetch("https://api.openai.com/v1/responses",{
    method:"POST",
    headers:{"content-type":"application/json","authorization":`Bearer ${key}`},
    body:JSON.stringify(payload)
  });
  const data=await response.json();
  if(!response.ok) {
    const detail=data?.error?.message || `OpenAI request failed (${response.status})`;
    throw new Error(`OpenAI ${useBrowserSearch?"research":"decision"} stage: ${detail}`);
  }
  const outputText=Array.isArray(data?.output)
    ? data.output.filter((item:any)=>item?.type==="message")
        .flatMap((item:any)=>Array.isArray(item?.content)?item.content:[])
        .filter((item:any)=>item?.type==="output_text")
        .map((item:any)=>item.text||"").join("\n")
    : "";
  const text=outputText || data?.output_text || "";
  if(!text) throw new Error("OpenAI returned an empty response.");
  return text;
}
function parseModelJson(text:string, stage:string) {
  const cleaned=text.replace(/^```json\s*/i,"").replace(/\s*```$/,"").trim();
  const first=cleaned.indexOf("{");
  const last=cleaned.lastIndexOf("}");
  if(first<0||last<=first) throw new Error(`OpenAI ${stage} stage returned no valid JSON object.`);
  try { return JSON.parse(cleaned.slice(first,last+1)); }
  catch { throw new Error(`OpenAI ${stage} stage returned invalid JSON. Please run the workflow again.`); }
}
async function runOpenAIResearch(prompt:string, input:string) {
  const instructions=prompt+"\n\nIMPORTANT OUTPUT RULE: Return only one valid JSON object matching the requested schema. Do not wrap it in Markdown fences. Use browser search to verify current fixtures, team news, referees, statistics and odds. Cite actual source URLs in the JSON.";
  const text=await openAIResponse(instructions+"\n\nINPUT DATA:\n"+input,true);
  return parseModelJson(text,"research");
}
async function runOpenAIDecision(input:string) {
  const instructions=`You are the independent final risk reviewer for a football-picks workflow. Evaluate EVERY candidate in the supplied input. Do not conduct new fixture research and do not assume missing facts are true. Score evidence quality and conservative accumulator suitability. Reject stale or unverified odds, weak evidence, unclear fixtures, major lineup uncertainty, volatile markets, and unsupported probability claims. Do not select based on odds alone. Return one result for each candidate, preserving its zero-based index. Use conservative estimates. A score of 3 or 4 requires strong current evidence. Safety probability means your estimated probability that the selection itself wins, not a guarantee. Confidence measures how well the evidence supports your assessment.
Return valid JSON only in this shape: { "reviews": [ { "index": 0, "score": 0, "confidence": 0.0, "safety_probability": 0.0, "safety_confidence": 0.0, "reason": "short explanation" } ] }
Score must be 0 to 4. All probability/confidence values must be between 0 and 1. Include every candidate exactly once.`;
  const text=await openAIResponse(instructions+"\n\nCANDIDATES TO REVIEW:\n"+input,false);
  const parsed=parseModelJson(text,"decision");
  if(!Array.isArray(parsed?.reviews)) throw new Error("OpenAI decision stage returned no candidate reviews.");
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
    decision_summary:{candidates_received:candidates.length,candidates_accepted:scored.length,model:"gpt-5.4-mini"}
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
    research_notes:["Research and candidate generation: one OpenAI Responses API request with web search.","Independent candidate scoring: one OpenAI Responses API request.","Final slip assembly and combined-odds calculation: application code."],
    recommendation:"BET WITH CAUTION",
    decision_summary:{candidates_received:candidates.length,candidates_accepted:scored.length,selected:selections.length,model:"gpt-5.4-mini"}
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
        console.info("[daily-football-picks] OpenAI research request started");
        const research=await runOpenAIResearch(master.replaceAll("{{NIGERIA_DATE}}",date),`Today's date in Nigeria (Africa/Lagos): ${date}. Research today's fixtures and return the required candidate JSON.`);
        const candidates=Array.isArray(research?.candidates)?research.candidates.slice(0,40):[];
        if(!candidates.length) {
          const noBet={date,title:"Daily Football Picks",selections:[],combined_odds:null,confidence_note:"No credible candidate selections were returned by the research stage. No bet is recommended.",recommendation:"NO BET",research_notes:research?.research_limitations||[]};
          await db.sql`INSERT INTO daily_picks(pick_date,payload,status) VALUES (${date},${JSON.stringify(noBet)}::jsonb,'published') ON CONFLICT(pick_date) DO UPDATE SET payload=EXCLUDED.payload,status='published',created_at=NOW()`;
          return json({ok:true,pick:noBet,model_requests:1,request_breakdown:{openai_research:1,openai_decision:0}});
        }
        console.info("[daily-football-picks] OpenAI decision request started", {candidate_count:candidates.length});
        const answers=await runOpenAIDecision(JSON.stringify({date,research_summary:research.research_summary,candidates}));
        const final=buildSlip(candidates,answers,date);
        final.research_summary=research.research_summary||"";
        final.research_limitations=research.research_limitations||[];
        await db.sql`INSERT INTO daily_picks(pick_date,payload,status) VALUES (${date},${JSON.stringify(final)}::jsonb,'published') ON CONFLICT(pick_date) DO UPDATE SET payload=EXCLUDED.payload,status='published',created_at=NOW()`;
        console.info("[daily-football-picks] OpenAI workflow completed: 2 model requests maximum");
        return json({ok:true,pick:final,model_requests:2,request_breakdown:{openai_research:1,openai_decision:1}});
      }
    }
    return json({error:"Not found."},404);
  } catch(error) {
    console.error(error);
    return json({error:error instanceof Error?error.message:"Unexpected server error."},500);
  }
};
export const config:Config={path:"/api/*"};