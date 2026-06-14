const { contextBridge, ipcRenderer } = require("electron");

// Native bridge exposed to the loaded website. Lets the Downloads page save
// encrypted classes and play them offline. Present only in the desktop app —
// the website checks `window.native` to decide whether to show offline controls.
contextBridge.exposeInMainWorld("native", {
  isDesktopApp: true,
  download: (id, url, expectedSize) => ipcRenderer.invoke("download", { id, url, expectedSize }),
  isDownloaded: (id, expectedSize) => ipcRenderer.invoke("is-downloaded", { id, expectedSize }),
  play: (id, keyB64, ivB64, alg, watermark) => ipcRenderer.invoke("play", { id, keyB64, ivB64, alg, watermark }),
  onProgress: (cb) => ipcRenderer.on("download-progress", (_e, data) => cb(data)),
});
