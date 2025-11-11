const API = "http://localhost:8000";

let token = localStorage.getItem("ytmp3_token") || "";
let username = localStorage.getItem("ytmp3_user") || "";
let isAdmin = localStorage.getItem("ytmp3_admin") === "true";
let fileId = null;
let filename = null;

function $(id){return document.getElementById(id)}
function show(view){["view-login","view-register","view-app"].forEach(v=>$(v).style.display="none");$(view).style.display=""}
function setText(id, t){const el=$(id); el.textContent=t; el.classList.remove("hidden")}
function clearText(id){const el=$(id); el.textContent=""; el.classList.add("hidden")}
function escapeHtml(s){return (s||"").replace(/[&<>\"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]))}

function prepField(el, base){
  if(!el) return;
  el.value=""; el.setAttribute("name", `${base}_${Math.random().toString(36).slice(2,9)}`); el.readOnly=true;
  const unlock=()=>{el.readOnly=false}; el.addEventListener("focus", unlock, {once:true}); el.addEventListener("pointerdown", unlock, {once:true});
}
function resetLoginForm(){const u=$("login-username"), p=$("login-password"); prepField(u,"login_user"); prepField(p,"login_pass"); setTimeout(()=>{u.value="";p.value=""},50); setTimeout(()=>{u.value="";p.value=""},300)}
function resetRegisterForm(){const u=$("reg-username"), p=$("reg-password"); prepField(u,"reg_user"); prepField(p,"reg_pass"); setTimeout(()=>{u.value="";p.value=""},50); setTimeout(()=>{u.value="";p.value=""},300)}

async function api(path, options={}){
  const headers=Object.assign({"Content-Type":"application/json"}, options.headers||{});
  if(token) headers["Authorization"]=`Bearer ${token}`;
  const res=await fetch(API+path, {...options, headers});
  const ct=res.headers.get("content-type")||"";
  const body=ct.includes("application/json")?await res.json():await res.text();
  if(!res.ok) throw new Error((body && body.detail) || body || "Request failed");
  return body;
}

// Boot
async function boot(){
  if(token){
    try{
      const me=await api("/me");
      username=me.user; isAdmin=!!me.is_admin;
      localStorage.setItem("ytmp3_user", username);
      localStorage.setItem("ytmp3_admin", String(isAdmin));
      initAppUI();
      show("view-app");
      await loadMyDownloads();
      await loadUsersList();
      return;
    }catch{ token=""; username=""; isAdmin=false; localStorage.clear(); }
  }
  resetLoginForm(); show("view-login");
}
boot();

// Login (+ Enter)
async function handleLogin(e){ if(e) e.preventDefault(); clearText("login-msg");
  const u=$("login-username").value.trim(), p=$("login-password").value;
  if(!u||!p) return setText("login-msg","Please enter username and password.");
  try{
    const data=await api("/login",{method:"POST",body:JSON.stringify({username:u,password:p})});
    token=data.token; username=data.user; isAdmin=!!data.is_admin;
    localStorage.setItem("ytmp3_token",token); localStorage.setItem("ytmp3_user",username); localStorage.setItem("ytmp3_admin",String(isAdmin));
    initAppUI(); show("view-app");
    $("yt-url").value = "";
    await loadMyDownloads(); await loadUsersList();
  }catch(err){ setText("login-msg",err.message) }
}
$("btn-login").addEventListener("click", handleLogin);
$("login-form").addEventListener("submit", handleLogin);

// Nav
$("link-to-register").addEventListener("click", ()=>{clearText("register-msg");clearText("register-ok"); resetRegisterForm(); show("view-register"); $("reg-username").focus();});
$("link-to-login").addEventListener("click", ()=>{clearText("login-msg"); resetLoginForm(); show("view-login");});

// Register
$("register-form").addEventListener("submit", async (e)=>{ e.preventDefault(); clearText("register-msg"); clearText("register-ok");
  const u=$("reg-username").value.trim(), p=$("reg-password").value;
  if(!u||!p) return setText("register-msg","Please fill out both fields.");
  try{
    await api("/register",{method:"POST",body:JSON.stringify({username:u,password:p})});
    setText("register-ok","Account created. You can now log in.");
    setTimeout(()=>{ resetLoginForm(); show("view-login"); $("login-username").focus(); }, 600);
  }catch(err){ setText("register-msg", err.message) }
});

// Logout
$("btn-logout").addEventListener("click", ()=>{
  token=""; username=""; isAdmin=false; fileId=null; filename=null;
  localStorage.removeItem("ytmp3_token"); localStorage.removeItem("ytmp3_user"); localStorage.removeItem("ytmp3_admin");
  $("yt-url").value = "";
  resetLoginForm(); $("rightSidebar").style.display="none"; $("myDownloadsGrid").innerHTML=""; drawerClose(); show("view-login");
});

// App UI
function initAppUI(){
  $("whoami").textContent = username ? `Logged in as ${username}` : "";
  $("btn-get").disabled = true;
  $("rightSidebar").style.display = "block";
  const badge=$("youBadge"); if(badge) badge.textContent=username || "you";
}

// My Downloads
async function loadMyDownloads(){
  const grid=$("myDownloadsGrid"); grid.innerHTML="<div class='dlCard'>Loading…</div>";
  try{
    const items=await api("/my_downloads");
    if(!items.length){ grid.innerHTML="<div class='dlCard'><div class='dlTitle'>No downloads yet</div><div class='dlMeta'>Start by pasting a YouTube URL below.</div></div>"; return; }
    grid.innerHTML = items.map(it=>{
      const ts=new Date(it.timestamp).toLocaleString();
      const fname=it.filename||"(processing)";
      const disabled = it.status!=="ready" ? "disabled":"";
      return `
        <div class="dlCard" id="dl-${it.id}">
          <div class="dlTitle">${escapeHtml(fname)}</div>
          <div class="dlMeta">${ts} • Status: ${escapeHtml(it.status)}</div>
          <div class="btnRow">
            <button class="btnSmall" onclick="checkOne('${it.id}')">Status</button>
            <button class="btnSmall" onclick="downloadOne('${it.id}','${encodeURIComponent(fname)}')" ${disabled}>Download</button>
            <button class="btnSmall" onclick="deleteOne('${it.id}')">Delete</button>
          </div>
        </div>`;
    }).join("");
  }catch(e){ grid.innerHTML=`<div class='dlCard'>${escapeHtml(e.message)}</div>`; }
}

window.checkOne = async function(id){
  try{
    const st=await api(`/status/${id}`);
    if(st.ready){
      setText("app-ok","The link is ready for the download.");
      $("yt-url").value = "";
    }else{
      setText("app-ok","Still processing…");
    }
    await loadMyDownloads();
  }catch(e){ alert(e.message) }
};

window.downloadOne = function(id, fnameEnc){
  const a=document.createElement("a");
  a.href=`${API}/download/${id}`; // auth header carries token
  a.download=decodeURIComponent(fnameEnc);
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
};
window.deleteOne = async function(id){
  try{
    await api(`/delete/${id}`,{method:"DELETE"});
    await loadMyDownloads();
    if(fileId===id){fileId=null;filename=null;$("btn-get").disabled=true;}
  }catch(e){ alert(e.message) }
};

// Main controls
$("btn-download").addEventListener("click", async ()=>{
  clearText("app-msg"); clearText("app-ok");
  const url=$("yt-url").value.trim(); if(!url) return setText("app-msg","Paste a YouTube URL.");
  try{
    const data=await api("/download",{method:"POST",body:JSON.stringify({url})});
    fileId=data.file_id; filename=data.filename; $("btn-get").disabled=false;
    setText("app-ok","The link is ready for the download.");
    pollUntilReady(fileId);
    await loadMyDownloads();
  }catch(e){ setText("app-msg", e.message) }
});

function pollUntilReady(id){
  const interval = setInterval(async ()=>{
    try{
      const st = await api(`/status/${id}`);
      if(st.ready){
        clearInterval(interval);
        $("yt-url").value = "";
        setText("app-ok","The link is ready for the download.");
        $("btn-get").disabled = false;
        await loadMyDownloads();
      }
    }catch(_e){ clearInterval(interval); }
  }, 2500);
}

$("btn-status").addEventListener("click", async ()=>{
  clearText("app-msg"); clearText("app-ok");
  if(!fileId) return setText("app-msg","No file ID yet.");
  try{
    const data=await api(`/status/${fileId}`);
    if(data.ready){
      $("yt-url").value = "";
      setText("app-ok","The link is ready for the download.");
    }else{
      setText("app-ok","Still processing…");
    }
    await loadMyDownloads();
  }catch(e){ setText("app-msg", e.message) }
});

$("btn-get").addEventListener("click", ()=>{
  clearText("app-msg"); clearText("app-ok");
  if(!fileId||!filename) return setText("app-msg","Nothing to download yet.");
  const a=document.createElement("a");
  a.href=`${API}/download/${fileId}`;
  a.download=filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
});
$("btn-delete").addEventListener("click", async ()=>{
  clearText("app-msg"); clearText("app-ok");
  if(!fileId) return setText("app-msg","No file ID.");
  try{
    await api(`/delete/${fileId}`,{method:"DELETE"});
    setText("app-ok","Deleted.");
    fileId=null; filename=null; $("btn-get").disabled=true;
    $("yt-url").value = "";
    await loadMyDownloads();
  }catch(e){ setText("app-msg", e.message) }
});

// ====== USERS SIDEBAR + Drawer ======
async function loadUsersList(){
  const sidebar=$("rightSidebar"), list=$("userList"), search=$("userSearch");
  sidebar.style.display="block"; list.innerHTML="<li class='userItem'>Loading…</li>";
  let users=[];
  try{ users=await api("/users"); }catch(e){ list.innerHTML=`<li class='userItem'>${escapeHtml(e.message)}</li>`; return; }

  function render(filter=""){
    const f=filter.trim().toLowerCase();
    const filtered=users.filter(u=>u.username.toLowerCase().includes(f));
    list.innerHTML = filtered.map(u=>`
      <li class="userItem" data-user="${escapeHtml(u.username)}">
        <span>${escapeHtml(u.username)}</span>
        ${u.username===username?'<span class="badge">you</span>':''}
      </li>`).join("");
    Array.from(list.querySelectorAll(".userItem")).forEach(li=>{
      li.addEventListener("click", ()=> openUserDrawer(li.getAttribute("data-user")));
    });
  }
  render(); search.addEventListener("input", ()=>render(search.value));
}

const drawer=$("drawer"), drawerOverlay=$("drawerOverlay");
$("drawerClose").addEventListener("click", drawerClose); drawerOverlay.addEventListener("click", drawerClose);
function drawerOpen(){ drawer.classList.add("open"); drawerOverlay.classList.add("open"); }
function drawerClose(){ drawer.classList.remove("open"); drawerOverlay.classList.remove("open"); $("drawerBody").innerHTML=""; $("drawerTitle").textContent="Downloads"; $("adminActions").style.display="none"; $("adminTempVal").textContent=""; }

async function openUserDrawer(targetUser){
  $("drawerTitle").textContent=`Downloads • ${targetUser}`;
  $("drawerBody").innerHTML="<div class='dlCard'>Loading…</div>";
  drawerOpen();

  // Admin controls
  if(isAdmin){
    $("adminActions").style.display="block";
    $("btnSetTemp").onclick = ()=> adminSetTempPassword(targetUser);
    $("btnShowTemp").onclick = ()=> adminShowTempPassword(targetUser);
  }

  try{
    const items=await api(`/user_downloads/${encodeURIComponent(targetUser)}`);
    if(!items.length){ $("drawerBody").innerHTML="<div class='dlCard'><div class='dlTitle'>No downloads yet</div></div>"; return; }
    $("drawerBody").innerHTML = items.map(it=>{
      const ts=new Date(it.timestamp).toLocaleString();
      const fname=it.filename||"(processing)";
      const disabled = it.status!=="ready" ? "disabled":"";
      return `
        <div class="dlCard">
          <div class="dlTitle">${escapeHtml(fname)}</div>
          <div class="dlMeta">${ts} • Status: ${escapeHtml(it.status)}</div>
          <div class="btnRow">
            <button class="btnSmall" onclick="checkOne('${it.id}')">Status</button>
            <button class="btnSmall" onclick="downloadOne('${it.id}','${encodeURIComponent(fname)}')" ${disabled}>Download</button>
          </div>
        </div>`;
    }).join("");
  }catch(e){ $("drawerBody").innerHTML=`<div class='dlCard'>${escapeHtml(e.message)}</div>`; }
}

// ---- Admin helpers ----
async function adminSetTempPassword(user){
  const custom = prompt("Enter temp password (leave blank to auto-generate):") || "";
  let ttl = prompt("Minutes until expiry? (default 60)") || "60";
  ttl = parseInt(ttl, 10); if(!Number.isFinite(ttl) || ttl <= 0) ttl = 60;
  try{
    const res = await api(`/users/${encodeURIComponent(user)}/temp_password`,{
      method:"POST",
      body: JSON.stringify({ new_password: custom || null, generate: !custom, ttl_minutes: ttl })
    });
    $("adminTempVal").textContent = res.temp_password + `  (expires ${new Date(res.expires_at).toLocaleString()})`;
    alert("Temp password set.");
  }catch(e){ alert(e.message); }
}

async function adminShowTempPassword(user){
  try{
    const res = await api(`/users/${encodeURIComponent(user)}/temp_password`);
    $("adminTempVal").textContent = res.temp_password + `  (expires ${new Date(res.expires_at).toLocaleString()})`;
  }catch(e){ alert(e.message); }
}
