const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("michealDesktop", {
  platform: process.platform,
  isElectron: true,
  /** Capture TradingView window or primary screen as JPEG data URL */
  captureScreen: () => ipcRenderer.invoke("micheal:capture-screen"),
});
