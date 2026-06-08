const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow, dialog, shell } = require("electron");

let hostServer = null;
let mainWindow = null;
let logPath = null;

function log(message, error) {
  if (!logPath) return;
  const detail = error ? ` ${error.stack || error.message || error}` : "";
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}${detail}\n`);
}

function focusMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
  mainWindow.setAlwaysOnTop(true, "screen-saver");
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(false);
    }
  }, 900);
}

async function createWindow() {
  const userData = app.getPath("userData");
  logPath = path.join(userData, "desktop.log");
  process.env.MC_JAVA_HOST_HOME = userData;

  let url = "http://127.0.0.1:3417";

  try {
    const { startHost } = require("./server");
    const host = await startHost();
    hostServer = host.server;
    url = host.url;
    log(`Host started at ${url}`);
  } catch (error) {
    if (error.code !== "EADDRINUSE") {
      log("Failed to start host", error);
      throw error;
    }
    log(`Host port already in use; attaching to ${url}`);
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    title: "MC Java Host",
    backgroundColor: "#eef2ef",
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    shell.openExternal(targetUrl);
    return { action: "deny" };
  });

  mainWindow.webContents.on("did-fail-load", (_event, code, description) => {
    log(`Renderer failed to load: ${code} ${description}`);
  });

  await mainWindow.loadURL(url);
  focusMainWindow();
}

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", focusMainWindow);

  app.whenReady().then(createWindow).catch((error) => {
    log("App failed to start", error);
    dialog.showErrorBox("MC Java Host 실행 실패", error.stack || error.message || String(error));
    app.quit();
  });
}

app.on("window-all-closed", () => {
  if (hostServer) {
    hostServer.close();
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
