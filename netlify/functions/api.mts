import type { Config } from "@netlify/functions";
import { getDatabase } from "@netlify/database";

const db = getDatabase();
function json(data: unknown, status = 200) { return Response.json(data, { status }); }
function adminAllowed(req: Request) {
  const expected = Netlify.env.get("ADMIN_KEY");
  return !!expected && req.headers.get("x-admin-key") === expected;
}
function nigeriaToday() {
  const parts = new Intl.DateTimeFormat("en-GB", {timezone:"Africa/Lagos",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const part = (type:string) => parts.find(x => x.type === type)?.value || "";
  return part("year")+"-"+part("month")+"-"+part("day");
}
async function readBody(req:Request) { return await req.json().catch(()=>({} as any)); }
async function apiFootballRequest(path:string) {
  const key = Netlify.env.get("API_FOOTBALL_KEY");
  if (!key) throw new Error("API_FOOTBALL_KEY is missing from Netlify environment variables.");
  const response = await fetch("https://v3.football.api-sports.io/"+path,{headers:{"x-apisports-key":key,"accept":"application/json"},signal:AbortSignal.timeout(30000)});
  const data:any = await response.json().catch(()=>({}));
  if (!response.ok) throw new Error("API-Football request failed ("+response.status+"). Check the API key and daily quota.");
  if (data?.errors && Object.keys(data.errors).length) throw new Error("API-Football: "+Object.values(data.errors).map(String).join("; "));
  return {data,remaining:response.headers.get("x-ratelimit-requests-remaining")};
}
function fixtureSummary(item:any) {
  return {
    fixture_id:Number(item?.fixture?.id),
    match:String(item?.teams?.home?.name||"")+" vs "+String(item?.teams?.away?.name||""),
    home_team:String(item?.teams?.home?.name||""), away_team:String(item?.teams?.away?.name||""),
    competition:String(item?.league?.name||"Football"), country:String(item?.league?.country||""),
    kickoff:String(item?.fixture?.date||""), kickoff_wat:String(item?.fixture?.date||""),
    kickoff_timestamp:Number(item?.fixture?.timestamp||0), status:String(item?.fixture?.status?.short||""),
    venue:String(item?.fixture?.venue?.name||""), round:String(item?.league?.round||"")
  };
}
async function fetchDailyFootballData() {
  const date=nigeriaToday();
  const fixturesResult=await apiFootballRequest("fixtures?date="+encodeURIComponent(date)+"&timezone=Africa%2FLagos");
  const now=Math.floor(Date.now()/1000);
  const fixtures=(fixturesResult.data.response||[]).map(fixtureSummary)
    .filter((f:any)=>f.fixture_id&&f.kickoff_timestamp>now&&["NS","TBD"].includes(f.status));
  const fixtureIds=new Set(fixtures.map((f:any)=>f.fixture_id));
  let oddsPages:any[]=[]; let oddsRequests=0;
  if(fixtures.length) {
    const first=await apiFootballRequest("odds?date="+encodeURIComponent(date)+"&page=1");
    oddsRequests++; oddsPages.push(...(first.data.response||[]));
    const totalPages=Math.max(1,Math.min(Number(first.data.paging?.total||1),20));
    if(totalPages>1) {
      const rest=await Promise.all(Array.from({length:totalPages-1},(_,i)=>apiFootballRequest("odds?date="+encodeURIComponent(date)+"&page="+(i+2))));
      oddsRequests+=rest.length; for(const page of rest) oddsPages.push(...(page.data.response||[]));
    }
  }
  const fixtureById=new Map(fixtures.map((f:any)=>[f.fixture_id,f]));
  const oddsRecords:any[]=[];
  for(const event of oddsPages) {
    const fixtureId=Number(event?.fixture?.id); if(!fixtureIds.has(fixtureId)) continue;
    const fixture:any=fixtureById.get(fixtureId);
    for(const bookmaker of (event?.bookmakers||[])) for(const market of (bookmaker?.bets||[])) for(const value of (market?.values||[])) {
      const odd=Number(value?.odd); if(!Number.isFinite(odd)||odd<=1) continue;
      oddsRecords.push({
        fixture_id:fixtureId,match:fixture.match,competition:fixture.competition,kickoff_wat:fixture.kickoff_wat,
        bookmaker:String(bookmaker?.name||""),market_id:Number(market?.id||0),market_name:String(market?.name||""),
        selection:String(value?.value||""),handicap:String(value?.handicap||""),decimal_odds:odd
      });
    }
  }
  // Enrich a representative set of matches while preserving every fixture and odds market returned above.
  const predictionFixtureIds=fixtures.slice(0,15).map((f:any)=>f.fixture_id);
  const predictionResults=await Promise.all(predictionFixtureIds.map(async(id:number)=>{
    try {
      const result=await apiFootballRequest("predictions?fixture="+id); const row=result.data.response?.[0];
      if(!row) return null;
      return {fixture_id:id,predictions:row.predictions||{},teams:row.teams||{},comparison:row.comparison||{},h2h:(row.h2h||[]).slice(0,10),league:row.league||{}};
    } catch(error) {
      console.warn("[daily-football-picks] Match enrichment unavailable for fixture",id,error);
      return {fixture_id:id,unavailable:true};
    }
  }));
  const data={
    date,timezone:"Africa/Lagos (WAT)",provider:"API-Football",fetched_at:new Date().toISOString(),
    fixtures,odds_records:oddsRecords,match_statistics:predictionResults.filter(Boolean),
    summary:{
      fixtures:fixtures.length,odds_records:oddsRecords.length,
      bookmaker_markets:new Set(oddsRecords.map(x=>x.bookmaker+" | "+x.market_name)).size,
      enriched_matches:predictionResults.filter(Boolean).length,odds_pages_read:oddsRequests
    },
    note:"Only upcoming fixtures for the Nigeria-local date are listed. API-Football supplies available bookmaker markets and pre-match prediction, comparison and head-to-head data. Live match statistics may not exist before kickoff."
  };
  await db.sql`INSERT INTO prompts(prompt_key,prompt_text,updated_at)
    VALUES (${"manual_football_data"},${JSON.stringify(data)},NOW())
    ON CONFLICT(prompt_key) DO UPDATE SET prompt_text=EXCLUDED.prompt_text,updated_at=NOW()`;
  return data;
}
function parseSelections(raw:any) {
  let parsed=raw;
  if(typeof raw==="string") {
    const cleaned=raw.trim().replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,"");
    parsed=JSON.parse(cleaned);
  }
  if(Array.isArray(parsed)) return parsed;
  if(Array.isArray(parsed?.selections)) return parsed.selections;
  if(Array.isArray(parsed?.picks)) return parsed.picks;
  if(Array.isArray(parsed?.matches)) return parsed.matches;
  throw new Error("Paste valid JSON containing a selections array. Use the example shown above the publishing box.");
}
function buildPublishedPick(input:any) {
  const selections=parseSelections(input?.content??input?.selections??input);
  if(!selections.length) throw new Error("Add at least one selected match before publishing.");
  if(selections.length>30) throw new Error("A single publication can contain up to 30 selections.");
  const normalized=selections.map((item:any,index:number)=>{
    const match=String(item?.match||item?.fixture||"").trim();
    const market=String(item?.market||item?.market_name||"").trim();
    const selection=String(item?.selection||item?.prediction||item?.pick||"").trim();
    const odds=Number(item?.odds??item?.decimal_odds);
    if(!match||!market||!selection||!Number.isFinite(odds)||odds<=1)
      throw new Error("Selection "+(index+1)+" needs match, market, selection, and decimal odds greater than 1.");
    return {match,competition:String(item?.competion||item?.league||"Football"),kickoff:String(item?.kickoff||item?.kickoff_wat||""),market,selection,odds:Number(odds.toFixed(2),bookmaker:String(item?.bookmaker||""),reason:String(item?.reason||item?.analysis||"")};
  });
  const combined=normalized.reduce((total:number,item:any)=>total*item.odds,1);
  return {date:nigeriaToday(),title:String(input?.title||"Today's Football Picks"),published_at:new Date().toISOString(), timezone:"Africa/Lagos",selections:normalized,combined_odds:Number(combined.toFixed(2)),confidence_note:String(input?.confidence_note||input?.summary||""),source:"Admin-published external analysis"};
}
export default async(req:Request)=>{
  const url=new URL(req.url); const path=url.pathname.replace(/^\/api\/?/,"").replace(/\/$/,"");
  try {
    if(path==="health"&&req.method==="GET") return json({ok:true,service:"daily-football-picks"});
    if(path==="picks"&&req.method==="GET") {
      const rows=await db.sql<{payload:any;pick_date:string}>`SELECT payload,pick_date FROM daily_picks WHERE status='published' ORDER BY created_at DESC LIMIT 30`;
      return json({picks:rows.map(row=>row.payload)});
    }
    if(!path.startsWith("admin/")) return json({error:"Not found."},404);
    if(!adminAllowed(req)) return json({error:"Admin key is incorrect or missing."},401);
    if(path==="admin/auth"&&req.method==="POST") return json({ok:true});
    if(path==="admin/fetch-data"&&req.method==="POST") return json({ok:true,data:await fetchDailyFootballData()});
    if(path==="admin/data"&&req.method==="GET") {
      const rows=await db.sql<{prompt_text:string}>`SELECT prompt_text FROM prompts WHERE prompt_key='manual_football_data' LIMIT 1`;
      if(!rows[0]?.prompt_text) return json({data:null});
      try { return json({data:JSON.parse(rows[0].prompt_text)}); } catch { return json({data:null}); }
    }
    if(path==="admin/publish"&&req.method==="POST") {
      const pick=buildPublishedPick(await readBody(req));
      await db.sql`INSERT INTO daily_picks(pick_date,payload,status)
        VALUES ($xpick.date},${JSON.stringify(pick)}::jsonb,'published')
        ON CONFLICT(pick_date) DO UPDATE SET payload=EXCLUDED.payload,status='published',created_at=NOW()`;
      return json({ok:true,pick});
    }
    if(path==="admin/chat"&&req.method==="POST") {
      const input=await readBody(req);
      const messages=Array.isArray(input?.messages)?input.messages.slice(-20):[];
      if(!messages.length) return json({error:"Enter a message first."},400);
      const safeMessages=messages.map((m:any)=>({role:m?.role==="assistant"?"assistant":"user",content:String(m?.content||"").slice(0,6000)}));
      const response=await fetch("https://ai-gateway.kilo.ai/api/v1/chat/completions",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({model:"kilo-auto/free",messages:[{role:"system",content:"You are the helpful admin assistant for Daily Football Picks. You can explain the website, API-Football data, odds, markets, and publishing workflow. You do not have live web browsing and must not invent live match facts, fixtures, odds, or statistics. The admin fetches current football data separately and can paste it into the conversation for help interpreting its structure. Be clear, practical, and concise."},...safeMessages]}),signal:AbortSignal.timeout(45000)});
      const data:any=await response.json().catch(()=>({}));
      if(!response.ok) return json({error:data?.error?.message||data?.message||("Kilo AI request failed ("+response.status+").")},502);
      const answer=data?.choices?.[0]?.message?.content;
      if(!answer) return json({error:"Kilo AI returned an empty response. Please try again."},502);
      return json({ok:true,reply:String(answer)});
    }
    return json({error:"Not found."},404);
  } catch(error) {
    console.error("[daily-football-picks]",error);
    return json({error:error instanceof Error?error.message:"Unexpected server error."},500);
  }
};
export const config:Config={path:"/api/*"};