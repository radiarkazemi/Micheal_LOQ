const { app, BrowserWindow, Tray, Menu, nativeImage, shell, session } = require("electron");
const path = require("node:path");

const isDev = !app.isPackaged;
const DEV_URL = process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5174";
const CLOUD_HUD =
  process.env.MICHEAL_CLOUD_HUD || "http://91.107.171.162:8787/";

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {Tray | null} */
let tray = null;
let quitting = false;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showWindow();
  });
}

function trayIcon() {
  const iconPath = path.join(__dirname, "icon.png");
  const img = nativeImage.createFromPath(iconPath);
  return img.isEmpty() ? nativeImage.createEmpty() : img;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: "#05070d",
    title: "Micheal",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  // Prefer live cloud HUD so Windows always mirrors the Germany brain.
  const target = isDev ? DEV_URL : CLOUD_HUD;
  void mainWindow.loadURL(target).catch(() => {
    if (!isDev) {
      void mainWindow?.loadFile(path.join(__dirname, "../dist/index.html"));
    }
  });

  mainWindow.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function showWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip("Micheal — always live");
  const menu = Menu.buildFromTemplate([
    { label: "Show Micheal", click: () => showWindow() },
    {
      label: "Open in browser (live HUD)",
      click: () => void shell.openExternal(CLOUD_HUD),
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.on("double-click", () => showWindow());
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === "media" || permission === "mediaKeySystem" || permission === "notifications");
  });

  createWindow();
  createTray();

  if (process.platform === "win32") {
    app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true });
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showWindow();
  });
});

app.on("before-quit", () => {
  quitting = true;
});

app.on("window-all-closed", () => {
  // Keep tray alive on Windows/Linux — only quit via tray menu.
  if (process.platform === "darwin") app.quit();
});
