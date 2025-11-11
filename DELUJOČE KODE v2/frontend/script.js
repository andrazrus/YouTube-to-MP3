// ---------- Config ----------
const API = "http://localhost:8000";
const ALWAYS_REQUIRE_LOGIN = true; // forces reload to login

// ---------- Mini helpers ----------
const $ = (id) => document.getElementById(id);
const has = (id) => !!$(id);
const text = (el, t) => { if(el){ el.textContent=t; el.classList.remove("hidden"); } };
const clearText = (el) => { if(el){ el.textContent=""; el.classList.add("hidden"); } };
const escapeHtml = (s) => (s||"").replace(/[&<>\"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));

// ---------- Views ----------
function show(viewId){
  ["view-login","view-register","view-reset","view-app","view-admin"].forEach(id => {
    const el=$(id); if(el) el.style.display="none";
  });
  const target = $(viewId); if(target) target.style.display="";
}

// ---------- Forms prep (anti-autofill) ----------
function prepField(el, base){
  if(!el) return;
  el.value=""; el.setAttribute("name", `${base}_${Math.random().toString(36).slice(2,9)}`); el.readOnly=true;
  const unlock=()=>{el.readOnly=false};
  el.addEventListener("focus", unlock, {once:true});
  el.addEventListener("pointerdown", unlock, {once:true});
}
function resetLoginForm(){ prepField($("login-username"),"login_user"); prepField($("login-password"),"login_pass"); setTimeout(()=>{$("login-username").value="";$("login-password").value=""},30); }
function resetRegisterForm(){ prepField($("reg-username"),"reg_user"); prepField($("reg-password"),"reg_pass"); if($("reg-word")) $("reg-word").value=""; }

// ---------- API ----------
async function api(path, options={}){
  const headers = Object.assign({"Content-Type":"application/json"}, options.headers||{});
  if(window.__token) headers["Authorization"] = `Bearer ${window.__token}`;
  const res = await fetch(API+path, {...options, headers});
  const ct = res.headers.get("content-type") || "";
  const body = ct.includes("application/json") ? await res.json() : await res.text();
  if(!res.ok) throw new Error((body && body.detail) || body || "Request failed");
  return body;
}

// ---------- Download helper ----------
async function startDownload(url, suggestedName) {
  try {
    const a = document.createElement("a");
    a.href = url; a.download = suggestedName || "download.mp3"; a.rel = "noopener";
    document.body.appendChild(a); a.click(); a.remove(); return;
  } catch {}
  try {
    const res = await fetch(url, { credentials: "omit" });
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    let fileName = suggestedName || "download.mp3";
    const disp = res.headers.get("Content-Disposition") || "";
    const m = /filename\*=UTF-8''([^;]+)|filename="?([^"]+)"?/i.exec(disp);
    if (m) fileName = decodeURIComponent(m[1] || m[2]);
    const blob = await res.blob();
    const a = document.createElement("a");
    const href = URL.createObjectURL(blob);
    a.href = href; a.download = fileName;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(href); return;
  } catch {}
  window.location.assign(url);
}

// ---------- State ----------
window.__token = ALWAYS_REQUIRE_LOGIN ? "" : (localStorage.getItem("ytmp3_token") || "");
let username = ALWAYS_REQUIRE_LOGIN ? "" : (localStorage.getItem("ytmp3_user") || "");
let isAdmin  = ALWAYS_REQUIRE_LOGIN ? false : (localStorage.getItem("ytmp3_admin") === "true");
let fileId = null;
let filename = null;

// ---------- Boot ----------
async function boot(){
  try{
    if(window.__token){
      const me = await api("/me");
      username = me.user; isAdmin = !!me.is_admin;
      localStorage.setItem("ytmp3_user", username);
      localStorage.setItem("ytmp3_admin", String(isAdmin));
      initAppUI(); show("view-app");
      await Promise.all([loadMyDownloads(), loadUsersList()]);
      wireStaticHandlers(); // click handlers that don’t depend on re-render
      return;
    }
  }catch{}
  resetLoginForm(); show("view-login");
  wireStaticHandlers();
}
boot();

// ---------- Auth flows ----------
async function handleLogin(e){
  if(e) e.preventDefault();
  clearText($("login-msg"));
  const u = $("login-username").value.trim();
  const p = $("login-password").value;
  if(!u||!p){ text($("login-msg"),"Please enter username and password."); return; }
  try{
    const data = await api("/login",{method:"POST",body:JSON.stringify({username:u,password:p})});
    window.__token = data.token; username = data.user; isAdmin = !!data.is_admin;
    if (!ALWAYS_REQUIRE_LOGIN) {
      localStorage.setItem("ytmp3_token", window.__token);
      localStorage.setItem("ytmp3_user", username);
      localStorage.setItem("ytmp3_admin", String(isAdmin));
    }
    initAppUI(); show("view-app");
    $("yt-url") && ($("yt-url").value="");
    await Promise.all([loadMyDownloads(), loadUsersList()]);
  }catch(err){ text($("login-msg"), err.message); }
}
has("btn-login") && $("btn-login").addEventListener("click", handleLogin);
has("login-form") && $("login-form").addEventListener("submit", handleLogin);

has("link-to-register") && $("link-to-register").addEventListener("click", ()=>{ resetRegisterForm(); show("view-register"); $("reg-username")?.focus(); });
has("link-to-login") && $("link-to-login").addEventListener("click", ()=>{ resetLoginForm(); show("view-login"); });
has("link-to-reset") && $("link-to-reset").addEventListener("click", ()=>{ show("view-reset"); });
has("reset-back") && $("reset-back").addEventListener("click", ()=>{ show("view-login"); });

has("register-form") && $("register-form").addEventListener("submit", async (e)=>{
  e.preventDefault();
  clearText($("register-msg")); clearText($("register-ok"));
  const u=$("reg-username").value.trim(), p=$("reg-password").value, w=$("reg-word").value.trim();
  if(!u||!p||!w){ text($("register-msg"),"Fill out username, password and secret word."); return; }
  try{
    localStorage.setItem(`pw_word_${u}`, w);
    await api("/register",{method:"POST",body:JSON.stringify({username:u,password:p,reset_word:w})});
    text($("register-ok"),"Account created. You can now log in.");
    setTimeout(()=>{ resetLoginForm(); show("view-login"); }, 700);
  }catch(err){ text($("register-msg"), err.message); }
});

has("reset-form") && $("reset-form").addEventListener("submit", async (e)=>{
  e.preventDefault();
  clearText($("reset-msg")); clearText($("reset-ok"));
  const u=$("reset-username").value.trim(), w=$("reset-word").value.trim(), np=$("reset-new").value;
  if(!u||!w||!np){ text($("reset-msg"),"Fill out all fields."); return; }
  try{
    await api("/self_reset",{method:"POST",body:JSON.stringify({username:u,word:w,new_password:np})});
    text($("reset-ok"), "Password changed. You can log in now.");
  }catch(err){ text($("reset-msg"), err.message); }
});

// ---------- Static handlers (not re-rendered) ----------
function wireStaticHandlers(){
  // logout
  has("btn-logout") && $("btn-logout").addEventListener("click", ()=>{
    window.__token=""; username=""; isAdmin=false; fileId=null; filename=null;
    localStorage.removeItem("ytmp3_token"); localStorage.removeItem("ytmp3_user"); localStorage.removeItem("ytmp3_admin");
    $("yt-url") && ($("yt-url").value="");
    resetLoginForm(); $("rightSidebar") && ( $("rightSidebar").style.display="none" );
    $("myDownloadsGrid") && ( $("myDownloadsGrid").innerHTML="" );
    drawerClose(); show("view-login");
  });

  // admin panel open/close
  has("btn-admin") && $("btn-admin").addEventListener("click", openAdminPanel);
  has("admin-close") && $("admin-close").addEventListener("click", closeAdminPanel);

  // drawer close
  has("drawerClose") && $("drawerClose").addEventListener("click", drawerClose);
  const ov = $("drawerOverlay"); if (ov) ov.addEventListener("click", drawerClose);

  // main app buttons
  has("btn-download") && $("btn-download").addEventListener("click", onConvert);
  has("btn-status")   && $("btn-status").addEventListener("click", onCheckStatus);
  has("btn-get")      && $("btn-get").addEventListener("click", onGetDirect);
}

// ---------- App UI ----------
function initAppUI(){
  $("whoami") && ( $("whoami").textContent = username ? `Logged in as ${username}` : "" );
  $("btn-get") && ( $("btn-get").disabled = true );
  const sb = $("rightSidebar"); if(sb) sb.style.display="block";
  const badge = $("youBadge"); if(badge) badge.textContent = username || "you";
  const ab = $("btn-admin"); if(ab) ab.style.display = isAdmin ? "" : "none";
}

// ---------- My Downloads ----------
async function loadMyDownloads(){
  const grid=$("myDownloadsGrid"); if(!grid) return;
  grid.innerHTML="<div class='dlCard'>Loading…</div>";
  try{
    const items=await api("/my_downloads");
    if(!items.length){
      grid.innerHTML="<div class='dlCard'><div class='dlTitle'>No downloads yet</div><div class='dlMeta'>Start by pasting a YouTube URL below.</div></div>";
      return;
    }
    grid.innerHTML = items.map(it=>{
      const ts=new Date(it.timestamp).toLocaleString();
      const fname=it.filename||"(processing)";
      const disabled = it.status!=="ready" ? "disabled":"";
      return `
        <div class="dlCard" id="dl-${it.id}">
          <div class="dlTitle">${escapeHtml(fname)}</div>
          <div class="dlMeta">${ts} • Status: ${escapeHtml(it.status)}</div>
          <div class="btnRow">
            <button type="button" class="btnSmall js-status"   data-id="${it.id}">Status</button>
            <button type="button" class="btnSmall primary js-download" data-id="${it.id}" data-fname="${encodeURIComponent(fname)}" ${disabled}>Download</button>
            <button type="button" class="btnSmall js-delete"   data-id="${it.id}">Delete</button>
          </div>
        </div>`;
    }).join("");

    // wire the buttons that were just rendered
    grid.querySelectorAll(".js-status").forEach(b => b.addEventListener("click", () => checkOne(b.dataset.id)));
    grid.querySelectorAll(".js-download").forEach(b => b.addEventListener("click", () => {
      const url = `${API}/download/${encodeURIComponent(b.dataset.id)}?token=${encodeURIComponent(window.__token||"")}`;
      const fname = b.dataset.fname ? decodeURIComponent(b.dataset.fname) : "download.mp3";
      startDownload(url, fname);
    }));
    grid.querySelectorAll(".js-delete").forEach(b => b.addEventListener("click", () => deleteOne(b.dataset.id)));
  }catch(e){
    grid.innerHTML=`<div class='dlCard'>${escapeHtml(e.message)}</div>`;
  }
}

// also used by admin table
async function checkOne(id){
  try{
    const st=await api(`/status/${id}`);
    if(st.ready){ text($("app-ok"),"The link is ready for the download."); $("yt-url") && ($("yt-url").value=""); }
    else{ text($("app-ok"),"Still processing…"); }
    await loadMyDownloads();
  }catch(e){ alert(e.message); }
}
async function deleteOne(id){
  try{
    await api(`/delete/${id}`,{method:"DELETE"});
    await loadMyDownloads();
    if(fileId===id){ fileId=null; filename=null; $("btn-get") && ($("btn-get").disabled=true); }
  }catch(e){ alert(e.message); }
}

// main controls
async function onConvert(){
  clearText($("app-msg")); clearText($("app-ok"));
  const url=$("yt-url")?.value.trim();
  if(!url){ text($("app-msg"),"Paste a YouTube URL."); return; }
  try{
    const data=await api("/download",{method:"POST",body:JSON.stringify({url})});
    fileId=data.file_id; filename=data.filename; $("btn-get") && ($("btn-get").disabled=false);
    text($("app-ok"),"The link is ready for the download.");
    pollUntilReady(fileId);
    await loadMyDownloads();
  }catch(e){ text($("app-msg"), e.message); }
}
function pollUntilReady(id){
  const int = setInterval(async ()=>{
    try{
      const st=await api(`/status/${id}`);
      if(st.ready){
        clearInterval(int);
        $("yt-url") && ( $("yt-url").value="" );
        text($("app-ok"),"The link is ready for the download.");
        $("btn-get") && ($("btn-get").disabled=false);
        await loadMyDownloads();
      }
    }catch{ clearInterval(int); }
  }, 2500);
}
async function onCheckStatus(){
  clearText($("app-msg")); clearText($("app-ok"));
  if(!fileId){ text($("app-msg"),"No file ID yet."); return; }
  try{
    const data=await api(`/status/${fileId}`);
    if(data.ready){ $("yt-url") && ( $("yt-url").value="" ); text($("app-ok"),"The link is ready for the download."); }
    else text($("app-ok"),"Still processing…");
    await loadMyDownloads();
  }catch(e){ text($("app-msg"), e.message); }
}
async function onGetDirect(){
  clearText($("app-msg")); clearText($("app-ok"));
  if(!fileId||!filename){ text($("app-msg"),"Nothing to download yet."); return; }
  const url = `${API}/download/${encodeURIComponent(fileId)}?token=${encodeURIComponent(window.__token||"")}`;
  try { await startDownload(url, filename); } catch(e){ text($("app-msg"), e.message); }
}

// ---------- Users sidebar + drawer ----------
async function loadUsersList(){
  const sidebar=$("rightSidebar"), list=$("userList"), search=$("userSearch");
  if(!sidebar || !list) return;
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
    list.querySelectorAll(".userItem").forEach(li=>{
      li.addEventListener("click", ()=> openUserDrawer(li.getAttribute("data-user")));
    });
  }
  render(); search && search.addEventListener("input", ()=>render(search.value));
}

const drawer=$("drawer"), drawerOverlay=$("drawerOverlay");
function drawerOpen(){ drawer?.classList.add("open"); drawerOverlay?.classList.add("open"); }
function drawerClose(){ drawer?.classList.remove("open"); drawerOverlay?.classList.remove("open"); $("drawerBody") && ( $("drawerBody").innerHTML="" ); $("drawerTitle") && ( $("drawerTitle").textContent="Downloads" ); }

async function openUserDrawer(targetUser){
  $("drawerTitle") && ( $("drawerTitle").textContent=`Downloads • ${targetUser}` );
  $("drawerBody") && ( $("drawerBody").innerHTML="<div class='dlCard'>Loading…</div>" );
  drawerOpen();
  try{
    const items=await api(`/user_downloads/${encodeURIComponent(targetUser)}`);
    $("drawerBody").innerHTML = !items.length
      ? "<div class='dlCard'><div class='dlTitle'>No downloads yet</div></div>"
      : items.map(it=>{
          const ts=new Date(it.timestamp).toLocaleString();
          const fname=it.filename||"(processing)";
          const disabled = it.status!=="ready" ? "disabled":"";
          return `
            <div class="dlCard">
              <div class="dlTitle">${escapeHtml(fname)}</div>
              <div class="dlMeta">${ts} • Status: ${escapeHtml(it.status)}</div>
              <div class="btnRow">
                <button type="button" class="btnSmall primary js-u-dl"
                        data-id="${it.id}"
                        data-fname="${encodeURIComponent(fname)}"
                        ${disabled}>Download</button>
              </div>
            </div>`;
        }).join("");

    // wire drawer buttons
    const body = $("drawerBody");
    body.querySelectorAll(".js-u-dl").forEach(b => b.addEventListener("click", ()=>{
      const url = `${API}/download/${encodeURIComponent(b.dataset.id)}?token=${encodeURIComponent(window.__token||"")}`;
      const fname = b.dataset.fname ? decodeURIComponent(b.dataset.fname) : "download.mp3";
      startDownload(url, fname);
    }));
  }catch(e){
    $("drawerBody").innerHTML=`<div class='dlCard'>${escapeHtml(e.message)}</div>`;
  }
}

// ---------- Admin panel ----------
function openAdminPanel(){ show("view-admin"); renderAdminTable(); }
function closeAdminPanel(){ show("view-app"); }
async function renderAdminTable(){
  const tbody = $("admin-tbody"); if (!tbody) return;
  tbody.innerHTML = `<tr><td class="center" colspan="5">Loading…</td></tr>`;
  try {
    const users = await api("/users");
    if (!users.length) { tbody.innerHTML = `<tr><td class="center" colspan="5">No users.</td></tr>`; return; }
    tbody.innerHTML = users.map(u => {
      const dt = u.created_at ? new Date(u.created_at) : null;
      const time = dt ? dt.toLocaleTimeString() : "-";
      const date = dt ? dt.toLocaleDateString() : "-";
      const adminChip = u.is_admin ? `<span class="chip">admin</span>` : "";
      return `
        <tr>
          <td>${escapeHtml(u.username)} ${adminChip}</td>
          <td class="nowrap">${time}</td>
          <td class="nowrap">${date}</td>
          <td>
            <div class="row-inline">
              <input class="pw-input" data-role="temp-pw" placeholder="Leave empty to auto-generate" />
              <button type="button" class="btnTiny js-adm-set" data-user="${escapeHtml(u.username)}">Set</button>
            </div>
          </td>
          <td>
            <button type="button" class="btnTiny danger js-adm-del" data-user="${escapeHtml(u.username)}">Delete</button>
          </td>
        </tr>`;
    }).join("");

    // wire admin buttons
    tbody.querySelectorAll(".js-adm-set").forEach(b => b.addEventListener("click", async ()=>{
      const row  = b.closest("tr");
      const input = row.querySelector("input[data-role='temp-pw']");
      const pw = (input?.value || "").trim();
      try {
        await api(`/users/${encodeURIComponent(b.dataset.user)}/reset_password`, {
          method: "POST", body: JSON.stringify({ new_password: pw || null, generate: !pw })
        });
        await renderAdminTable();
      } catch (err) { alert(err.message); }
    }));
    tbody.querySelectorAll(".js-adm-del").forEach(b => b.addEventListener("click", async ()=>{
      const user = b.dataset.user;
      if (!confirm(`Delete user "${user}" and all their downloads?`)) return;
      try {
        await api(`/admin/delete_user/${encodeURIComponent(user)}`, { method: "DELETE" });
        await Promise.all([renderAdminTable(), loadUsersList(), loadMyDownloads()]);
      } catch (err) { alert(err.message); }
    }));
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="5" class="center">${escapeHtml(e.message)}</td></tr>`;
  }
}
