// Electron main process. The window loads the FULL website; the preload exposes
// a small native bridge (download/decrypt/play) so the site's Downloads page can
// save encrypted classes and play them offline in a local player window.
const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const { createDecipheriv } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const { Readable, Transform } = require("node:stream");
const { pathToFileURL } = require("node:url");

const WEB = process.env.CA_WEB || "https://caparveensharma.com";
const tmpToWipe = [];
const decrypted = new Map(); // id -> decrypted temp path (cached per session)

function classPath(id) {
  return path.join(app.getPath("userData"), "classes", `${id}.enc`);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadURL(WEB + "/dashboard");
  win.once("ready-to-show", () => {
    win.show();
    win.focus();
  });
}

// Download the encrypted file atomically: stream to .part, verify the size,
// then rename. Reports progress to the page.
ipcMain.handle("download", async (e, { id, url, expectedSize }) => {
  const dir = path.join(app.getPath("userData"), "classes");
  fs.mkdirSync(dir, { recursive: true });
  const dest = classPath(id);
  const part = dest + ".part";
  if (fs.existsSync(dest) && (!expectedSize || fs.statSync(dest).size === expectedSize)) return dest;

  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error("download failed (HTTP " + res.status + ")");
  const total = expectedSize || Number(res.headers.get("content-length")) || 0;
  let received = 0;
  let lastSent = 0;
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      received += chunk.length;
      if (total && received - lastSent > 8 * 1024 * 1024) {
        lastSent = received;
        e.sender.send("download-progress", { id, received, total });
      }
      cb(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(part));
  const size = fs.statSync(part).size;
  if (expectedSize && size !== expectedSize) {
    try { fs.unlinkSync(part); } catch {}
    throw new Error(`incomplete download: got ${size} of ${expectedSize} bytes — please retry`);
  }
  fs.renameSync(part, dest);
  e.sender.send("download-progress", { id, received: size, total: size });
  return dest;
});

ipcMain.handle("is-downloaded", async (_e, { id, expectedSize }) => {
  const p = classPath(id);
  return fs.existsSync(p) && (!expectedSize || fs.statSync(p).size === expectedSize);
});

async function decryptToFile(id, keyB64, ivB64, alg) {
  const cached = decrypted.get(id);
  if (cached && fs.existsSync(cached)) return cached;
  const enc = classPath(id);
  if (!fs.existsSync(enc)) throw new Error("not downloaded");
  const out = path.join(app.getPath("temp"), `play-${id}.mp4`);
  const part = out + ".part";
  const decipher = createDecipheriv(
    alg || "aes-256-cbc",
    Buffer.from(keyB64, "base64"),
    ivB64 ? Buffer.from(ivB64, "base64") : Buffer.alloc(16, 0),
  );
  await pipeline(fs.createReadStream(enc), decipher, fs.createWriteStream(part));
  fs.renameSync(part, out);
  decrypted.set(id, out);
  tmpToWipe.push(out);
  return out;
}

// Decrypt then play in a separate LOCAL player window (so the remote https page
// doesn't have to load a file:// video, which browsers block).
ipcMain.handle("play", async (_e, { id, keyB64, ivB64, alg, watermark }) => {
  const file = await decryptToFile(id, keyB64, ivB64, alg);
  const player = new BrowserWindow({ width: 1100, height: 720, title: "Class", backgroundColor: "#000" });
  const url =
    pathToFileURL(path.join(__dirname, "renderer", "player.html")).href +
    `?src=${encodeURIComponent(pathToFileURL(file).href)}&wm=${encodeURIComponent(watermark || "")}`;
  player.loadURL(url);
  return true;
});

app.on("before-quit", () => {
  for (const f of tmpToWipe) {
    try { fs.unlinkSync(f); } catch {}
  }
});

// Returns true if remote semver (e.g. "2.1.0") is newer than local.
function isNewer(remote, local) {
  const r = String(remote).split(".").map((n) => parseInt(n, 10) || 0);
  const l = String(local).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    if ((r[i] || 0) > (l[i] || 0)) return true;
    if ((r[i] || 0) < (l[i] || 0)) return false;
  }
  return false;
}

// On launch, ask the website what the latest app version is. If a newer build
// exists, show a friendly "Update available" prompt with a one-click download.
// Never blocks startup and fails silently if offline.
async function checkForUpdate() {
  try {
    const res = await fetch(WEB + "/api/app/version", { cache: "no-store" });
    if (!res.ok) return;
    const info = await res.json();
    const latest = info && info.version;
    if (!latest || !isNewer(latest, app.getVersion())) return;

    const url = process.platform === "darwin" ? info.mac : info.windows;
    if (!url) return;

    const { response } = await dialog.showMessageBox({
      type: "info",
      title: "Update available",
      message: `A new version of CA Parveen Sharma (v${latest}) is available.`,
      detail: (info.notes ? info.notes + "\n\n" : "") +
        "Click Download to get the latest version, then open the file and replace the app.",
      buttons: ["Download", "Later"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) await shell.openExternal(url);
  } catch {
    /* offline or no endpoint — ignore */
  }
}

app.whenReady().then(() => {
  createWindow();
  app.focus({ steal: true });
  setTimeout(checkForUpdate, 4000); // after the window has settled
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
