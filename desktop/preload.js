const { contextBridge, ipcRenderer } = require("electron");

// Safe bridge: the renderer can ask the main process to download/decrypt, but
// has no direct filesystem or crypto access.
contextBridge.exposeInMainWorld("native", {
  download: (id, url, expectedSize) => ipcRenderer.invoke("download", { id, url, expectedSize }),
  isDownloaded: (id, expectedSize) => ipcRenderer.invoke("is-downloaded", { id, expectedSize }),
  decrypt: (id, keyB64, ivB64, alg) => ipcRenderer.invoke("decrypt", { id, keyB64, ivB64, alg }),
  onProgress: (cb) => ipcRenderer.on("download-progress", (_e, data) => cb(data)),
});
