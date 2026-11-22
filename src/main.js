import "./style.css";

const app=document.querySelector("#app");
let user=null;
let adminKey="";
let prompts={master:""};
let activeTab="home";

async function api(path,options={}) {
  const response=await fetch("/api/"+path,{credentials:"same-origin",...options,headers:{"content-type":"application/json",...(options.headers||{})}});
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
 shell(`<section class="hero"><div class="eyebrow"><span class="pulse"></span> DAILY MATCH INTELLIGENCE</div><h1>One considered slip.<br><em>Every matchday.</em></h1><p>Upcoming fixtures and available bookmaker odds supplied by API-Football, evaluated by Gemini Decision 1.</p><div class="hero-meta"><span>UPDATED DAILY</span><span>•</span><span>ODDS TARGET 2.00–2.30</span></div></section>
 <section class="slip-wrap"><div class="section-head"><div><div class="eyebrow">THE DAILY SELECTION</div><h2>${pick?escapeHtml(pick.title||"Today's slip"):"Today's football picks"}</h2></div><span class="date-tag">${escapeHtml(pick?.date||new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Lagos",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date()))}</span></div>
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
 shell(`<section class="admin-head"><div class="eyebrow">CONTROL ROOM</div><h2>Daily workflow</h2><p>API-Football supplies match data and bookmaker odds. Gemini Decision 1 analyses small batches one minute apart, then performs final refinement after another minute.</p></section><section class="form-card"><label>Admin access key<input id="adminKey" type="password" autocomplete="off" placeholder="Enter your ADMIN_KEY"></label><div class="admin-actions"><button class="btn secondary" id="loadPrompts">Load prompts</button><button class="btn" id="savePrompts">Save prompts</button><button class="btn accent" id="runWorkflow">Start batch analysis</button><button class="btn secondary" id="resumeWorkflow">Resume progress</button></div><div class="workflow-progress"><div class="progress-head"><b id="progressTitle">Batch analysis not started</b><strong id="progressCount">0%</strong></div><input id="batchProgress" type="range" min="0" max="100" value="0" disabled><p id="progressDetail" class="muted">Up to five batches, with one-minute intervals and a separate final refinement.</p></div><p class="form-message" id="adminMessage">Your admin key is used only for these protected requests.</p><div class="prompt-editor"><label>Test Gemini Decision 1<textarea id="geminiTestQuestion" rows="3">Home team has a strong API-Football prediction, favorable team comparison, and a 1.55 bookmaker price for the home win. Is this a suitable cautious accumulator selection?</textarea></label><button class="btn secondary" id="testGemini">Test Decision 1</button><div id="geminiTestResult"></div></div><div class="prompt-editor"><label>Master research prompt<textarea id="master" rows="22" placeholder="Load the master prompt or edit your research instructions..."></textarea></label><p class="muted">API-Football supplies fixtures, prediction summaries and bookmaker odds. Gemini Decision 1 scores only supplied candidate markets; the app uses exact provider prices and never accepts invented fixtures or odds.</p></div><div id="workflowResult"></div></section>`);
 const key=app.querySelector("#adminKey");key.value=adminKey;key.oninput=()=>adminKey=key.value;
 const headers=()=>({"x-admin-key":adminKey}), msg=app.querySelector("#adminMessage");
 app.querySelector("#loadPrompts").onclick=async()=>{try{const r=await api("admin/prompts",{headers:headers()});prompts=r.prompts;app.querySelector("#master").value=prompts.master||"";msg.textContent="Master prompt loaded.";msg.className="form-message success"}catch(e){msg.textContent=e.message;msg.className="form-message error"}};
 app.querySelector("#savePrompts").onclick=async()=>{try{const p={master:app.querySelector("#master").value};await api("admin/prompts",{method:"POST",headers:headers(),body:JSON.stringify({prompts:p})});msg.textContent="Master prompt saved.";msg.className="form-message success"}catch(e){msg.textContent=e.message;msg.className="form-message error"}};
 app.querySelector("#testGemini").onclick=async()=>{const b=app.querySelector("#testGemini"),out=app.querySelector("#geminiTestResult"),question=app.querySelector("#geminiTestQuestion").value;b.disabled=true;b.textContent="Testing…";out.innerHTML="";try{const r=await api("admin/test-gemini",{method:"POST",headers:headers(),body:JSON.stringify({question})});out.innerHTML='<div class="result-box"><h3>Gemini Decision 1 · '+escapeHtml(r.model||"")+'</h3><pre>'+escapeHtml(r.score===null?"No score returned":"Suitability score: "+r.score+" / 4\nConfidence: "+r.confidence+"\nProbabilities: "+JSON.stringify(r.probabilities))+'</pre></div>';msg.textContent="Gemini Decision 1 returned a scored decision successfully.";msg.className="form-message success"}catch(e){out.innerHTML='<div class="notice error">'+escapeHtml(e.message)+'</div>';msg.textContent="Decision 1 test failed.";msg.className="form-message error"}finally{b.disabled=false;b.textContent="Test Decision 1"}};
 const progress=app.querySelector("#batchProgress"),progressTitle=app.querySelector("#progressTitle"),progressCount=app.querySelector("#progressCount"),progressDetail=app.querySelector("#progressDetail"),resultBox=app.querySelector("#workflowResult");
 let pollTimer=null;
 const updateProgress=s=>{
   const total=Number(s.totalBatches||0),done=Number(s.completedBatches||0),pct=s.status==="completed"?100:Number(s.progress??(total?Math.round(done/total*100):0));
   progress.value=String(pct);progressCount.textContent=pct+"%";
   if(s.status==="completed"){
     progressTitle.textContent="Analysis complete";progressDetail.textContent="All match batches and final refinement have completed.";
     if(s.pick)resultBox.innerHTML='<div class="result-box"><h3>Final refined picks · '+escapeHtml(s.model_requests??"")+' Decision 1 requests</h3><pre>'+escapeHtml(JSON.stringify(s.pick,null,2))+'</pre></div>';
     msg.textContent="The final result has been saved and published.";msg.className="form-message success";return;
   }
   if(s.status==="running"){
     progressTitle.textContent=s.stage==="refinement"?"Final refinement waiting":"Batch "+Math.min(done+1,total)+" of "+total;
     progressDetail.textContent=done+" of "+total+" batches completed. "+(s.stage==="refinement"?"Final refinement starts after the one-minute wait.":"The next batch starts after a one-minute interval.");
   }else if(s.status==="idle"){progressTitle.textContent="Batch analysis not started";}
 };
 const poll=async()=>{
   try{const s=await api("admin/status",{headers:headers()});updateProgress(s);if(s.status==="running")pollTimer=setTimeout(poll,5000);else if(pollTimer)clearTimeout(pollTimer)}
   catch(e){msg.textContent=e.message;msg.className="form-message error";pollTimer=setTimeout(poll,10000)}
 };
 const resume=async()=>{if(pollTimer)clearTimeout(pollTimer);await poll()};
 app.querySelector("#resumeWorkflow").onclick=resume;
 app.querySelector("#runWorkflow").onclick=async()=>{
   if(!confirm("Start API-Football match collection, then send small batches to Gemini Decision 1 one minute apart, followed by final refinement?"))return;
   const b=app.querySelector("#runWorkflow");b.disabled=true;b.textContent="Starting…";
   msg.textContent="Preparing match batches. The analysis will continue in the background, even if you leave this page.";
   try{
     const response=await fetch("/.netlify/functions/batch-workflow",{method:"POST",headers:headers(),body:"{}"});
     if(!response.ok)throw new Error("Could not start the background workflow ("+response.status+").");
     progressTitle.textContent="Starting batch workflow";progressDetail.textContent="Collecting fixtures and bookmaker odds from API-Football.";
     msg.textContent="Background workflow started. You can leave this page and return to resume progress.";msg.className="form-message success";
     if(pollTimer)clearTimeout(pollTimer);pollTimer=setTimeout(poll,2500);
   }catch(e){msg.textContent=e.message;msg.className="form-message error"}
   finally{b.disabled=false;b.textContent="Start batch analysis"}
 };
 resume();
}
async function render(){if(activeTab==="home")return renderHome();if(activeTab==="account")return renderAccount();return renderAdmin()}
try{const r=await api("me");user=r.user}catch{}render();