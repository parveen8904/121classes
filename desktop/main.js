// Electron main process. Handles the privileged work the renderer must not do:
// downloading the encrypted .enc file and decrypting it with the server-issued
// key. Decrypted bytes are written to a temp file only while playing, then wiped.
const { app, BrowserWindow, ipcMain } = require("electron");
const { createDecipheriv } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const { Readable, Transform } = require("node:stream");

const { pathToFileURL } = require("node:url");
let tmpToWipe = [];
const decrypted = new Map(); // id -> decrypted temp path (cached per session)

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.once("ready-to-show", () => {
    win.show();
    win.focus();
  });
}

function classPath(id) {
  return path.join(app.getPath("userData"), "classes", `${id}.enc`);
}

// Download the encrypted file atomically: stream to a .part file, verify the
// final size matches what the server expects, then rename. Reports progress.
ipcMain.handle("download", async (e, { id, url, expectedSize }) => {
  const dir = path.join(app.getPath("userData"), "classes");
  fs.mkdirSync(dir, { recursive: true });
  const dest = classPath(id);
  const part = dest + ".part";

  // Already fully downloaded?
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

// Decrypt the .enc file with the server-issued key/iv into a temp playable file.
// Cached per session (so replays are instant) and written atomically.
ipcMain.handle("decrypt", async (_e, { id, keyB64, ivB64, alg }) => {
  const cached = decrypted.get(id);
  if (cached && fs.existsSync(cached)) return pathToFileURL(cached).href;

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
  return pathToFileURL(out).href;
});

// Best-effort wipe of decrypted temp files on quit.
app.on("before-quit", () => {
  for (const f of tmpToWipe) {
    try { fs.unlinkSync(f); } catch {}
  }
});

app.whenReady().then(() => {
  createWindow();
  app.focus({ steal: true });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
