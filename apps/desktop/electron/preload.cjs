const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("michealDesktop", {
  platform: process.platform,
  isElectron: true,
});
