const http = require("node:http");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs/promises");
const fss = require("node:fs");
const net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { once } = require("node:events");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_ROOT = process.env.MC_JAVA_HOST_HOME || ROOT;
const DATA_DIR = path.join(DATA_ROOT, "app-data");
const SERVER_DIR = path.join(DATA_ROOT, "minecraft-server");
const VERSIONS_DIR = path.join(SERVER_DIR, "versions");
const BACKUPS_DIR = path.join(SERVER_DIR, "backups");
const CONFIG_PATH = path.join(DATA_DIR, "config.json");
const SERVER_PROPERTIES_PATH = path.join(SERVER_DIR, "server.properties");
const EULA_PATH = path.join(SERVER_DIR, "eula.txt");
const MANIFEST_URL = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 3417);

const defaultConfig = {
  version: "latest-release",
  memoryMin: "1G",
  memoryMax: "2G",
  properties: {
    "server-port": "25565",
    motd: "Hosted by MC Java Host",
    "max-players": "10",
    difficulty: "normal",
    gamemode: "survival",
    "online-mode": "true",
    "white-list": "false",
    pvp: "true",
    "view-distance": "10",
    "simulation-distance": "10"
  }
};

const state = {
  process: null,
  status: "stopped",
  startedAt: null,
  resolvedVersion: null,
  jarPath: null,
  lastExit: null,
  download: null,
  tunnel: {
    process: null,
    status: "stopped",
    command: null,
    address: null,
    claimUrl: null,
    startedAt: null,
    lastExit: null,
    lines: []
  },
  direct: {
    status: "idle",
    publicIp: null,
    address: null,
    mapped: false,
    mappedAt: null,
    method: null,
    lastError: null,
    checkedAt: null,
    gateway: null
  },
  cache: {
    java: { value: null, time: 0 },
    firewall: new Map(),
    playit: { value: null, time: 0 }
  },
  logs: [],
  nextLogId: 1
};

const JAVA_CACHE_MS = 60_000;
const FIREWALL_CACHE_MS = 15_000;
const PLAYIT_CACHE_MS = 60_000;

function appendLog(type, text) {
  const lines = String(text).replace(/\r/g, "").split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    state.logs.push({
      id: state.nextLogId++,
      type,
      time: new Date().toISOString(),
      text: line
    });
  }
  if (state.logs.length > 1200) {
    state.logs.splice(0, state.logs.length - 1200);
  }
}

async function ensureDirs() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(SERVER_DIR, { recursive: true });
  await fs.mkdir(VERSIONS_DIR, { recursive: true });
  await fs.mkdir(BACKUPS_DIR, { recursive: true });
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return structuredClone(fallback);
  }
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function normalizeMemory(value, fallback) {
  const raw = String(value || "").trim().toUpperCase();
  return /^\d+[GM]$/.test(raw) ? raw : fallback;
}

function cleanPropertyValue(value) {
  return String(value ?? "").replace(/\r?\n/g, " ").trim();
}

async function loadConfig() {
  const saved = await readJson(CONFIG_PATH, defaultConfig);
  return {
    ...defaultConfig,
    ...saved,
    memoryMin: normalizeMemory(saved.memoryMin, defaultConfig.memoryMin),
    memoryMax: normalizeMemory(saved.memoryMax, defaultConfig.memoryMax),
    properties: {
      ...defaultConfig.properties,
      ...(saved.properties || {})
    }
  };
}

async function saveConfig(config) {
  const next = {
    version: String(config.version || "latest-release"),
    memoryMin: normalizeMemory(config.memoryMin, defaultConfig.memoryMin),
    memoryMax: normalizeMemory(config.memoryMax, defaultConfig.memoryMax),
    properties: {}
  };

  const incomingProperties = config.properties || {};
  for (const key of Object.keys(defaultConfig.properties)) {
    next.properties[key] = cleanPropertyValue(
      incomingProperties[key] ?? defaultConfig.properties[key]
    );
  }

  await writeJson(CONFIG_PATH, next);
  await writeServerProperties(next.properties);
  return next;
}

async function readServerProperties() {
  try {
    const text = await fs.readFile(SERVER_PROPERTIES_PATH, "utf8");
    const parsed = {};
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const equalIndex = line.indexOf("=");
      if (equalIndex === -1) continue;
      parsed[line.slice(0, equalIndex)] = line.slice(equalIndex + 1);
    }
    return parsed;
  } catch {
    return {};
  }
}

async function writeServerProperties(properties) {
  await ensureDirs();
  const existing = await readServerProperties();
  const merged = {
    ...existing,
    ...properties
  };

  const priorityKeys = Object.keys(defaultConfig.properties);
  const otherKeys = Object.keys(merged)
    .filter((key) => !priorityKeys.includes(key))
    .sort();
  const lines = [
    "# Minecraft server properties managed by MC Java Host",
    `# ${new Date().toISOString()}`,
    ...priorityKeys.map((key) => `${key}=${cleanPropertyValue(merged[key])}`),
    ...otherKeys.map((key) => `${key}=${cleanPropertyValue(merged[key])}`)
  ];
  await fs.writeFile(SERVER_PROPERTIES_PATH, `${lines.join(os.EOL)}${os.EOL}`, "utf8");
}

async function readEulaAccepted() {
  try {
    const text = await fs.readFile(EULA_PATH, "utf8");
    return /^eula\s*=\s*true\s*$/im.test(text);
  } catch {
    return false;
  }
}

async function writeEulaAccepted() {
  await ensureDirs();
  const text = [
    "# By changing this setting to TRUE you indicate agreement to the Minecraft EULA.",
    "# https://aka.ms/MinecraftEULA",
    `# ${new Date().toISOString()}`,
    "eula=true"
  ].join(os.EOL);
  await fs.writeFile(EULA_PATH, `${text}${os.EOL}`, "utf8");
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function getVersionManifest() {
  const manifest = await fetchJson(MANIFEST_URL);
  const releases = manifest.versions
    .filter((version) => version.type === "release")
    .slice(0, 40)
    .map((version) => ({
      id: version.id,
      time: version.time,
      releaseTime: version.releaseTime
    }));
  return {
    latest: manifest.latest,
    releases
  };
}

async function resolveVersion(versionId) {
  const manifest = await fetchJson(MANIFEST_URL);
  const targetId =
    !versionId || versionId === "latest-release" ? manifest.latest.release : versionId;
  const entry = manifest.versions.find((version) => version.id === targetId);
  if (!entry) {
    throw new Error(`Unknown Minecraft version: ${targetId}`);
  }
  return entry;
}

async function downloadFile(url, destination, expectedSha1) {
  const tmp = `${destination}.download`;
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  const total = Number(response.headers.get("content-length") || 0);
  const file = fss.createWriteStream(tmp);
  const hash = createHash("sha1");
  let downloaded = 0;
  const startedAt = Date.now();

  state.download = {
    active: true,
    downloaded,
    total,
    percent: 0,
    startedAt
  };

  try {
    for await (const chunk of response.body) {
      downloaded += chunk.length;
      hash.update(chunk);
      if (!file.write(chunk)) {
        await once(file, "drain");
      }
      state.download = {
        active: true,
        downloaded,
        total,
        percent: total ? Math.round((downloaded / total) * 100) : 0,
        startedAt
      };
    }
    file.end();
    await once(file, "finish");

    const actualSha1 = hash.digest("hex");
    if (expectedSha1 && actualSha1 !== expectedSha1) {
      await fs.rm(tmp, { force: true });
      throw new Error("Downloaded server jar failed SHA-1 verification.");
    }

    await fs.rename(tmp, destination);
  } finally {
    state.download = null;
  }
}

async function ensureServerJar(versionId) {
  await ensureDirs();
  const entry = await resolveVersion(versionId);
  const versionMeta = await fetchJson(entry.url);
  const serverDownload = versionMeta.downloads && versionMeta.downloads.server;
  if (!serverDownload) {
    throw new Error(`Minecraft ${entry.id} does not provide a server jar.`);
  }

  const jarPath = path.join(VERSIONS_DIR, `server-${entry.id}.jar`);
  if (fss.existsSync(jarPath)) {
    state.resolvedVersion = entry.id;
    state.jarPath = jarPath;
    return { version: entry.id, jarPath, downloaded: false };
  }

  appendLog("system", `Downloading Minecraft server ${entry.id}...`);
  await downloadFile(serverDownload.url, jarPath, serverDownload.sha1);
  appendLog("system", `Downloaded Minecraft server ${entry.id}.`);
  state.resolvedVersion = entry.id;
  state.jarPath = jarPath;
  return { version: entry.id, jarPath, downloaded: true };
}

function getJavaVersion(options = {}) {
  if (!options.force && state.cache.java.value && Date.now() - state.cache.java.time < JAVA_CACHE_MS) {
    return state.cache.java.value;
  }

  const result = spawnSync("java", ["-version"], { encoding: "utf8" });
  const output = `${result.stderr || ""}${result.stdout || ""}`.trim();
  const value = {
    ok: result.status === 0,
    output
  };
  state.cache.java = {
    value,
    time: Date.now()
  };
  return value;
}

function getLanAddresses(port) {
  const addresses = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) {
        addresses.push(`${entry.address}:${port}`);
      }
    }
  }
  return addresses;
}

function getPrimaryLanAddress() {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) {
        return entry.address;
      }
    }
  }
  return "127.0.0.1";
}

function getDefaultGatewayAddress() {
  try {
    const { gateway4sync } = require("default-gateway");
    return gateway4sync().gateway;
  } catch {
    return null;
  }
}

function checkPort(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port, timeout: 400 });
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => resolve(false));
  });
}

async function fetchPublicIpFromWeb() {
  const endpoints = [
    {
      url: "https://api.ipify.org?format=json",
      read: (data) => data.ip
    },
    {
      url: "https://ifconfig.co/json",
      read: (data) => data.ip
    }
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint.url, { signal: AbortSignal.timeout(6000) });
      if (!response.ok) continue;
      const ip = endpoint.read(await response.json());
      if (ip) return ip;
    } catch {
      // Try the next public IP service.
    }
  }

  throw new Error("Could not detect public IP address.");
}

function withTimeout(promise, milliseconds, message) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), milliseconds);
  });

  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

function getDirectSnapshot(port) {
  return {
    status: state.direct.status,
    publicIp: state.direct.publicIp,
    address: state.direct.address || (state.direct.publicIp ? `${state.direct.publicIp}:${port}` : null),
    mapped: state.direct.mapped,
    mappedAt: state.direct.mappedAt,
    method: state.direct.method,
    lastError: state.direct.lastError,
    checkedAt: state.direct.checkedAt
  };
}

function getManualPortForwardInfo(port) {
  const gateway = getDefaultGatewayAddress();
  const localIp = getPrimaryLanAddress();
  const publicIp = state.direct.publicIp;

  return {
    gateway,
    gatewayUrl: gateway ? `http://${gateway}` : null,
    localIp,
    publicIp,
    publicAddress: publicIp ? `${publicIp}:${port}` : null,
    internalPort: port,
    externalPort: port,
    protocol: "TCP",
    ruleName: `Minecraft ${port}`,
    note: "공유기 관리자 페이지에서 포트포워딩, NAT, 가상 서버, 포트 매핑 메뉴를 찾으세요."
  };
}

async function refreshDirectShare(port) {
  state.direct.status = "checking";
  state.direct.lastError = null;

  try {
    state.direct.publicIp = await fetchPublicIpFromWeb();
    state.direct.address = `${state.direct.publicIp}:${port}`;
    state.direct.status = state.direct.mapped ? "mapped" : "ready";
    state.direct.checkedAt = new Date().toISOString();
    return getDirectSnapshot(port);
  } catch (error) {
    state.direct.status = "error";
    state.direct.lastError = error.message;
    state.direct.checkedAt = new Date().toISOString();
    throw error;
  }
}

async function findNatGateway() {
  const { upnpNat, pmpNat } = await import("@achingbrain/nat-port-mapper");

  const upnp = upnpNat();
  try {
    for await (const gateway of upnp.findGateways({ signal: AbortSignal.timeout(9000) })) {
      return {
        gateway,
        method: "UPnP"
      };
    }
  } catch {
    // NAT-PMP below gives some routers a second chance.
  }

  try {
    const { gateway4sync } = require("default-gateway");
    const gatewayAddress = gateway4sync().gateway;
    return {
      gateway: pmpNat(gatewayAddress),
      method: "NAT-PMP"
    };
  } catch (error) {
    throw new Error(`Could not find a UPnP/NAT-PMP gateway. ${error.message}`);
  }
}

async function mapDirectPort(port) {
  if (state.direct.gateway && state.direct.mapped) {
    return getDirectSnapshot(port);
  }

  state.direct.status = "mapping";
  state.direct.lastError = null;
  let gateway = null;

  try {
    const localIp = getPrimaryLanAddress();
    const found = await withTimeout(
      findNatGateway(),
      12_000,
      "공유기 자동 포트포워딩 기능을 찾지 못했습니다. 공유기 UPnP가 꺼져 있거나 통신사 CGNAT일 수 있습니다."
    );
    gateway = found.gateway;
    const { method } = found;

    await withTimeout(
      gateway.map(port, localIp, {
        externalPort: port,
        protocol: "tcp",
        description: "MC Java Host"
      }),
      12_000,
      "공유기가 포트 열기 요청에 응답하지 않습니다. 공유기 UPnP 설정을 켜거나 수동 포트포워딩이 필요할 수 있습니다."
    );

    let publicIp = null;
    try {
      publicIp = await withTimeout(
        gateway.externalIp(),
        6000,
        "공유기에서 공인 IP를 받지 못했습니다."
      );
    } catch {
      publicIp = await fetchPublicIpFromWeb();
    }

    state.direct.gateway = gateway;
    state.direct.publicIp = publicIp;
    state.direct.address = `${publicIp}:${port}`;
    state.direct.mapped = true;
    state.direct.mappedAt = new Date().toISOString();
    state.direct.method = method;
    state.direct.status = "mapped";
    state.direct.checkedAt = new Date().toISOString();
    appendLog("system", `Mapped TCP ${port} with ${method}. Public address: ${state.direct.address}`);
    return getDirectSnapshot(port);
  } catch (error) {
    if (gateway && typeof gateway.stop === "function" && !state.direct.gateway) {
      try {
        await gateway.stop();
      } catch {
        // Nothing else to clean up.
      }
    }
    state.direct.status = "error";
    state.direct.lastError = error.message;
    state.direct.checkedAt = new Date().toISOString();
    appendLog("stderr", `Direct publish failed: ${error.message}`);
    throw error;
  }
}

async function unmapDirectPort(port) {
  if (!state.direct.gateway) {
    state.direct.mapped = false;
    state.direct.status = state.direct.publicIp ? "ready" : "idle";
    return getDirectSnapshot(port);
  }

  try {
    await state.direct.gateway.unmap(port);
    if (typeof state.direct.gateway.stop === "function") {
      await state.direct.gateway.stop();
    }
    appendLog("system", `Unmapped TCP ${port}.`);
  } catch (error) {
    appendLog("stderr", `Direct unpublish failed: ${error.message}`);
  }

  state.direct.gateway = null;
  state.direct.mapped = false;
  state.direct.mappedAt = null;
  state.direct.method = null;
  state.direct.status = state.direct.publicIp ? "ready" : "idle";
  state.direct.checkedAt = new Date().toISOString();
  return getDirectSnapshot(port);
}

function getWindowsFirewallStatus(port, options = {}) {
  const cached = state.cache.firewall.get(port);
  if (!options.force && cached && Date.now() - cached.time < FIREWALL_CACHE_MS) {
    return cached.value;
  }

  let value;
  if (process.platform !== "win32") {
    value = {
      supported: false,
      allowed: null,
      message: "Windows firewall check is only available on Windows."
    };
    state.cache.firewall.set(port, { value, time: Date.now() });
    return value;
  }

  const script = `
    $rule = Get-NetFirewallRule -DisplayName "MC Java Host ${port}" -ErrorAction SilentlyContinue
    if ($rule -and $rule.Enabled -eq "True") { "allowed" } else { "missing" }
  `;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    timeout: 5000,
    windowsHide: true
  });

  if (result.status !== 0) {
    value = {
      supported: true,
      allowed: null,
      message: "Could not check Windows firewall."
    };
    state.cache.firewall.set(port, { value, time: Date.now() });
    return value;
  }

  const allowed = String(result.stdout || "").includes("allowed");
  value = {
    supported: true,
    allowed,
    message: allowed ? "Inbound TCP rule exists." : "No inbound TCP allow rule was found."
  };
  state.cache.firewall.set(port, { value, time: Date.now() });
  return value;
}

function allowWindowsFirewallPort(port) {
  if (process.platform !== "win32") {
    throw new Error("Windows firewall rules can only be changed on Windows.");
  }

  const result = spawnSync(
    "netsh.exe",
    [
      "advfirewall",
      "firewall",
      "add",
      "rule",
      `name=MC Java Host ${port}`,
      "dir=in",
      "action=allow",
      "protocol=TCP",
      `localport=${port}`
    ],
    {
      encoding: "utf8",
      timeout: 8000,
      windowsHide: true
    }
  );

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "Could not add Windows firewall rule.").trim());
  }

  appendLog("system", `Added Windows firewall allow rule for TCP ${port}.`);
  state.cache.firewall.delete(port);
  return getWindowsFirewallStatus(port, { force: true });
}

function removeWindowsFirewallPort(port) {
  if (process.platform !== "win32") {
    throw new Error("Windows firewall rules can only be changed on Windows.");
  }

  const result = spawnSync(
    "netsh.exe",
    [
      "advfirewall",
      "firewall",
      "delete",
      "rule",
      `name=MC Java Host ${port}`
    ],
    {
      encoding: "utf8",
      timeout: 8000,
      windowsHide: true
    }
  );

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "Could not remove Windows firewall rule.").trim());
  }

  appendLog("system", `Removed Windows firewall allow rule for TCP ${port}.`);
  state.cache.firewall.delete(port);
  return getWindowsFirewallStatus(port, { force: true });
}

function getPlayitCommand() {
  if (Date.now() - state.cache.playit.time < PLAYIT_CACHE_MS) {
    return state.cache.playit.value;
  }

  const candidates =
    process.platform === "win32"
      ? ["playit.exe", "playit-cli.exe", "playit", "playit-cli"]
      : ["playit", "playit-cli"];

  for (const command of candidates) {
    const lookup =
      process.platform === "win32"
        ? spawnSync("where.exe", [command], { encoding: "utf8" })
        : spawnSync("command", ["-v", command], { encoding: "utf8", shell: true });

    if (lookup.status === 0) {
      const resolved = String(lookup.stdout || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);
      state.cache.playit = {
        value: resolved || command,
        time: Date.now()
      };
      return state.cache.playit.value;
    }
  }

  state.cache.playit = {
    value: null,
    time: Date.now()
  };
  return null;
}

function rememberTunnelLine(text) {
  const lines = String(text).replace(/\r/g, "").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    state.tunnel.lines.push({
      time: new Date().toISOString(),
      text: trimmed
    });
    if (state.tunnel.lines.length > 80) {
      state.tunnel.lines.splice(0, state.tunnel.lines.length - 80);
    }

    const addressMatch = trimmed.match(
      /((?:[a-z0-9-]+\.)+(?:ply\.gg|playit\.gg|join\.playit\.gg))(?::(\d{2,5}))?/i
    );
    if (addressMatch && !/https?:\/\//i.test(addressMatch[0])) {
      state.tunnel.address = addressMatch[2]
        ? `${addressMatch[1]}:${addressMatch[2]}`
        : addressMatch[1];
    }

    const claimMatch = trimmed.match(/https?:\/\/[^\s]+/i);
    if (claimMatch && /playit\.gg|ply\.gg/i.test(claimMatch[0])) {
      state.tunnel.claimUrl = claimMatch[0];
    }
  }
}

function getTunnelSnapshot() {
  const command = state.tunnel.command || getPlayitCommand();
  return {
    provider: "playit.gg",
    installed: Boolean(command),
    command,
    running: Boolean(state.tunnel.process),
    status: state.tunnel.status,
    address: state.tunnel.address,
    claimUrl: state.tunnel.claimUrl,
    startedAt: state.tunnel.startedAt,
    lastExit: state.tunnel.lastExit,
    lines: state.tunnel.lines.slice(-20),
    downloadUrl: "https://playit.gg/download"
  };
}

async function startPlayitTunnel() {
  if (state.tunnel.process) {
    return getTunnelSnapshot();
  }

  const command = getPlayitCommand();
  if (!command) {
    const error = new Error("playit.gg agent is not installed. Install it, then try again.");
    error.code = "PLAYIT_NOT_FOUND";
    throw error;
  }

  appendLog("system", "Starting playit.gg tunnel agent...");
  state.tunnel = {
    ...state.tunnel,
    status: "starting",
    command,
    address: null,
    claimUrl: null,
    startedAt: new Date().toISOString(),
    lastExit: null,
    lines: []
  };

  const child = spawn(command, [], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });

  state.tunnel.process = child;

  child.stdout.on("data", (chunk) => {
    state.tunnel.status = "running";
    const text = chunk.toString("utf8");
    rememberTunnelLine(text);
    appendLog("tunnel", text);
  });

  child.stderr.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    rememberTunnelLine(text);
    appendLog("tunnel", text);
  });

  child.on("exit", (code, signal) => {
    appendLog("system", `playit.gg tunnel stopped. Exit code: ${code ?? "none"}, signal: ${signal ?? "none"}.`);
    state.tunnel.process = null;
    state.tunnel.status = "stopped";
    state.tunnel.startedAt = null;
    state.tunnel.lastExit = {
      code,
      signal,
      time: new Date().toISOString()
    };
  });

  child.on("error", (error) => {
    appendLog("stderr", error.message);
    state.tunnel.process = null;
    state.tunnel.status = "stopped";
  });

  return getTunnelSnapshot();
}

async function stopPlayitTunnel() {
  if (!state.tunnel.process) {
    return getTunnelSnapshot();
  }

  appendLog("system", "Stopping playit.gg tunnel agent...");
  state.tunnel.status = "stopping";
  state.tunnel.process.kill("SIGTERM");
  return getTunnelSnapshot();
}

async function getStatusPayload() {
  const config = await loadConfig();
  const serverPort = Number(config.properties["server-port"] || 25565);
  return {
    status: state.status,
    running: Boolean(state.process),
    pid: state.process ? state.process.pid : null,
    startedAt: state.startedAt,
    resolvedVersion: state.resolvedVersion,
    jarPath: state.jarPath,
    lastExit: state.lastExit,
    download: state.download,
    logCount: state.logs.length,
    nextLogId: state.nextLogId,
    java: getJavaVersion(),
    eulaAccepted: await readEulaAccepted(),
    port: serverPort,
    portOpen: await checkPort(serverPort),
    lanAddresses: getLanAddresses(serverPort),
    direct: getDirectSnapshot(serverPort),
    manual: getManualPortForwardInfo(serverPort),
    firewall: getWindowsFirewallStatus(serverPort),
    tunnel: getTunnelSnapshot()
  };
}

async function startServer(options = {}) {
  if (state.process) {
    return getStatusPayload();
  }

  await ensureDirs();
  const config = await loadConfig();
  await writeServerProperties(config.properties);

  const java = getJavaVersion({ force: true });
  if (!java.ok) {
    throw new Error("Java was not found. Install Java 21 or newer, then restart this app.");
  }

  if (options.acceptEula) {
    await writeEulaAccepted();
  }

  if (!(await readEulaAccepted())) {
    const error = new Error("EULA agreement is required before starting the server.");
    error.code = "EULA_REQUIRED";
    throw error;
  }

  const jar = await ensureServerJar(config.version);
  const args = [
    `-Xms${config.memoryMin}`,
    `-Xmx${config.memoryMax}`,
    "-jar",
    jar.jarPath,
    "nogui"
  ];

  appendLog("system", `Starting Minecraft ${jar.version} with ${config.memoryMax} max RAM...`);
  const child = spawn("java", args, {
    cwd: SERVER_DIR,
    stdio: ["pipe", "pipe", "pipe"]
  });

  state.process = child;
  state.status = "starting";
  state.startedAt = new Date().toISOString();
  state.lastExit = null;

  child.stdout.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    appendLog("stdout", text);
    if (text.includes("Done (")) {
      state.status = "running";
    }
  });

  child.stderr.on("data", (chunk) => appendLog("stderr", chunk.toString("utf8")));

  child.on("exit", (code, signal) => {
    appendLog("system", `Server stopped. Exit code: ${code ?? "none"}, signal: ${signal ?? "none"}.`);
    state.process = null;
    state.status = "stopped";
    state.startedAt = null;
    state.lastExit = {
      code,
      signal,
      time: new Date().toISOString()
    };
  });

  child.on("error", (error) => {
    appendLog("stderr", error.message);
    state.process = null;
    state.status = "stopped";
  });

  return getStatusPayload();
}

async function stopServer(force = false) {
  if (!state.process) {
    return getStatusPayload();
  }

  state.status = "stopping";
  appendLog("system", force ? "Force stopping server..." : "Stopping server gracefully...");

  if (force) {
    state.process.kill("SIGTERM");
    return getStatusPayload();
  }

  state.process.stdin.write(`stop${os.EOL}`);
  setTimeout(() => {
    if (state.process) {
      appendLog("system", "Server did not stop in time; sending terminate signal.");
      state.process.kill("SIGTERM");
    }
  }, 15000).unref();

  return getStatusPayload();
}

async function sendCommand(command) {
  if (!state.process) {
    throw new Error("Server is not running.");
  }
  const cleaned = String(command || "").trim();
  if (!cleaned) {
    throw new Error("Command is empty.");
  }
  state.process.stdin.write(`${cleaned}${os.EOL}`);
  appendLog("command", `> ${cleaned}`);
  return { ok: true };
}

async function createWorldBackup() {
  const worldPath = path.join(SERVER_DIR, "world");
  if (!fss.existsSync(worldPath)) {
    throw new Error("No world folder exists yet.");
  }

  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  const backupPath = path.join(BACKUPS_DIR, `world-${stamp}`);
  await fs.cp(worldPath, backupPath, { recursive: true });
  appendLog("system", `Created backup: ${path.basename(backupPath)}`);
  return { backupPath };
}

async function parseBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) {
      throw new Error("Request body is too large.");
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(data));
}

function sendError(response, error) {
  const statusCode = error.code === "EULA_REQUIRED" ? 409 : 400;
  sendJson(response, statusCode, {
    error: error.message,
    code: error.code || "ERROR"
  });
}

async function handleApi(request, response, pathname) {
  if (request.method === "GET" && pathname === "/api/status") {
    sendJson(response, 200, await getStatusPayload());
    return;
  }

  if (request.method === "GET" && pathname === "/api/tunnel") {
    sendJson(response, 200, getTunnelSnapshot());
    return;
  }

  if (request.method === "POST" && pathname === "/api/direct/refresh") {
    const config = await loadConfig();
    const serverPort = Number(config.properties["server-port"] || 25565);
    sendJson(response, 200, await refreshDirectShare(serverPort));
    return;
  }

  if (request.method === "GET" && pathname === "/api/direct/manual") {
    const config = await loadConfig();
    const serverPort = Number(config.properties["server-port"] || 25565);
    sendJson(response, 200, getManualPortForwardInfo(serverPort));
    return;
  }

  if (request.method === "GET" && pathname === "/api/config") {
    const config = await loadConfig();
    config.properties = {
      ...config.properties,
      ...(await readServerProperties())
    };
    sendJson(response, 200, {
      config,
      eulaAccepted: await readEulaAccepted()
    });
    return;
  }

  if (request.method === "POST" && pathname === "/api/config") {
    const body = await parseBody(request);
    sendJson(response, 200, { config: await saveConfig(body) });
    return;
  }

  if (request.method === "GET" && pathname === "/api/versions") {
    sendJson(response, 200, await getVersionManifest());
    return;
  }

  if (request.method === "GET" && pathname === "/api/logs") {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const since = Number(url.searchParams.get("since") || 0);
    sendJson(response, 200, {
      logs: state.logs.filter((entry) => entry.id > since),
      nextLogId: state.nextLogId
    });
    return;
  }

  if (request.method === "POST" && pathname === "/api/download") {
    const config = await loadConfig();
    sendJson(response, 200, await ensureServerJar(config.version));
    return;
  }

  if (request.method === "POST" && pathname === "/api/start") {
    const body = await parseBody(request);
    sendJson(response, 200, await startServer(body));
    return;
  }

  if (request.method === "POST" && pathname === "/api/stop") {
    const body = await parseBody(request);
    sendJson(response, 200, await stopServer(Boolean(body.force)));
    return;
  }

  if (request.method === "POST" && pathname === "/api/tunnel/start") {
    sendJson(response, 200, await startPlayitTunnel());
    return;
  }

  if (request.method === "POST" && pathname === "/api/tunnel/stop") {
    sendJson(response, 200, await stopPlayitTunnel());
    return;
  }

  if (request.method === "POST" && pathname === "/api/direct/map") {
    const config = await loadConfig();
    const serverPort = Number(config.properties["server-port"] || 25565);
    sendJson(response, 200, await mapDirectPort(serverPort));
    return;
  }

  if (request.method === "POST" && pathname === "/api/direct/unmap") {
    const config = await loadConfig();
    const serverPort = Number(config.properties["server-port"] || 25565);
    sendJson(response, 200, await unmapDirectPort(serverPort));
    return;
  }

  if (request.method === "POST" && pathname === "/api/firewall/allow") {
    const config = await loadConfig();
    const serverPort = Number(config.properties["server-port"] || 25565);
    sendJson(response, 200, allowWindowsFirewallPort(serverPort));
    return;
  }

  if (request.method === "POST" && pathname === "/api/firewall/remove") {
    const config = await loadConfig();
    const serverPort = Number(config.properties["server-port"] || 25565);
    sendJson(response, 200, removeWindowsFirewallPort(serverPort));
    return;
  }

  if (request.method === "POST" && pathname === "/api/command") {
    const body = await parseBody(request);
    sendJson(response, 200, await sendCommand(body.command));
    return;
  }

  if (request.method === "POST" && pathname === "/api/backup") {
    sendJson(response, 200, await createWorldBackup());
    return;
  }

  sendJson(response, 404, { error: "Unknown API route." });
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml"
};

async function serveStatic(request, response, pathname) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requestedPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream"
    });
    response.end(data);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url.pathname);
      return;
    }
    await serveStatic(request, response, url.pathname);
  } catch (error) {
    sendError(response, error);
  }
}

async function startHost() {
  await ensureDirs();
  const config = await loadConfig();
  await saveConfig(config);

  const server = http.createServer((request, response) => {
    handleRequest(request, response);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, HOST, () => {
      server.off("error", reject);
      resolve();
    });
  });

  return {
    server,
    host: HOST,
    port: PORT,
    url: `http://${HOST}:${PORT}`
  };
}

async function main() {
  const host = await startHost();
  console.log(`MC Java Host is running at ${host.url}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  startHost,
  HOST,
  PORT
};
