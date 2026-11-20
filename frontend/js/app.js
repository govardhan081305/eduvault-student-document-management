  const CATEGORIES = ["Marksheet", "Certificate", "ID Proof", "Fee Receipt", "Other"];
  const CAT_COLORS = { "Marksheet": "#4f46e5", "Certificate": "#16a34a", "ID Proof": "#ea580c", "Fee Receipt": "#0d9488", "Other": "#64748b" };
  const QUOTA = 100 * 1024 * 1024;
  let session = null, docs = [], activeCat = "All";

  // ---------- utilities ----------
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtSize = b => b < 1024 ? b + " B" : b < 1048576 ? (b / 1024).toFixed(1) + " KB" : (b / 1048576).toFixed(2) + " MB";
  const toDate = s => new Date(/UTC$/.test(s) ? s.replace(" UTC", "Z").replace(" ", "T") : s);
  const fmtDate = iso => toDate(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const timeAgo = iso => { const s = (Date.now() - toDate(iso)) / 1000;
    if (s < 60) return "just now"; if (s < 3600) return Math.floor(s / 60) + " min ago";
    if (s < 86400) return Math.floor(s / 3600) + " hr ago"; return Math.floor(s / 86400) + " days ago"; };
  function ftype(d) {
    const n = d.fileName.toLowerCase();
    if (n.endsWith(".pdf")) return '<div class="ftype pdf">PDF</div>';
    if (/\.(jpg|jpeg|png|gif|webp)$/.test(n)) return '<div class="ftype img">IMG</div>';
    return '<div class="ftype doc">DOC</div>';
  }
  const badge = c => `<span class="badge" style="background:${CAT_COLORS[c]}1a;color:${CAT_COLORS[c]}">${esc(c)}</span>`;
  function toast(text, err) {
    const t = document.createElement("div"); t.className = "toast" + (err ? " err" : ""); t.textContent = text;
    $("toasts").appendChild(t); setTimeout(() => t.remove(), 3500);
  }
  function store(key, value) { try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(value)); } catch (e) {} }
  function load(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } }

  async function api(body) {
    if (API.includes("YOUR_LAMBDA")) throw new Error("Paste your Lambda Function URL into index.html first");
    if (session) body.token = session.token;
    const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    let data = {}; try { data = await res.json(); } catch (e) {}
    if (res.status === 401 && session) { logout(); throw new Error("Session expired. Please log in again."); }
    if (!res.ok) throw new Error(data.error || data.Message || "Request failed (" + res.status + ")");
    return data;
  }

  // ---------- auth ----------
  function showAuthTab(tab) {
    const login = tab === "login";
    $("loginForm").classList.toggle("hidden", !login); $("registerForm").classList.toggle("hidden", login);
    $("tabLogin").classList.toggle("active", login); $("tabRegister").classList.toggle("active", !login);
    $("authTitle").textContent = login ? "Welcome back" : "Create your account";
    $("authSub").textContent = login ? "Log in to access your documents" : "Register to start storing your documents";
    $("authError").classList.add("hidden");
  }
  function authError(msg) { $("authError").textContent = msg; $("authError").classList.remove("hidden"); }
  function busy(btn, on, label) { btn.disabled = on; btn.innerHTML = on ? '<div class="spinner"></div>' : label; }

  async function doLogin(e) {
    e.preventDefault(); const btn = $("loginBtn"); busy(btn, true);
    try { startSession(await api({ action: "login", studentId: $("loginId").value, password: $("loginPass").value })); }
    catch (err) { authError(err.message); } finally { busy(btn, false, "Log In"); }
  }
  async function doRegister(e) {
    e.preventDefault();
    if ($("regPass").value !== $("regPass2").value) { authError("Passwords do not match"); return; }
    const btn = $("registerBtn"); busy(btn, true);
    try {
      startSession(await api({ action: "register", name: $("regName").value, studentId: $("regId").value,
        email: $("regEmail").value, department: $("regDept").value, password: $("regPass").value }));
      toast("Account created successfully. Welcome!");
    } catch (err) { authError(err.message); } finally { busy(btn, false, "Create Account"); }
  }
  function startSession(data) {
    session = data; store("eduvault_session", data);
    const u = data.user, initial = (u.name || "S").trim().charAt(0).toUpperCase();
    $("avatar").textContent = initial; $("pfAvatar").textContent = initial;
    $("chipName").textContent = u.name; $("chipId").textContent = u.studentId;
    $("pfName").textContent = u.name; $("pfId").textContent = u.studentId;
    $("pfEmail").textContent = u.email || "-"; $("pfDept").textContent = u.department || "";
    $("authView").classList.add("hidden"); $("appView").classList.remove("hidden");
    showView("dashboard"); loadDocs();
  }
  function logout() {
    session = null; docs = []; store("eduvault_session", null);
    $("appView").classList.add("hidden"); $("authView").classList.remove("hidden");
    $("loginPass").value = ""; showAuthTab("login");
  }

  // ---------- navigation ----------
  const TITLES = {
    dashboard: ["Dashboard", () => `Welcome back, ${session ? session.user.name.split(" ")[0] : ""}! Here is your document overview.`],
    documents: ["My Documents", () => "Search, preview, download and manage your files"],
    upload: ["Upload Documents", () => "Add new documents to your secure cloud vault"],
    profile: ["My Profile", () => "Your account details and security information"]
  };
  function showView(v) {
    ["dashboard", "documents", "upload", "profile"].forEach(x => $("view-" + x).classList.toggle("hidden", x !== v));
    document.querySelectorAll(".nav button[data-view]").forEach(b => b.classList.toggle("active", b.dataset.view === v));
    $("pageTitle").textContent = TITLES[v][0]; $("pageSub").textContent = TITLES[v][1]();
  }

  // ---------- data ----------
  async function loadDocs() {
    $("recentList").innerHTML = '<div class="spinner dark"></div>';
    $("docTable").innerHTML = '<tr><td colspan="5"><div class="spinner dark"></div></td></tr>';
    try { docs = (await api({ action: "list" })).documents; renderAll(); }
    catch (err) { toast(err.message, true); docs = []; renderAll(); }
  }
  function renderAll() { renderStats(); renderRecent(); renderCategories(); renderChips(); renderTable(); }

  function renderStats() {
    const total = docs.reduce((s, d) => s + d.size, 0), cats = new Set(docs.map(d => d.category)).size;
    const pct = Math.min(100, total / QUOTA * 100);
    $("stTotal").textContent = docs.length; $("stStorage").textContent = fmtSize(total);
    $("stCats").textContent = cats + " / 5"; $("stLast").textContent = docs[0] ? timeAgo(docs[0].uploadedAt) : "—";
    $("miniUsed").textContent = fmtSize(total); $("miniBar").style.width = Math.max(pct, docs.length ? 2 : 0) + "%";
    $("pfDocs").textContent = docs.length; $("pfStorage").textContent = fmtSize(total);
  }
  function renderRecent() {
    if (!docs.length) { $("recentList").innerHTML = `<div class="empty"><div class="big">&#128194;</div>No documents yet.<br><br>
      <button class="btn btn-primary" onclick="showView('upload')">Upload your first document</button></div>`; return; }
    $("recentList").innerHTML = docs.slice(0, 5).map(d => `<div class="recent-item">${ftype(d)}
      <div class="info"><div class="fname">${esc(d.fileName)}</div><div class="meta">${esc(d.category)} &middot; ${fmtSize(d.size)} &middot; ${timeAgo(d.uploadedAt)}</div></div>
      <button class="icon-btn" title="Preview" onclick="openDoc('${d.docId}','view')">${ICON.eye}</button></div>`).join("");
  }
  function renderCategories() {
    const max = Math.max(1, ...CATEGORIES.map(c => docs.filter(d => d.category === c).length));
    $("catBreakdown").innerHTML = CATEGORIES.map(c => { const n = docs.filter(d => d.category === c).length;
      return `<div class="cat-row"><div class="top"><span>${c}</span><b>${n}</b></div>
        <div class="bar"><div style="width:${n / max * 100}%;background:${CAT_COLORS[c]}"></div></div></div>`; }).join("");
  }
  function renderChips() {
    $("chips").innerHTML = ["All", ...CATEGORIES].map(c => { const n = c === "All" ? docs.length : docs.filter(d => d.category === c).length;
      return `<button class="chip ${activeCat === c ? "active" : ""}" onclick="setCat('${c}')">${c} (${n})</button>`; }).join("");
  }
  function setCat(c) { activeCat = c; renderChips(); renderTable(); }
  function renderTable() {
    const q = $("searchBox").value.trim().toLowerCase(), sort = $("sortBy").value;
    let list = docs.filter(d => (activeCat === "All" || d.category === activeCat) && d.fileName.toLowerCase().includes(q));
    list.sort((a, b) => sort === "old" ? a.docId.localeCompare(b.docId) : sort === "name" ? a.fileName.localeCompare(b.fileName)
      : sort === "size" ? b.size - a.size : b.docId.localeCompare(a.docId));
    if (!list.length) { $("docTable").innerHTML = `<tr><td colspan="5"><div class="empty"><div class="big">&#128269;</div>
      ${docs.length ? "No documents match your search." : "You have not uploaded any documents yet."}</div></td></tr>`; return; }
    $("docTable").innerHTML = list.map(d => `<tr>
      <td><div class="file-cell">${ftype(d)}<div class="fname" title="${esc(d.fileName)}">${esc(d.fileName)}</div></div></td>
      <td>${badge(d.category)}</td><td class="hide-sm">${fmtSize(d.size)}</td><td class="hide-sm">${fmtDate(d.uploadedAt)}</td>
      <td><div class="actions">
        <button class="icon-btn" title="Preview" onclick="openDoc('${d.docId}','view')">${ICON.eye}</button>
        <button class="icon-btn" title="Download" onclick="openDoc('${d.docId}','download')">${ICON.down}</button>
        <button class="icon-btn del" title="Delete" onclick="askDelete('${d.docId}')">${ICON.trash}</button>
      </div></td></tr>`).join("");
  }

  // ---------- actions ----------
  async function openDoc(docId, mode) {
    const win = mode === "view" ? window.open("", "_blank") : null;
    try {
      const { url } = await api({ action: mode, docId });
      if (win) win.location.href = url; else window.location.href = url;
    } catch (err) { if (win) win.close(); toast(err.message, true); }
  }
  function askDelete(docId) {
    const d = docs.find(x => x.docId === docId); if (!d) return;
    $("modalText").textContent = `"${d.fileName}" will be permanently removed from cloud storage.`;
    $("modal").classList.remove("hidden");
    $("modalConfirm").onclick = async () => {
      busy($("modalConfirm"), true);
      try { await api({ action: "delete", docId }); toast("Document deleted"); closeModal(); loadDocs(); }
      catch (err) { toast(err.message, true); } finally { busy($("modalConfirm"), false, "Delete"); }
    };
  }
  function closeModal() { $("modal").classList.add("hidden"); }

  // ---------- upload ----------
  const dz = $("dropzone");
  ["dragenter", "dragover"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add("drag"); }));
  ["dragleave", "drop"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove("drag"); }));
  dz.addEventListener("drop", e => handleFiles(e.dataTransfer.files));

  async function handleFiles(files) {
    const list = Array.from(files); $("fileInput").value = "";
    let ok = 0;
    for (const f of list) { if (await uploadOne(f)) ok++; }
    if (ok) { toast(`${ok} document${ok > 1 ? "s" : ""} uploaded successfully`); loadDocs(); }
  }
  async function uploadOne(file) {
    const row = document.createElement("div"); row.className = "queue-item";
    row.innerHTML = `${ftype({ fileName: file.name })}<div class="info"><div class="fname" style="font-weight:600">${esc(file.name)}</div>
      <div style="color:var(--muted);font-size:12px">${fmtSize(file.size)} &middot; <span class="st">Preparing...</span></div>
      <div class="progress"><div></div></div></div>`;
    $("queue").prepend(row);
    const st = row.querySelector(".st"), bar = row.querySelector(".progress div");
    const fail = msg => { st.className = "status-err"; st.textContent = msg; bar.style.background = "var(--red)"; bar.style.width = "100%"; return false; };
    if (file.size > 10 * 1024 * 1024) return fail("Too large (max 10 MB)");
    if (file.size === 0) return fail("File is empty");
    try {
      const data = await api({ action: "upload", fileName: file.name, contentType: file.type || "application/octet-stream",
        category: $("upCategory").value, size: file.size });
      const form = new FormData();
      Object.entries(data.upload.fields).forEach(([k, v]) => form.append(k, v));
      form.append("file", file);
      st.textContent = "Uploading...";
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", data.upload.url);
        xhr.upload.onprogress = e => { if (e.lengthComputable) { const p = Math.round(e.loaded / e.total * 100); bar.style.width = p + "%"; st.textContent = "Uploading " + p + "%"; } };
        xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("Storage error " + xhr.status));
        xhr.onerror = () => reject(new Error("Network/CORS error"));
        xhr.send(form);
      });
      bar.style.width = "100%"; bar.style.background = "var(--green)"; st.className = "status-ok"; st.textContent = "Uploaded";
      return true;
    } catch (err) { return fail(err.message); }
  }

  const ICON = {
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>'
  };

  // ---------- start ----------
  const saved = load("eduvault_session");
  if (saved && saved.token) startSession(saved);
