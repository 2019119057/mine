const { app, BrowserWindow, shell } = require("electron");
const { startHost } = require("./server");

let hostServer = null;
let mainWindow = null;

async function createWindow() {
  let url = "http://127.0.0.1:3417";

  try {
    const host = await startHost();
    hostServer = host.server;
    url = host.url;
  } catch (error) {
    if (error.code !== "EADDRINUSE") {
      throw error;
    }
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    title: "MC Java Host",
    backgroundColor: "#eef2ef",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  await mainWindow.loadURL(url);
}

app.whenReady().then(createWindow);

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
