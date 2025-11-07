



// ---------- Config ----------
const API = `${location.protocol}//${location.hostname}:8000`;

const ALWAYS_REQUIRE_LOGIN = true; // keeps reload -> login




// ---------- Helpers ----------
const $ = (id) => document.getElementById(id);
const has = (id) => !!$(id);
const text = (el,t)=>{ if(el){ el.textContent=t; el.classList.remove("hidden"); } };
const clearText = (el)=>{ if(el){ el.textContent=""; el.classList.add("hidden"); } };
const escapeHtml = (s)=> (s||"").replace(/[&<>"']/g, c => (
  { "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#39;" }[c]
));

// Hard nuke of autofill: replace username/password inputs with fresh elements
function nukeLoginInputs() {
  const u = $("login-username");
  const p = $("login-password");
  if (u) {
    const nu = u.cloneNode(false);
    nu.value = "";
    nu.id = "login-username";
    nu.setAttribute("autocomplete", "off");
    nu.setAttribute("autocapitalize", "off");
    nu.setAttribute("autocorrect", "off");
    nu.setAttribute("spellcheck", "false");
    nu.setAttribute("name", "u_" + Math.random().toString(36).slice(2));
    nu.readOnly = true;
    u.replaceWith(nu);
  }
  if (p) {
    const np = p.cloneNode(false);
    np.value = "";
    np.id = "login-password";
    np.type = "password";
    np.setAttribute("autocomplete", "off");
    np.setAttribute("name", "p_" + Math.random().toString(36).slice(2));
    np.readOnly = true;
    p.replaceWith(np);
  }
}

function prepField(el, base){
  if(!el) return;
  el.value="";
  el.setAttribute("name", `${base}_${Math.random().toString(36).slice(2,9)}`);
  el.readOnly=true;
  const unlock=()=>{el.readOnly=false};
  el.addEventListener("focus", unlock, {once:true});
  el.addEventListener("pointerdown", unlock, {once:true});
}
function resetLoginForm(){
  nukeLoginInputs(); // rebuild first
  prepField($("login-username"),"login_user");
  prepField($("login-password"),"login_pass");
  const form = $("login-form");
  if (form) form.setAttribute("autocomplete","off");
  setTimeout(()=>{$("login-username").value="";$("login-password").value=""},30);
}
function resetRegisterForm(){
  const ru = $("reg-username"), rp=$("reg-password");
  if (ru) { const n=ru.cloneNode(false); n.id="reg-username"; n.readOnly=true; n.setAttribute("autocomplete","off"); ru.replaceWith(n); }
  if (rp) { const n=rp.cloneNode(false); n.id="reg-password"; n.type="password"; n.readOnly=true; n.setAttribute("autocomplete","off"); rp.replaceWith(n); }
  prepField($("reg-username"),"reg_user");
  prepField($("reg-password"),"reg_pass");
  if($("reg-word")) $("reg-word").value="";
}

// views
function show(viewId){
  ["view-login","view-register","view-reset","view-app","view-admin"].forEach(id=>{
    const el=$(id); if(el) el.style.display="none";
  });
  const t=$(viewId); if(t) t.style.display="";

  // show the mobile bar ONLY on mobile AND only in the app view
  const mb = document.querySelector(".mobileBar");
  if (mb) {
    const isMobile = window.matchMedia("(max-width: 900px)").matches;
    const shouldShow = (viewId === "view-app") && isMobile;
    mb.classList.toggle("hidden-mobile", !shouldShow);
  }

  if (viewId === "view-login") resetLoginForm();
}

// ---------- API (with 401 auto-logout) ----------
async function api(path, options={}){
  const headers = Object.assign({"Content-Type":"application/json"}, options.headers||{});
  if(window.__token) headers["Authorization"] = `Bearer ${window.__token}`;
  const res = await fetch(API+path, {...options, headers});

  if (res.status === 401) {
    for (const id of pollers.keys()){ clearInterval(pollers.get(id)); }
    pollers.clear();
    window.__token=""; username=""; isAdmin=false; fileId=null; filename=null;
    localStorage.removeItem("ytmp3_token");
    localStorage.removeItem("ytmp3_user");
    localStorage.removeItem("ytmp3_admin");
    show("view-login");
    throw new Error("Unauthorized");
  }

  const ct = res.headers.get("content-type") || "";
  const body = ct.includes("application/json") ? await res.json() : await res.text();
  if(!res.ok) throw new Error((body && body.detail) || body || "Request failed");
  return body;
}

// robust file download
async function startDownload(url, suggestedName) {
  try {
    const a=document.createElement("a");
    a.href=url; a.download=suggestedName||"download.mp3"; a.rel="noopener";
    document.body.appendChild(a); a.click(); a.remove(); return;
  } catch{}
  try {
    const res=await fetch(url,{credentials:"omit"});
    if(!res.ok) throw new Error(`Download failed (${res.status})`);
    let fileName=suggestedName||"download.mp3";
    const disp=res.headers.get("Content-Disposition")||"";
    const m=/filename\*=UTF-8''([^;]+)|filename="?([^"]+)"?/i.exec(disp);
    if(m) fileName=decodeURIComponent(m[1]||m[2]);
    const blob=await res.blob(); const a=document.createElement("a");
    const href=URL.createObjectURL(blob);
    a.href=href; a.download=fileName;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(href); return;
  } catch{}
  window.location.assign(url);
}

// ---------- State ----------
window.__token = ALWAYS_REQUIRE_LOGIN ? "" : (localStorage.getItem("ytmp3_token") || "");
let username = ALWAYS_REQUIRE_LOGIN ? "" : (localStorage.getItem("ytmp3_user") || "");
let isAdmin  = ALWAYS_REQUIRE_LOGIN ? false : (localStorage.getItem("ytmp3_admin") === "true");
let fileId = null, filename = null;

let __usersCache = [];
let __downloadsCache = [];
let __searchTerm = ""; // always lowercase

// track active polling timers per file
const pollers = new Map(); // id -> intervalId

// ---------- Boot ----------
async function boot(){
  try{
    if(window.__token){
      const me=await api("/me");
      username=me.user; isAdmin=!!me.is_admin;
      localStorage.setItem("ytmp3_user",username);
      localStorage.setItem("ytmp3_admin",String(isAdmin));
      initAppUI(); show("view-app");
      await Promise.all([loadDownloads(), loadUsersList()]);
      wireStaticHandlers();
      return;
    }
  }catch{}
  resetLoginForm(); show("view-login"); wireStaticHandlers();
}
boot();

// ---------- Auth ----------
async function handleLogin(e){
  if(e) e.preventDefault();
  clearText($("login-msg"));
  const u=$("login-username").value.trim(), p=$("login-password").value;
  if(!u||!p){ text($("login-msg"),"Please enter username and password."); return; }
  try{
    const data=await api("/login",{method:"POST",body:JSON.stringify({username:u,password:p})});
    window.__token=data.token; username=data.user; isAdmin=!!data.is_admin;
    if(!ALWAYS_REQUIRE_LOGIN){
      localStorage.setItem("ytmp3_token",window.__token);
      localStorage.setItem("ytmp3_user",username);
      localStorage.setItem("ytmp3_admin",String(isAdmin));
    }
    initAppUI(); show("view-app");
    $("yt-url") && ($("yt-url").value="");
    await Promise.all([loadDownloads(), loadUsersList()]);
  }catch(err){ text($("login-msg"),err.message); }
}
has("btn-login") && $("btn-login").addEventListener("click", handleLogin);
has("login-form") && $("login-form").addEventListener("submit", handleLogin);

has("link-to-register") && $("link-to-register").addEventListener("click", ()=>{ resetRegisterForm(); show("view-register"); $("reg-username")?.focus(); });
has("link-to-login") && $("link-to-login").addEventListener("click", ()=>{ resetLoginForm(); show("view-login"); });
has("link-to-reset") && $("link-to-reset").addEventListener("click", ()=>{ show("view-reset"); });
has("reset-back") && $("reset-back").addEventListener("click", ()=>{ show("view-login"); });

has("register-form") && $("register-form").addEventListener("submit", async (e)=>{
  e.preventDefault(); clearText($("register-msg")); clearText($("register-ok"));
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
  e.preventDefault(); clearText($("reset-msg")); clearText($("reset-ok"));
  const u=$("reset-username").value.trim(), w=$("reset-word").value.trim(), np=$("reset-new").value;
  if(!u||!w||!np){ text($("reset-msg"),"Fill out all fields."); return; }
  try{
    await api("/self_reset",{method:"POST",body:JSON.stringify({username:u,word:w,new_password:np})});
    text($("reset-ok"),"Password changed. You can log in now.");
  }catch(err){ text($("reset-msg"), err.message); }
});

// ---------- Static handlers ----------
function wireStaticHandlers(){
  has("btn-logout") && $("btn-logout").addEventListener("click", ()=>{
    for (const id of pollers.keys()){ clearInterval(pollers.get(id)); }
    pollers.clear();
    window.__token=""; username=""; isAdmin=false; fileId=null; filename=null;
    localStorage.removeItem("ytmp3_token");
    localStorage.removeItem("ytmp3_user");
    localStorage.removeItem("ytmp3_admin");
    $("yt-url") && ($("yt-url").value="");

    // purge any autofill and bounce to login
    show("view-login");
  });

  has("btn-admin") && $("btn-admin").addEventListener("click", openAdminPanel);
  has("admin-close") && $("admin-close").addEventListener("click", closeAdminPanel);

  has("drawerClose") && $("drawerClose").addEventListener("click", drawerClose);
  $("drawerOverlay")?.addEventListener("click", drawerClose);

  has("btn-download") && $("btn-download").addEventListener("click", onConvert);
  has("btn-status")   && $("btn-status").addEventListener("click", onCheckStatus);
  has("btn-get")      && $("btn-get").addEventListener("click", onGetDirect);

  has("toggle-all") && $("toggle-all").addEventListener("change", loadDownloads);
}

// Mobile sidebar controls
(function(){
  const btn = document.getElementById("mobileSidebarBtn");
  const side = document.getElementById("rightSidebar");
  const close = document.getElementById("rightSidebarClose");
  const overlay = document.getElementById("drawerOverlay"); // you already have this

  function openSide(){
    if (!side) return;
    side.classList.add("mobile-open");
    overlay && overlay.classList.add("open");
  }
  function closeSide(){
    if (!side) return;
    side.classList.remove("mobile-open");
    overlay && overlay.classList.remove("open");
  }

  btn && btn.addEventListener("click", openSide);
  close && close.addEventListener("click", closeSide);
  overlay && overlay.addEventListener("click", closeSide);

  // Optional: close on ESC
  window.addEventListener("keydown", (e)=>{
    if (e.key === "Escape") closeSide();
  });
})();


// ---------- App UI ----------
function initAppUI(){
  $("whoami") && ( $("whoami").textContent = username ? `Logged in as ${username}` : "" );
  $("btn-get") && ( $("btn-get").disabled = true );
  const sb=$("rightSidebar"); if(sb) sb.style.display="block";
  const badge=$("youBadge"); if(badge) badge.textContent=username || "you";
  const ab=$("btn-admin"); if(ab) ab.style.display=isAdmin ? "" : "none";

  const wrap = $("showAllWrap");
  const chk  = $("toggle-all");
  if (wrap) wrap.style.display = isAdmin ? "flex" : "none";
  if (!isAdmin && chk) {
    chk.checked = false;            // ensure off for non-admin
    chk.disabled = true;            // prevent tabbing/interactions
  } else if (isAdmin && chk) {
    chk.disabled = false;
  }
}

// ---------- Downloads grid ----------
async function loadDownloads(){
  const grid=$("myDownloadsGrid"); if(!grid) return;
  grid.innerHTML="<div class='dlCard'>Loading…</div>";
  for (const id of pollers.keys()){ clearInterval(pollers.get(id)); }
  pollers.clear();

  try{
    const showAll = isAdmin && $("toggle-all")?.checked;
    const endpoint = showAll ? "/videos" : "/my_downloads";
    const items = await api(endpoint);

    __downloadsCache = items || [];
    renderDownloads(); // render with current __searchTerm
  }catch(e){
    grid.innerHTML=`<div class='dlCard'>${escapeHtml(e.message)}</div>`;
  }
}

function renderDownloads(){
  const grid = $("myDownloadsGrid"); if(!grid) return;

  const showAll = isAdmin && $("toggle-all")?.checked;
  const term = __searchTerm;

  const items = (__downloadsCache || []).filter(it => {
    if (!term) return true;
    const title = (it.filename || "").toLowerCase();
    const owner = (it.owner_username || "").toLowerCase();
    return title.includes(term) || owner.includes(term);  // case-insensitive
  });

  if(!items.length){
    grid.innerHTML="<div class='dlCard'><div class='dlTitle'>No downloads yet</div><div class='dlMeta'>Start by pasting a YouTube URL below.</div></div>";
    return;
  }

  grid.innerHTML = items.map(it=>{
    const ts=new Date(it.timestamp).toLocaleString();
    const fname=it.filename||"(processing)";
    const ready = it.status==="ready";
    const disabled = ready ? "" : "disabled";
    const owner = showAll && it.owner_username && it.owner_username!==username ? ` • by ${escapeHtml(it.owner_username)}` : "";
    const allowDelete = (it.owner_username ? (it.owner_username===username || isAdmin) : true);
    const delDisabled = allowDelete ? "" : "disabled";

    return `
      <div class="dlCard" id="dl-${it.id}">
        <div class="dlTitle">${escapeHtml(fname)}</div>
        <div class="dlMeta">${ts} • Status: ${escapeHtml(it.status)}${owner}</div>
        <div class="btnRow">
          <button type="button" class="btnSmall js-status"   data-id="${it.id}">Status</button>
          <button type="button" class="btnSmall primary js-download" data-id="${it.id}" data-fname="${encodeURIComponent(fname)}" ${disabled}>Download</button>
          <button type="button" class="btnSmall js-delete"   data-id="${it.id}" ${delDisabled}>Delete</button>
        </div>
      </div>`;
  }).join("");

  grid.querySelectorAll(".js-status").forEach(b => b.addEventListener("click", () => checkOne(b.dataset.id)));
  grid.querySelectorAll(".js-download").forEach(b => b.addEventListener("click", () => {
    const url = `${API}/download/${encodeURIComponent(b.dataset.id)}?token=${encodeURIComponent(window.__token||"")}`;
    const fname = b.dataset.fname ? decodeURIComponent(b.dataset.fname) : "download.mp3";
    startDownload(url, fname);
  }));
  grid.querySelectorAll(".js-delete").forEach(b => b.addEventListener("click", () => deleteOne(b.dataset.id)));

  // restart pollers for non-ready items currently visible
  for (const id of pollers.keys()){ clearInterval(pollers.get(id)); }
  pollers.clear();
  items.filter(x => x.status !== "ready").forEach(x => startPoller(x.id));
}


function startPoller(id){
  if (pollers.has(id)) return;
  const int = setInterval(async ()=>{
    try{
      const st = await api(`/status/${id}`);
      if (st && st.ready){
        clearInterval(int);
        pollers.delete(id);
        await loadDownloads();
      }
    }catch{
      clearInterval(int);
      pollers.delete(id);
    }
  }, 2500);
  pollers.set(id, int);
}

async function checkOne(id){
  try{
    const st=await api(`/status/${id}`);
    if(st.ready){
      text($("app-ok"),"The link is ready for the download.");
      $("yt-url") && ($("yt-url").value="");
    }else{
      text($("app-ok"),"Still processing…");
    }
    await loadDownloads();
  }catch(e){ alert(e.message); }
}
async function deleteOne(id){
  try{
    await api(`/delete/${id}`,{method:"DELETE"});
    await loadDownloads();
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
    text($("app-ok"),"Processing started…");
    startPoller(fileId);
    await loadDownloads();
  }catch(e){ text($("app-msg"), e.message); }
}
async function onCheckStatus(){
  clearText($("app-msg")); clearText($("app-ok"));
  if(!fileId){ text($("app-msg"),"No file ID yet."); return; }
  try{
    const data=await api(`/status/${fileId}`);
    if(data.ready){ $("yt-url") && ( $("yt-url").value="" ); text($("app-ok"),"The link is ready for the download."); }
    else text($("app-ok"),"Still processing…");
    await loadDownloads();
  }catch(e){ text($("app-msg"), e.message); }
}
async function onGetDirect(){
  clearText($("app-msg")); clearText($("app-ok"));
  if(!fileId||!filename){ text($("app-msg"),"Nothing to download yet."); return; }
  const url = `${API}/download/${encodeURIComponent(fileId)}?token=${encodeURIComponent(window.__token||"")}`;
  try { await startDownload(url, filename); } catch(e){ text($("app-msg"), e.message); }
}

// ---------- Users sidebar + drawer ----------
async function loadUsersList(){  // now: fetch users + index downloads into the panel
  const box = $("searchResults"), search = $("userSearch");
  if (!box) return;
  box.innerHTML = `<div class="resultItem"><span class="resultMeta">Loading…</span></div>`;

  try{
    // everyone can see users
    __usersCache = await api("/users");

    // downloads to search:
    // - admin: ALL via /videos
    // - non-admin: only own via /my_downloads
    __downloadsCache = await api("/videos");
    renderSearchResults(); // initial render
  }catch(e){
    box.innerHTML = `<div class="resultItem"><span class="resultMeta">${escapeHtml(e.message)}</span></div>`;
    return;
  }

  if (search) {
    search.placeholder = "Search user or title…";
    search.addEventListener("input", ()=>{
      __searchTerm = (search.value || "").trim().toLowerCase();
      renderSearchResults();
    });
  }
}

function groupByTitle(videos){
  const groups = new Map();
  for (const v of videos){
    const key = (v.filename || "").trim().toLowerCase();
    if (!key) continue;
    const g = groups.get(key) || { title: v.filename, items: [] };
    g.items.push(v);
    groups.set(key, g);
  }
  const reps = [];
  groups.forEach(g => {
    const byTime = (a,b)=> new Date(b.timestamp) - new Date(a.timestamp);
    const ready = g.items.filter(i => i.status === "ready").sort(byTime);
    const pick  = ready[0] || g.items.sort(byTime)[0];  // prefer READY, else newest
    const owners = Array.from(new Set(g.items.map(i => i.owner_username).filter(Boolean)));
    reps.push({
      ...pick,
      __copies: g.items.length,
      __owners: owners
    });
  });
  reps.sort((a,b)=> new Date(b.timestamp) - new Date(a.timestamp));
  return reps;
}

function renderSearchResults(){
  const box = $("searchResults"); if(!box) return;
  const term = __searchTerm;

  const users = (__usersCache || []).filter(u =>
    !term || (u.username||"").toLowerCase().includes(term)
  );

  // filter first
  const filteredVideos = (__downloadsCache || []).filter(v => {
    if (!term) return true;
    const title = (v.filename || "").toLowerCase();
    const owner = (v.owner_username || "").toLowerCase();
    return title.includes(term) || owner.includes(term);
  });

  // 👇 when searching, dedupe by title; otherwise keep full list
  const videos = term ? groupByTitle(filteredVideos) : filteredVideos;

  // Build HTML
  const userHtml = users.length
    ? `<div class="resultMeta">Users (${users.length})</div>` +
      users.map(u => `
        <div class="resultItem" data-user="${escapeHtml(u.username)}">
          <span>${escapeHtml(u.username)}</span>
          ${u.username===username?'<span class="badge">you</span>':''}
        </div>`).join("")
    : "";

  const vidHtml = videos.length
    ? `<div class="resultMeta" style="margin-top:6px;">Downloads (${videos.length}${isAdmin?' • all':''}${term?' • deduped':''})</div>` +
      videos.map(v=>{
        const ts = new Date(v.timestamp).toLocaleString();
        const copies = v.__copies && v.__copies > 1 ? ` • ${v.__copies} copies` : "";
        // if grouped, show number of owners; else show the single owner
        const ownerBadge = v.__owners
          ? (v.__owners.length > 1
              ? ` • ${v.__owners.length} users`
              : (v.__owners[0] ? ` • by ${escapeHtml(v.__owners[0])}` : ""))
          : (v.owner_username ? ` • by ${escapeHtml(v.owner_username)}` : "");
        const ready = v.status === "ready";
        const dlBtn = ready
          ? `<button type="button" class="btnTiny primary" data-dla="${v.id}" data-fname="${encodeURIComponent(v.filename||'download.mp3')}">Download</button>`
          : `<button type="button" class="btnTiny" disabled>Processing</button>`;
        return `
          <div class="resultCard">
            <div class="resultTitle">${escapeHtml(v.filename || "(processing)")}</div>
            <div class="resultMeta">${ts} • Status: ${escapeHtml(v.status)}${ownerBadge}${copies}</div>
            <div class="resultBtns">
              <button type="button" class="btnTiny" data-sta="${v.id}">Status</button>
              ${dlBtn}
            </div>
          </div>`;
      }).join("")
    : "";

  const emptyHtml = (!userHtml && !vidHtml)
    ? `<div class="resultItem"><span class="resultMeta">No matches.</span></div>`
    : "";

  box.innerHTML = userHtml + vidHtml + emptyHtml;

  // wire actions
  box.querySelectorAll("[data-user]").forEach(el=>{
    el.addEventListener("click", ()=> openUserDrawer(el.getAttribute("data-user")));
  });
  box.querySelectorAll("[data-sta]").forEach(el=>{
    el.addEventListener("click", async ()=>{
      try { const st = await api(`/status/${el.getAttribute("data-sta")}`); alert(st.ready ? "Ready" : "Still processing…"); }
      catch(e){ alert(e.message); }
    });
  });
  box.querySelectorAll("[data-dla]").forEach(el=>{
    el.addEventListener("click", ()=>{
      const id = el.getAttribute("data-dla");
      const fname = el.getAttribute("data-fname") ? decodeURIComponent(el.getAttribute("data-fname")) : "download.mp3";
      const url = `${API}/download/${encodeURIComponent(id)}?token=${encodeURIComponent(window.__token||"")}`;
      startDownload(url, fname);
    });
  });
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
    if (!users.length) {
      tbody.innerHTML = `<tr><td class="center" colspan="5">No users.</td></tr>`;
      return;
    }
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

    tbody.querySelectorAll(".js-adm-set").forEach(b => b.addEventListener("click", async ()=>{
      const row  = b.closest("tr");
      const input = row.querySelector("input[data-role='temp-pw']");
      const pw = (input?.value || "").trim();
      try {
        const res = await api(`/users/${encodeURIComponent(b.dataset.user)}/reset_password`, {
          method: "POST", body: JSON.stringify({ new_password: pw || null, generate: !pw })
        });
        // show the *new* password once so admin can pass it to the user
        alert(`Password for "${b.dataset.user}" set to:\n\n${res.temp_password}`);
        await renderAdminTable();
      } catch (err) { alert(err.message); }
    }));
    tbody.querySelectorAll(".js-adm-del").forEach(b => b.addEventListener("click", async ()=>{
      const user = b.dataset.user;
      if (!confirm(`Delete user "${user}" and all their downloads?`)) return;
      try {
        await api(`/admin/delete_user/${encodeURIComponent(user)}`, { method: "DELETE" });
        await Promise.all([renderAdminTable(), loadUsersList(), loadDownloads()]);
      } catch (err) { alert(err.message); }
    }));
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="5" class="center">${escapeHtml(e.message)}</td></tr>`;
  }
}