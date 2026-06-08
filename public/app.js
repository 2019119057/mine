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
  directStatus: document.getElementById("directStatus"),
  publicIpButton: document.getElementById("publicIpButton"),
  copyAddressButton: document.getElementById("copyAddressButton"),
  mapPortButton: document.getElementById("mapPortButton"),
  unmapPortButton: document.getElementById("unmapPortButton"),
  firewallButton: document.getElementById("firewallButton"),
  directRefreshButton: document.getElementById("directRefreshButton"),
  publicAddress: document.getElementById("publicAddress"),
  javaCheck: document.getElementById("javaCheck"),
  serverCheck: document.getElementById("serverCheck"),
  firewallCheck: document.getElementById("firewallCheck"),
  portMapCheck: document.getElementById("portMapCheck"),
  directHint: document.getElementById("directHint"),
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
let statusInFlight = false;
let logsInFlight = false;
let currentPublicAddress = null;

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

function setText(el, text) {
  if (el.textContent !== text) {
    el.textContent = text;
  }
}

function setDisabled(el, disabled) {
  if (el.disabled !== disabled) {
    el.disabled = disabled;
  }
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  setText(els.toast, message);
  els.toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    els.toast.hidden = true;
  }, 3000);
}

function statusLabel(status) {
  const labels = {
    running: "실행 중",
    starting: "시작 중",
    stopping: "중지 중",
    stopped: "꺼짐"
  };
  return labels[status] || status;
}

function directLabel(direct) {
  const labels = {
    idle: "대기",
    checking: "확인 중",
    ready: "IP 확인됨",
    mapping: "포트 여는 중",
    mapped: "공개 가능",
    error: "실패"
  };
  return labels[direct.status] || direct.status || "대기";
}

function setCheck(el, ok, text) {
  const nextClass = `check-item ${ok ? "ok" : "warn"}`;
  if (el.className !== nextClass) {
    el.className = nextClass;
  }
  setText(el, text);
}

function renderDirect(status) {
  const direct = status.direct || {};
  const firewall = status.firewall || {};
  currentPublicAddress = direct.address || (direct.publicIp ? `${direct.publicIp}:${status.port}` : null);
  const displayAddress = currentPublicAddress || status.lanAddresses[0] || "-";

  setText(els.directStatus, directLabel(direct));
  setText(els.publicAddress, currentPublicAddress || "공인 IP 확인 후 표시");
  setText(els.addressMetric, displayAddress);
  setDisabled(els.copyAddressButton, !currentPublicAddress);
  setDisabled(els.mapPortButton, direct.status === "mapping" || direct.mapped === true);
  setDisabled(els.unmapPortButton, !direct.mapped);

  setCheck(els.javaCheck, status.java.ok, status.java.ok ? "Java 설치됨" : "Java 설치 필요");
  setCheck(
    els.serverCheck,
    status.running,
    status.running ? `마크 서버 실행 중 (${status.port})` : "마크 서버 먼저 시작"
  );
  setCheck(
    els.firewallCheck,
    firewall.allowed === true,
    firewall.allowed === true ? "Windows 방화벽 허용됨" : "방화벽 허용 필요"
  );
  setCheck(
    els.portMapCheck,
    direct.mapped === true,
    direct.mapped ? `${direct.method || "UPnP"} 포트포워딩 완료` : "자동 포트포워딩 필요"
  );

  const hint = [];
  if (currentPublicAddress) {
    hint.push(`친구에게 ${currentPublicAddress} 를 보내면 됩니다.`);
  } else {
    hint.push("공인 IP 확인을 누르면 친구에게 줄 주소가 만들어집니다.");
  }
  if (!direct.mapped) {
    hint.push("자동 포트 열기가 실패하면 공유기 UPnP가 꺼져 있거나 통신사 CGNAT일 수 있습니다.");
  }
  if (direct.lastError) {
    hint.push(`오류: ${direct.lastError}`);
  }
  if (firewall.message) {
    hint.push(`방화벽: ${firewall.message}`);
  }
  setText(els.directHint, hint.join("\n"));
}

function updateStatus(status) {
  const statusClass = `status-pill ${status.status}`;
  if (els.statusPill.className !== statusClass) {
    els.statusPill.className = statusClass;
  }
  setText(els.statusText, statusLabel(status.status));
  setText(els.runningMetric, status.running ? "켜짐" : "꺼짐");
  setText(els.versionMetric, status.resolvedVersion || "미다운로드");
  setText(els.portMetric, String(status.port || 25565));

  const busy = status.status === "starting" || status.status === "stopping";
  setDisabled(els.startButton, status.running || busy || Boolean(status.download));
  setDisabled(els.stopButton, !status.running && !busy);
  setDisabled(els.commandInput, !status.running);
  setDisabled(els.commandForm.querySelector("button"), !status.running);

  if (status.download) {
    els.downloadBox.hidden = false;
    setText(els.downloadPercent, `${status.download.percent}%`);
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

  setText(
    els.javaHint,
    status.java.ok ? status.java.output.split("\n")[0] : "Java를 찾을 수 없음"
  );
  renderDirect(status);
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
    const existing = new Set([...els.versionSelect.options].map((option) => option.value));
    const fragment = document.createDocumentFragment();
    for (const release of data.releases) {
      if (existing.has(release.id)) continue;
      const option = document.createElement("option");
      option.value = release.id;
      option.textContent = release.id;
      fragment.append(option);
    }
    els.versionSelect.append(fragment);
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
  if (logsInFlight) return;
  logsInFlight = true;
  try {
    const data = await api(`/api/logs?since=${lastLogId}`);
    if (!data.logs.length) return;

    const shouldStick =
      els.log.scrollTop + els.log.clientHeight >= els.log.scrollHeight - 24;
    const fragment = document.createDocumentFragment();
    for (const entry of data.logs) {
      lastLogId = Math.max(lastLogId, entry.id);
      fragment.append(renderLogLine(entry));
    }

    window.requestAnimationFrame(() => {
      els.log.append(fragment);
      while (els.log.children.length > 350) {
        els.log.firstChild.remove();
      }
      if (shouldStick) {
        els.log.scrollTop = els.log.scrollHeight;
      }
    });
  } catch {
    // Status polling will surface connectivity issues.
  } finally {
    logsInFlight = false;
  }
}

async function refreshStatus() {
  if (statusInFlight) return;
  statusInFlight = true;
  try {
    updateStatus(await api("/api/status"));
  } catch (error) {
    showToast(error.message);
  } finally {
    statusInFlight = false;
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

async function refreshDirectShare() {
  await api("/api/direct/refresh", {
    method: "POST"
  });
  showToast("공인 IP 확인 완료");
  await refreshStatus();
}

async function mapDirectPort() {
  await api("/api/direct/map", {
    method: "POST"
  });
  showToast("자동 포트포워딩 완료");
  await refreshStatus();
}

async function unmapDirectPort() {
  await api("/api/direct/unmap", {
    method: "POST"
  });
  showToast("포트포워딩 해제 완료");
  await refreshStatus();
}

async function allowFirewall() {
  await api("/api/firewall/allow", {
    method: "POST"
  });
  showToast("방화벽 규칙 추가 완료");
  await refreshStatus();
}

async function copyPublicAddress() {
  if (!currentPublicAddress) return;
  await navigator.clipboard.writeText(currentPublicAddress);
  showToast("주소 복사 완료");
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

  els.publicIpButton.addEventListener("click", async () => {
    try {
      await refreshDirectShare();
    } catch (error) {
      showToast(error.message);
    }
  });

  els.copyAddressButton.addEventListener("click", async () => {
    try {
      await copyPublicAddress();
    } catch (error) {
      showToast(error.message);
    }
  });

  els.mapPortButton.addEventListener("click", async () => {
    try {
      await mapDirectPort();
    } catch (error) {
      showToast(error.message);
      await refreshStatus();
    }
  });

  els.unmapPortButton.addEventListener("click", async () => {
    try {
      await unmapDirectPort();
    } catch (error) {
      showToast(error.message);
    }
  });

  els.firewallButton.addEventListener("click", async () => {
    try {
      await allowFirewall();
    } catch (error) {
      showToast(error.message);
      await refreshStatus();
    }
  });

  els.directRefreshButton.addEventListener("click", refreshStatus);

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
  window.setInterval(refreshStatus, 5000);
  window.setInterval(pollLogs, 2000);
}

boot().catch((error) => showToast(error.message));
