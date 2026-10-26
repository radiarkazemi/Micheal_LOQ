const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("michealDesktop", {
  platform: process.platform,
  isElectron: true,
  /** Prefer TradingView/Chrome window for live capture */
  pickCaptureSource: () => ipcRenderer.invoke("micheal:pick-source"),
  /** Fallback still frame (JPEG base64) */
  captureScreen: () => ipcRenderer.invoke("micheal:capture-screen"),
});
