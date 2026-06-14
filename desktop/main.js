// Electron main process. Handles the privileged work the renderer must not do:
// downloading the encrypted .enc file and decrypting it with the server-issued
// key. Decrypted bytes are written to a temp file only while playing, then wiped.
const { app, BrowserWindow, ipcMain, protocol } = require("electron");
const { createDecipheriv } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");

let tmpToWipe = [];

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

// Download the encrypted file to the app's cache and return the local path.
ipcMain.handle("download", async (_e, { id, url }) => {
  const dir = path.join(app.getPath("userData"), "classes");
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `${id}.enc`);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return dest;
  const res = await fetch(url);
  if (!res.ok) throw new Error("download failed");
  await pipeline(res.body, fs.createWriteStream(dest));
  return dest;
});

ipcMain.handle("is-downloaded", async (_e, { id }) => {
  const p = path.join(app.getPath("userData"), "classes", `${id}.enc`);
  return fs.existsSync(p) && fs.statSync(p).size > 0;
});

// Decrypt the .enc file with the server-issued key/iv into a temp playable file.
ipcMain.handle("decrypt", async (_e, { id, keyB64, ivB64, alg }) => {
  const enc = path.join(app.getPath("userData"), "classes", `${id}.enc`);
  if (!fs.existsSync(enc)) throw new Error("not downloaded");
  const out = path.join(app.getPath("temp"), `play-${id}-${Date.now()}.mp4`);
  const decipher = createDecipheriv(
    alg || "aes-256-cbc",
    Buffer.from(keyB64, "base64"),
    ivB64 ? Buffer.from(ivB64, "base64") : Buffer.alloc(16, 0),
  );
  await pipeline(fs.createReadStream(enc), decipher, fs.createWriteStream(out));
  tmpToWipe.push(out);
  return "file://" + out;
});

// Best-effort wipe of decrypted temp files on quit.
app.on("before-quit", () => {
  for (const f of tmpToWipe) {
    try { fs.unlinkSync(f); } catch {}
  }
});

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
