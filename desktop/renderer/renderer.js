import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cfg = globalThis.APP_CONFIG;
const $ = (id) => document.getElementById(id);

if (!cfg || cfg.SUPABASE_ANON_KEY.startsWith("PASTE")) {
  $("loginMsg").textContent = "config.js missing or not filled in (copy config.example.js → config.js).";
}

const supabase = cfg ? createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
}) : null;

async function api(path, opts = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(cfg.API_BASE + path, {
    ...opts,
    headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

function show(view) {
  $("login").classList.toggle("hidden", view !== "login");
  $("library").classList.toggle("hidden", view !== "library");
}

async function loadLibrary() {
  show("library");
  $("libMsg").textContent = "Loading…";
  try {
    const { classes } = await api("/api/app/classes");
    $("libMsg").textContent = classes.length ? "" : "No downloadable classes available on your plan yet.";
    $("list").innerHTML = "";
    for (const c of classes) {
      const downloaded = await window.native.isDownloaded(c.id);
      const el = document.createElement("div");
      el.className = "card";
      el.innerHTML = `<div><strong>${c.title}</strong><div class="muted">${c.subject_title ?? ""}</div></div>`;
      const btns = document.createElement("div");
      const dl = document.createElement("button");
      dl.className = "btn sec";
      dl.textContent = downloaded ? "Downloaded ✓" : "Download";
      dl.onclick = async () => { dl.textContent = "Downloading…"; await window.native.download(c.id, c.storage_url); dl.textContent = "Downloaded ✓"; play.disabled = false; };
      const play = document.createElement("button");
      play.className = "btn";
      play.textContent = "Play";
      play.style.marginLeft = "8px";
      play.disabled = !downloaded;
      play.onclick = () => playClass(c);
      btns.append(dl, play);
      el.append(btns);
      $("list").append(el);
    }
  } catch (e) {
    $("libMsg").textContent = "Error: " + e.message;
  }
}

async function playClass(c) {
  try {
    // License = access re-check + the AES key (and who unlocked it, for the watermark).
    const { key, watermark } = await api("/api/app/license", { method: "POST", body: JSON.stringify({ id: c.id }) });
    const fileUrl = await window.native.decrypt(c.id, key, c.iv_b64, c.alg);
    $("video").src = fileUrl;
    $("wm").textContent = watermark || "";
    $("player").classList.add("show");
  } catch (e) {
    alert("Cannot play: " + e.message);
  }
}

$("loginBtn").onclick = async () => {
  $("loginMsg").textContent = "Signing in…";
  const { error } = await supabase.auth.signInWithPassword({ email: $("email").value, password: $("password").value });
  if (error) { $("loginMsg").textContent = error.message; return; }
  loadLibrary();
};
$("logoutBtn").onclick = async () => { await supabase.auth.signOut(); show("login"); };
$("closePlayer").onclick = () => { $("video").pause(); $("video").src = ""; $("player").classList.remove("show"); };

// Auto-resume an existing session.
if (supabase) supabase.auth.getSession().then(({ data: { session } }) => { if (session) loadLibrary(); });
