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
      const downloaded = await window.native.isDownloaded(c.id, c.byte_size);
      const el = document.createElement("div");
      el.className = "card";
      el.innerHTML = `<div><strong>${c.title}</strong><div class="muted">${c.subject_title ?? ""} · ${(Number(c.byte_size) / 1e6).toFixed(0)} MB</div></div>`;
      const btns = document.createElement("div");
      const dl = document.createElement("button");
      dl.className = "btn sec";
      dl.textContent = downloaded ? "Downloaded ✓" : "Download";
      const play = document.createElement("button");
      play.className = "btn";
      play.textContent = "Play";
      play.style.marginLeft = "8px";
      play.disabled = !downloaded;
      play.onclick = () => playClass(c, play);

      // Live progress for this card.
      window.native.onProgress(({ id, received, total }) => {
        if (id !== c.id) return;
        const pct = total ? Math.floor((received * 100) / total) : 0;
        dl.textContent = pct >= 100 ? "Downloaded ✓" : `Downloading… ${pct}%`;
      });

      dl.onclick = async () => {
        dl.disabled = true;
        dl.textContent = "Downloading… 0%";
        try {
          await window.native.download(c.id, c.storage_url, c.byte_size);
          dl.textContent = "Downloaded ✓";
          play.disabled = false;
        } catch (err) {
          dl.textContent = "Retry download";
          alert("Download failed: " + err.message);
        } finally {
          dl.disabled = false;
        }
      };

      btns.append(dl, play);
      el.append(btns);
      $("list").append(el);
    }
  } catch (e) {
    $("libMsg").textContent = "Error: " + e.message;
  }
}

async function playClass(c, btn) {
  const label = btn ? btn.textContent : "Play";
  if (btn) { btn.disabled = true; btn.textContent = "Verifying…"; }
  try {
    // License = access re-check + the AES key (and who unlocked it, for the watermark).
    const { key, watermark } = await api("/api/app/license", { method: "POST", body: JSON.stringify({ id: c.id }) });
    if (btn) btn.textContent = "Decrypting… ⏳ (~1 min)";
    const fileUrl = await window.native.decrypt(c.id, key, c.iv_b64, c.alg);
    $("video").src = fileUrl;
    $("wm").textContent = watermark || "";
    $("player").classList.add("show");
    $("video").play().catch(() => {});
  } catch (e) {
    alert("Cannot play: " + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = label || "Play"; }
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
