import "./style.css";

const app=document.querySelector("#app");
let user=null;
let adminKey="";
let prompts={research:"",refine:"",final:""};
let activeTab="home";

async function api(path,options={}) {
  const response=await fetch("/api/"+path,{credentials:"same-origin",headers:{"content-type":"application/json",...(options.headers||{})},...options});
  const data=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data.error||"Request failed");
  return data;
}
function escapeHtml(value="") {
  return String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function shell(content) {
 app.innerHTML=`<header class="topbar"><a class="brand" href="#"><span class="brand-mark">DF</span><span>DAILY <b>FOOTBALL PICKS</b></span></a><nav><button data-tab="home" class="nav-btn ${activeTab==="home"?"active":""}">Today’s picks</button><button data-tab="account" class="nav-btn ${activeTab==="account"?"active":""}">${user?"My account":"Sign in"}</button><button data-tab="admin" class="nav-btn ${activeTab==="admin"?"active":""}">Admin</button></nav></header><main>${content}</main><footer>Research-led picks. Never guaranteed. Bet responsibly and only where legal.</footer>`;
 app.querySelectorAll("[data-tab]").forEach(b=>b.addEventListener("click",()=>{activeTab=b.dataset.tab;render()}));
}
function formatOdds(n){return Number(n).toFixed(2)}
async function renderHome(){
 let pick=null; let error="";
 try{pick=(await api("picks")).pick}catch(e){error=e.message}
 const selections=pick?.selections||[];
 shell(`<section class="hero"><div class="eyebrow"><span class="pulse"></span> DAILY MATCH INTELLIGENCE</div><h1>One considered slip.<br><em>Every matchday.</em></h1><p>Football picks researched against current fixtures, team news and available market evidence.</p><div class="hero-meta"><span>UPDATED DAILY</span><span>•</span><span>ODDS TARGET 2.00–3.00</span></div></section>
 <section class="slip-wrap"><div class="section-head"><div><div class="eyebrow">THE DAILY SELECTION</div><h2>${pick?escapeHtml(pick.title||"Today's slip"):"Today's football picks"}</h2></div><span class="date-tag">${escapeHtml(pick?.date||new Date().toISOString().slice(0,10))}</span></div>
 ${error?'<div class="notice error">'+escapeHtml(error)+'</div>':""}
 ${!pick?'<div class="empty"><div class="empty-icon">⚽</div><h3>No slip published yet</h3><p>When the research workflow publishes a qualifying selection, it will appear here.</p></div>':selections.length?'<div class="selection-list">'+selections.map((s,i)=>`<article class="selection"><div class="number">${String(i+1).padStart(2,"0")}</div><div class="selection-info"><div class="league">${escapeHtml(s.competition||"FOOTBALL")} · ${escapeHtml(s.kickoff?new Date(s.kickoff).toLocaleString():"")}</div><h3>${escapeHtml(s.match)}</h3><p>${escapeHtml(s.market)}</p><small>${escapeHtml(s.reason||"")}</small></div><div class="odds"><small>ODDS</small><b>${formatOdds(s.odds)}</b></div></article>`).join("")+'</div><div class="total"><div><small>COMBINED DECIMAL ODDS</small><b>'+formatOdds(pick.combined_odds)+'</b></div><span class="status">PUBLISHED</span></div>':'<div class="empty"><h3>No qualifying slip today</h3><p>'+escapeHtml(pick.confidence_note||"No selection met the evidence standard.")+'</p></div>'}
 ${pick?.confidence_note?'<p class="disclaimer">'+escapeHtml(pick.confidence_note)+'</p>':""}
 </section><section class="bottom-note"><b>Important:</b> Odds move, lineups change and predictions can lose. This is research information, not financial advice or a guarantee.</section>`);
}
function renderAccount(){
 shell(`<section class="form-card"><div class="eyebrow">FREE MEMBER ACCESS</div><h2>${user?"Your account":"Welcome back"}</h2>${user?'<p>Signed in as '+escapeHtml(user.email)+'</p><button id="logout" class="btn secondary">Sign out</button>':'<div class="switch"><button id="loginMode" class="selected">Sign in</button><button id="signupMode">Create account</button></div><form id="authForm"><label>Email address<input name="email" type="email" required autocomplete="email" placeholder="you@example.com"></label><label>Password<input name="password" type="password" minlength="10" required autocomplete="current-password" placeholder="At least 10 characters"></label><button class="btn" type="submit">Sign in</button><p class="form-message" id="authMessage"></p></form><p class="muted">Free access. No subscription or payment is required.</p>'}</section>`);
 if(user){app.querySelector("#logout").onclick=async()=>{await api("logout",{method:"POST"});user=null;render()};return}
 let mode="login";
 app.querySelector("#loginMode").onclick=()=>{mode="login";app.querySelector("#loginMode").classList.add("selected");app.querySelector("#signupMode").classList.remove("selected");app.querySelector('button[type="submit"]').textContent="Sign in"};
 app.querySelector("#signupMode").onclick=()=>{mode="signup";app.querySelector("#signupMode").classList.add("selected");app.querySelector("#loginMode").classList.remove("selected");app.querySelector('button[type="submit"]').textContent="Create free account"};
 app.querySelector("#authForm").onsubmit=async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.currentTarget));const msg=app.querySelector("#authMessage");try{const r=await api(mode,{method:"POST",body:JSON.stringify(data)});user=r.user;activeTab="home";render()}catch(err){msg.textContent=err.message;msg.className="form-message error"}};
}
function renderAdmin(){
 shell(`<section class="admin-head"><div class="eyebrow">CONTROL ROOM</div><h2>Daily workflow</h2><p>Manage the three Gemini stages and publish the reviewed daily slip.</p></section><section class="form-card"><label>Admin access key<input id="adminKey" type="password" autocomplete="off" placeholder="Enter your ADMIN_KEY"></label><div class="admin-actions"><button class="btn secondary" id="loadPrompts">Load prompts</button><button class="btn" id="savePrompts">Save prompts</button><button class="btn accent" id="runWorkflow">Run all 3 stages</button></div><p class="form-message" id="adminMessage">Your admin key is used only for these protected requests.</p><div class="prompt-editor"><label>1 · Research prompt<textarea id="research" rows="8" placeholder="Load the default prompt or write your research instructions..."></textarea></label><label>2 · Refinement prompt<textarea id="refine" rows="8" placeholder="Load the default prompt or write your refinement instructions..."></textarea></label><label>3 · Final JSON prompt<textarea id="final" rows="8" placeholder="Load the default prompt or write your final JSON instructions..."></textarea></label></div><div id="workflowResult"></div></section>`);
 const key=app.querySelector("#adminKey");key.value=adminKey;key.oninput=()=>adminKey=key.value;
 const headers=()=>({"x-admin-key":adminKey});
 const msg=app.querySelector("#adminMessage");
 app.querySelector("#loadPrompts").onclick=async()=>{try{const r=await api("admin/prompts",{headers:headers()});prompts=r.prompts;for(const k of ["research","refine","final"])app.querySelector("#"+k).value=prompts[k];msg.textContent="Prompts loaded.";msg.className="form-message success"}catch(e){msg.textContent=e.message;msg.className="form-message error"}};
 app.querySelector("#savePrompts").onclick=async()=>{try{const p={};for(const k of ["research","refine","final"])p[k]=app.querySelector("#"+k).value;await api("admin/prompts",{method:"POST",headers:headers(),body:JSON.stringify({prompts:p})});msg.textContent="All three prompts saved.";msg.className="form-message success"}catch(e){msg.textContent=e.message;msg.className="form-message error"}};
 app.querySelector("#runWorkflow").onclick=async()=>{if(!confirm("Run the three Gemini stages now? This uses three model requests."))return;const b=app.querySelector("#runWorkflow");b.disabled=true;b.textContent="Researching…";msg.textContent="Running research, refinement and final JSON generation. This can take a little time.";try{const r=await api("admin/run",{method:"POST",headers:headers(),body:"{}"});app.querySelector("#workflowResult").innerHTML='<div class="result-box"><h3>Workflow finished</h3><pre>'+escapeHtml(JSON.stringify(r.pick,null,2))+'</pre></div>';msg.textContent="The slip has been saved and published.";msg.className="form-message success"}catch(e){msg.textContent=e.message;msg.className="form-message error"}finally{b.disabled=false;b.textContent="Run all 3 stages"}};
}
async function render(){if(activeTab==="home")return renderHome();if(activeTab==="account")return renderAccount();return renderAdmin()}
try{const r=await api("me");user=r.user}catch{}render();