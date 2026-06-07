const els = {
  statusPill: document.getElementById("statusPill"),
  statusText: document.getElementById("statusText"),
  runningMetric: document.getElementById("runningMetric"),
  versionMetric: document.getElementById("versionMetric"),
  portMetric: document.getElementById("portMetric"),
  addressMetric: document.getElementById("addressMetric"),
  startButton: document.getElementById("startButton"),
  stopButton: document.getElementById("stopButton"),
  downloadButton: document.getElementById("downloadButton"),
  backupButton: document.getElementById("backupButton"),
  refreshButton: document.getElementById("refreshButton"),
  eulaCheck: document.getElementById("eulaCheck"),
  downloadBox: document.getElementById("downloadBox"),
  downloadPercent: document.getElementById("downloadPercent"),
  downloadBar: document.getElementById("downloadBar"),
  settingsForm: document.getElementById("settingsForm"),
  versionSelect: document.getElementById("versionSelect"),
  memoryMin: document.getElementById("memoryMin"),
  memoryMax: document.getElementById("memoryMax"),
  serverPort: document.getElementById("serverPort"),
  motd: document.getElementById("motd"),
  maxPlayers: document.getElementById("maxPlayers"),
  difficulty: document.getElementById("difficulty"),
  gamemode: document.getElementById("gamemode"),
  onlineMode: document.getElementById("onlineMode"),
  whiteList: document.getElementById("whiteList"),
  pvp: document.getElementById("pvp"),
  javaHint: document.getElementById("javaHint"),
  log: document.getElementById("log"),
  commandForm: document.getElementById("commandForm"),
  commandInput: document.getElementById("commandInput"),
  toast: document.getElementById("toast")
};

let lastLogId = 0;
let toastTimer = null;
let eulaTouched = false;

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json"
    },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "요청 실패");
  }
  return data;
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    els.toast.hidden = true;
  }, 3200);
}

function statusLabel(status) {
  const labels = {
    running: "실행 중",
    starting: "시작 중",
    stopping: "중지 중",
    stopped: "중지됨"
  };
  return labels[status] || status;
}

function updateStatus(status) {
  els.statusPill.className = `status-pill ${status.status}`;
  els.statusText.textContent = statusLabel(status.status);
  els.runningMetric.textContent = status.running ? "켜짐" : "꺼짐";
  els.versionMetric.textContent = status.resolvedVersion || "미다운로드";
  els.portMetric.textContent = String(status.port || 25565);
  els.addressMetric.textContent = status.lanAddresses[0] || "LAN 없음";

  const busy = status.status === "starting" || status.status === "stopping";
  els.startButton.disabled = status.running || busy || Boolean(status.download);
  els.stopButton.disabled = !status.running && !busy;
  els.commandInput.disabled = !status.running;
  els.commandForm.querySelector("button").disabled = !status.running;

  if (status.download) {
    els.downloadBox.hidden = false;
    els.downloadPercent.textContent = `${status.download.percent}%`;
    els.downloadBar.style.width = `${status.download.percent}%`;
  } else {
    els.downloadBox.hidden = true;
  }

  if (status.eulaAccepted) {
    els.eulaCheck.checked = true;
    els.eulaCheck.disabled = true;
  } else {
    els.eulaCheck.disabled = false;
    if (!eulaTouched) {
      els.eulaCheck.checked = false;
    }
  }
  els.javaHint.textContent = status.java.ok
    ? status.java.output.split("\n")[0]
    : "Java를 찾을 수 없음";
}

function applyConfig(config) {
  els.versionSelect.value = config.version || "latest-release";
  els.memoryMin.value = config.memoryMin || "1G";
  els.memoryMax.value = config.memoryMax || "2G";
  els.serverPort.value = config.properties["server-port"] || "25565";
  els.motd.value = config.properties.motd || "";
  els.maxPlayers.value = config.properties["max-players"] || "10";
  els.difficulty.value = config.properties.difficulty || "normal";
  els.gamemode.value = config.properties.gamemode || "survival";
  els.onlineMode.checked = config.properties["online-mode"] === "true";
  els.whiteList.checked = config.properties["white-list"] === "true";
  els.pvp.checked = config.properties.pvp === "true";
}

function readConfigFromForm() {
  return {
    version: els.versionSelect.value,
    memoryMin: els.memoryMin.value,
    memoryMax: els.memoryMax.value,
    properties: {
      "server-port": els.serverPort.value,
      motd: els.motd.value,
      "max-players": els.maxPlayers.value,
      difficulty: els.difficulty.value,
      gamemode: els.gamemode.value,
      "online-mode": String(els.onlineMode.checked),
      "white-list": String(els.whiteList.checked),
      pvp: String(els.pvp.checked)
    }
  };
}

async function loadVersions() {
  try {
    const data = await api("/api/versions");
    for (const release of data.releases) {
      const option = document.createElement("option");
      option.value = release.id;
      option.textContent = release.id;
      els.versionSelect.append(option);
    }
  } catch (error) {
    showToast(error.message);
  }
}

async function loadConfig() {
  const data = await api("/api/config");
  applyConfig(data.config);
  els.eulaCheck.checked = Boolean(data.eulaAccepted);
}

function renderLogLine(entry) {
  const row = document.createElement("div");
  row.className = "log-line";

  const time = document.createElement("span");
  time.className = "log-time";
  time.textContent = new Date(entry.time).toLocaleTimeString("ko-KR", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

  const type = document.createElement("span");
  type.className = `log-type ${entry.type}`;
  type.textContent = entry.type;

  const text = document.createElement("span");
  text.className = "log-text";
  text.textContent = entry.text;

  row.append(time, type, text);
  return row;
}

async function pollLogs() {
  try {
    const data = await api(`/api/logs?since=${lastLogId}`);
    if (data.logs.length) {
      const shouldStick =
        els.log.scrollTop + els.log.clientHeight >= els.log.scrollHeight - 24;
      for (const entry of data.logs) {
        lastLogId = Math.max(lastLogId, entry.id);
        els.log.append(renderLogLine(entry));
      }
      while (els.log.children.length > 900) {
        els.log.firstChild.remove();
      }
      if (shouldStick) {
        els.log.scrollTop = els.log.scrollHeight;
      }
    }
  } catch {
    // Status polling will surface connectivity issues.
  }
}

async function refreshStatus() {
  try {
    updateStatus(await api("/api/status"));
  } catch (error) {
    showToast(error.message);
  }
}

async function saveSettings() {
  await api("/api/config", {
    method: "POST",
    body: readConfigFromForm()
  });
  showToast("설정 저장 완료");
  await refreshStatus();
}

async function startServer() {
  await saveSettings();
  await api("/api/start", {
    method: "POST",
    body: {
      acceptEula: els.eulaCheck.checked
    }
  });
  showToast("서버 시작 요청 보냄");
  await refreshStatus();
}

async function stopServer() {
  await api("/api/stop", {
    method: "POST",
    body: {
      force: false
    }
  });
  showToast("서버 중지 요청 보냄");
  await refreshStatus();
}

async function downloadServer() {
  await saveSettings();
  await api("/api/download", {
    method: "POST"
  });
  showToast("서버 jar 준비 완료");
  await refreshStatus();
}

async function backupWorld() {
  const result = await api("/api/backup", {
    method: "POST"
  });
  showToast(`백업 완료: ${result.backupPath}`);
}

async function sendCommand(command) {
  await api("/api/command", {
    method: "POST",
    body: { command }
  });
}

function wireEvents() {
  els.settingsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await saveSettings();
    } catch (error) {
      showToast(error.message);
    }
  });

  els.eulaCheck.addEventListener("change", () => {
    eulaTouched = true;
  });

  els.startButton.addEventListener("click", async () => {
    try {
      await startServer();
    } catch (error) {
      showToast(error.message);
      await refreshStatus();
    }
  });

  els.stopButton.addEventListener("click", async () => {
    try {
      await stopServer();
    } catch (error) {
      showToast(error.message);
    }
  });

  els.downloadButton.addEventListener("click", async () => {
    try {
      await downloadServer();
    } catch (error) {
      showToast(error.message);
    }
  });

  els.backupButton.addEventListener("click", async () => {
    try {
      await backupWorld();
    } catch (error) {
      showToast(error.message);
    }
  });

  els.refreshButton.addEventListener("click", async () => {
    await refreshStatus();
    await pollLogs();
  });

  els.commandForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const command = els.commandInput.value.trim();
    if (!command) return;
    els.commandInput.value = "";
    try {
      await sendCommand(command);
      await pollLogs();
    } catch (error) {
      showToast(error.message);
    }
  });
}

async function boot() {
  wireEvents();
  await loadVersions();
  await loadConfig();
  await refreshStatus();
  await pollLogs();
  window.setInterval(refreshStatus, 2500);
  window.setInterval(pollLogs, 1200);
}

boot().catch((error) => showToast(error.message));
