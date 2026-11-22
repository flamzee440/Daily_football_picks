import type { Config } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";

const db = getDatabase();
const COOKIE = "dfp_session";
const defaults: Record<string,string> = {
  research: `Research today's professional football fixtures. Use Google Search grounding to find fixtures, team news, form, injuries, suspensions and credible current decimal odds. Only include matches that are genuinely scheduled today. Never invent fixtures, odds, injuries or sources. Prefer reputable bookmakers and current sources; include source URLs and timestamps. Return JSON only: {"candidates":[{"match":"Home vs Away","competition":"League","kickoff":"ISO datetime","market":"market and selection","odds":2.1,"estimated_probability":0.55,"reason":"evidence-based reason","risks":["risk"],"sources":[{"title":"source","url":"https://...","published":"date/time"}]}]}. Target a small pool of plausible selections; odds must be decimal numbers.`,
  refine: `Review the supplied candidate JSON critically. Remove selections with stale or missing odds, weak evidence, unclear lineups, high volatility or unsupported probability estimates. Check the supplied evidence and do not add new fixtures. Keep only the strongest independent selections and explain exclusions briefly. Return JSON only: {"shortlist":[...],"excluded":[{"match":"...","reason":"..."}]}.`,
  final: `Create one conservative daily football bet slip from the supplied shortlist. Aim for combined decimal odds between 2.00 and 3.00, but never force a weak selection to reach the target. Use only supplied selections and odds. Return valid JSON only with this shape: {"date":"YYYY-MM-DD","title":"Daily Football Picks","selections":[{"match":"Home vs Away","competition":"League","kickoff":"ISO datetime","market":"market and selection","odds":2.1,"reason":"short evidence-based reason"}],"combined_odds":2.2,"confidence_note":"No outcome is guaranteed; odds and team news can change.","research_notes":["brief note"],"sources":[{"title":"source","url":"https://..."}]}. If no defensible slip exists, return {"date":"YYYY-MM-DD","selections":[],"combined_odds":null,"confidence_note":"No qualifying slip today."}. Do not fabricate any field.`
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
async function runGemini(prompt:string, input:string) {
  const key=secret("GEMINI_API_KEY");
  const response=await fetch("https://generativelanguage.googleapis.com/v1beta/interactions",{
    method:"POST",
    headers:{"content-type":"application/json","x-goog-api-key":key},
    body:JSON.stringify({
      model:"gemini-3.8-flash",
      input:prompt+"\n\nINPUT DATA:\n"+input,
      tools:[{type:"google_search"}],
      response_format:{type:"text",mime_type:"application/json"}
    })
  });
  const data=await response.json();
  if(!response.ok) throw new Error(data?.error?.message || `Gemini request failed (${response.status})`);
  const outputText=Array.isArray(data?.steps)
    ? data.steps.filter((step:any)=>step?.type==="model_output")
        .flatMap((step:any)=>Array.isArray(step?.content)?step.content:[])
        .filter((item:any)=>item?.type==="text")
        .map((item:any)=>item.text||"").join("\n")
    : "";
  const text=outputText || data?.output_text || "";
  if(!text) throw new Error("Gemini returned an empty response.");
  const cleaned=text.replace(/^\`\`\`json\\s*/i,"").replace(/\\s*\`\`\`$/,"").trim();
  return JSON.parse(cleaned);
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
        return json({prompts});
      }
      if(path==="admin/prompts" && req.method==="POST") {
        const {prompts}=await body(req);
        if(!prompts||typeof prompts!=="object") return json({error:"Prompts object required."},400);
        for(const key of ["research","refine","final"]) {
          const value=String(prompts[key]||"").trim();
          if(!value||value.length>20000) return json({error:`The ${key} prompt is empty or too long.`},400);
          await db.sql`INSERT INTO prompts(prompt_key,prompt_text,updated_at) VALUES (${key},${value},NOW()) ON CONFLICT(prompt_key) DO UPDATE SET prompt_text=EXCLUDED.prompt_text,updated_at=NOW()`;
        }
        return json({ok:true});
      }
      if(path==="admin/run" && req.method==="POST") {
        const rows=await db.sql<{prompt_key:string,prompt_text:string}>`SELECT prompt_key,prompt_text FROM prompts`;
        const prompts={...defaults};
        for(const row of rows) prompts[row.prompt_key]=row.prompt_text;
        const date=today();
        const research=await runGemini(prompts.research,`Research date: ${date}. Return the required JSON.`);
        const refine=await runGemini(prompts.refine,JSON.stringify(research));
        const final=await runGemini(prompts.final,JSON.stringify(refine));
        const selections=Array.isArray(final.selections)?final.selections:[];
        let product=1;
        for(const pick of selections) {
          const odds=Number(pick.odds);
          if(!Number.isFinite(odds)||odds<=1) throw new Error("Final slip contains invalid decimal odds.");
          product*=odds;
        }
        if(selections.length && Math.abs(product-Number(final.combined_odds))>0.03) final.combined_odds=Number(product.toFixed(2));
        final.date=date;
        await db.sql`INSERT INTO daily_picks(pick_date,payload,status) VALUES (${date},${JSON.stringify(final)}::jsonb,'published') ON CONFLICT(pick_date) DO UPDATE SET payload=EXCLUDED.payload,status='published',created_at=NOW()`;
        return json({ok:true,pick:final});
      }
    }
    return json({error:"Not found."},404);
  } catch(error) {
    console.error(error);
    return json({error:error instanceof Error?error.message:"Unexpected server error."},500);
  }
};
export const config:Config={path:"/api/*"};