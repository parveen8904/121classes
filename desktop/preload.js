const { contextBridge, ipcRenderer } = require("electron");

// Safe bridge: the renderer can ask the main process to download/decrypt, but
// has no direct filesystem or crypto access.
contextBridge.exposeInMainWorld("native", {
  download: (id, url) => ipcRenderer.invoke("download", { id, url }),
  isDownloaded: (id) => ipcRenderer.invoke("is-downloaded", { id }),
  decrypt: (id, keyB64, ivB64, alg) => ipcRenderer.invoke("decrypt", { id, keyB64, ivB64, alg }),
});
