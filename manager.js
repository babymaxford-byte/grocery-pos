#!/usr/bin/env node
"use strict";

/*
 * EverJoy POS Manager 4.9.7
 * Local process supervisor + safe application updater.
 *
 * The manager API is intentionally bound to 127.0.0.1 only.
 * POS data lives in data/ and is never overwritten by an application update.
 */

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");
const http = require("http");
const crypto = require("crypto");
const zlib = require("zlib");
const { spawn, execFileSync } = require("child_process");

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const MANAGER_DIR = path.join(DATA_DIR, ".manager");
const PID_FILE = path.join(MANAGER_DIR, "manager.pid");
const LOG_DIR = path.join(MANAGER_DIR, "logs");
const CONFIG_FILE = path.join(MANAGER_DIR, "manager.json");
const UPDATE_DIR = path.join(MANAGER_DIR, "updates");
const UPDATE_ZIP = path.join(UPDATE_DIR, "incoming.zip");
const UPDATE_STATUS = path.join(UPDATE_DIR, "status.json");
const BACKUP_DIR = path.join(MANAGER_DIR, "backups");
const ROLLBACK_DIR = path.join(MANAGER_DIR, "rollbacks");
const MANAGER_TOKEN_FILE = path.join(MANAGER_DIR, "manager-access.token");
const API_PORT = Number(process.env.POS_MANAGER_PORT || 3010);
const POS_URL = process.env.POS_URL || "http://127.0.0.1:5173";
const API_URL = process.env.POS_API_URL || "http://127.0.0.1:3001";
const MANAGER_UI = path.join(ROOT, "manager-ui", "index.html");
const MAX_UPDATE_BYTES = 300 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 5000;
const MAX_UNCOMPRESSED_UPDATE_BYTES = 700 * 1024 * 1024;
const DEFAULT_GITHUB_REPO = "babymaxford-byte/grocery-pos";
const GITHUB_API = "https://api.github.com";
let githubDownloadInProgress = false;

for (const dir of [MANAGER_DIR, LOG_DIR, UPDATE_DIR, BACKUP_DIR, ROLLBACK_DIR]) fs.mkdirSync(dir, { recursive: true });

function getManagerAccessToken() {
  try { const existing = fs.readFileSync(MANAGER_TOKEN_FILE, "utf8").trim(); if (/^[a-f0-9]{64}$/i.test(existing)) return existing; } catch {}
  const token = crypto.randomBytes(32).toString("hex");
  try { fs.writeFileSync(MANAGER_TOKEN_FILE, token + "\n", { mode: 0o600 }); fs.chmodSync(MANAGER_TOKEN_FILE, 0o600); } catch {}
  return token;
}
const MANAGER_ACCESS_TOKEN = getManagerAccessToken();

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function readPid() { try { return Number(fs.readFileSync(PID_FILE, "utf8").trim()) || 0; } catch { return 0; } }
function processExists(pid) { if (!pid) return false; try { process.kill(pid, 0); return true; } catch { return false; } }
function writePid() { fs.writeFileSync(PID_FILE, String(process.pid), "utf8"); }
function clearPid() { try { if (readPid() === process.pid) fs.unlinkSync(PID_FILE); } catch {} }
function nowStamp() { return new Date().toISOString().replace(/[:.]/g, "-").replace(/Z$/, ""); }
function packageInfo(root = ROOT) { try { return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")); } catch { return {}; } }
function currentVersion() { return packageInfo().version || "unknown"; }
function log(msg) { const line = `[${new Date().toISOString()}] ${msg}\n`; try { fs.appendFileSync(path.join(LOG_DIR, "manager.log"), line); } catch {} process.stdout.write(line); }

function writeUpdateStatus(patch) {
  let existing = {};
  try { existing = JSON.parse(fs.readFileSync(UPDATE_STATUS, "utf8")); } catch {}
  const next = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  try { fs.writeFileSync(UPDATE_STATUS, JSON.stringify(next, null, 2), "utf8"); } catch {}
  return next;
}
function readUpdateStatus() { try { return JSON.parse(fs.readFileSync(UPDATE_STATUS, "utf8")); } catch { return { state: "idle" }; } }

function npmCommand() {
  if (process.platform === "win32") return { file: process.env.ComSpec || "cmd.exe", prefix: ["/d", "/s", "/c"] };
  return { file: "npm", prefix: [] };
}

function spawnPos(command, args, logName) {
  const logPath = path.join(LOG_DIR, logName);
  const child = spawn(command, args, {
    cwd: ROOT,
    env: { ...process.env, FORCE_COLOR: "0", POS_MANAGER_TOKEN: MANAGER_ACCESS_TOKEN },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: process.platform === "win32"
  });
  const logStream = fs.createWriteStream(logPath, { flags: "a" });
  child.stdout.pipe(logStream, { end: false });
  child.stderr.pipe(logStream, { end: false });
  child.once("close", () => { try { logStream.end(); } catch {} });
  return child;
}

let serverChild = null;
let clientChild = null;
let shuttingDown = false;
let managerServer = null;

function childPid(child) { return child && child.pid ? child.pid : 0; }

function posProcessStatus(child) {
  return { running: Boolean(child && !child.killed && processExists(childPid(child))), pid: childPid(child) };
}

function portListeningPid(port) {
  try {
    if (process.platform === "win32") {
      const out = execFileSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
      const lines = out.split(/\r?\n/);
      const needle = `:${port}`;
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 5 && parts[0].toUpperCase() === "TCP" && parts[1].endsWith(needle) && parts[3].toUpperCase() === "LISTENING") {
          const pid = Number(parts[4]);
          if (pid) return pid;
        }
      }
    } else {
      const out = execFileSync("sh", ["-c", `ss -ltnp 2>/dev/null | grep -E '[:.]${port}([[:space:]]|$)' || true`], { encoding: "utf8" });
      const match = out.match(/pid=(\d+)/);
      if (match) return Number(match[1]);
    }
  } catch {}
  return 0;
}

function probeUrl(url, timeout = 700) {
  return new Promise(resolve => {
    const req = http.get(url, res => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(timeout, () => { try { req.destroy(); } catch {} resolve(false); });
  });
}

async function status() {
  const [apiOnline, frontendOnline] = await Promise.all([probeUrl(API_URL), probeUrl(POS_URL)]);
  const serverChildState = posProcessStatus(serverChild);
  const clientChildState = posProcessStatus(clientChild);
  const apiPort = Number(new URL(API_URL).port || 3001);
  const frontendPort = Number(new URL(POS_URL).port || 5173);
  const serverPid = serverChildState.running ? serverChildState.pid : (apiOnline ? portListeningPid(apiPort) : 0);
  const clientPid = clientChildState.running ? clientChildState.pid : (frontendOnline ? portListeningPid(frontendPort) : 0);
  return {
    manager: "running",
    managerPid: process.pid,
    server: { running: apiOnline, pid: serverPid, managed: serverChildState.running, health: apiOnline ? "online" : "offline" },
    client: { running: frontendOnline, pid: clientPid, managed: clientChildState.running, health: frontendOnline ? "online" : "offline" },
    posReady: apiOnline && frontendOnline,
    posUrl: POS_URL,
    apiUrl: API_URL,
    managerUrl: `http://127.0.0.1:${API_PORT}`,
    platform: process.platform,
    arch: process.arch,
    version: currentVersion(),
    nodeVersion: process.version,
    hostname: os.hostname(),
    update: readUpdateStatus()
  };
}

function descendantPids(rootPid) {
  const result = [];
  if (!rootPid) return result;
  try {
    if (process.platform === "win32") return result;
    const out = execFileSync("ps", ["-eo", "pid=,ppid="], { encoding: "utf8" });
    const children = new Map();
    for (const line of out.split(/\r?\n/)) {
      const m = line.trim().match(/^(\d+)\s+(\d+)$/);
      if (!m) continue;
      const pid = Number(m[1]), ppid = Number(m[2]);
      if (!children.has(ppid)) children.set(ppid, []);
      children.get(ppid).push(pid);
    }
    const queue = [Number(rootPid)], seen = new Set();
    while (queue.length) {
      const parent = queue.shift();
      for (const pid of (children.get(parent) || [])) {
        if (seen.has(pid)) continue;
        seen.add(pid); result.push(pid); queue.push(pid);
      }
    }
  } catch {}
  return result;
}

function killPidTree(pid, { force = false } = {}) {
  return new Promise(resolve => {
    if (!pid || pid === process.pid) return resolve();
    if (process.platform === "win32") {
      try { execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); } catch {}
      return resolve();
    }
    const descendants = descendantPids(pid);
    const signal = force ? "SIGKILL" : "SIGTERM";
    for (const childPid of descendants.reverse()) { try { process.kill(childPid, signal); } catch {} }
    try { process.kill(pid, signal); } catch {}
    const deadline = Date.now() + (force ? 1000 : 3500);
    const wait = () => {
      if (!processExists(pid) || Date.now() >= deadline) {
        if (!force && processExists(pid)) {
          for (const childPid of descendantPids(pid).reverse()) { try { process.kill(childPid, "SIGKILL"); } catch {} }
          try { process.kill(pid, "SIGKILL"); } catch {}
        }
        return resolve();
      }
      setTimeout(wait, 100);
    };
    wait();
  });
}

function killTree(child, options = {}) { return killPidTree(child && child.pid, options); }

async function stopPos({ force = false } = {}) {
  log(`${force ? "Force stopping" : "Stopping"} POS processes...`);

  // Do not rely only on child-process references. A POS may have been
  // started outside this Manager, or its original npm process may have
  // exited while the actual Node service kept listening on its port.
  const apiPort = Number(new URL(API_URL).port || 3001);
  const frontendPort = Number(new URL(POS_URL).port || 5173);
  const tracked = [childPid(serverChild), childPid(clientChild)];
  const listening = [portListeningPid(apiPort), portListeningPid(frontendPort)];
  const pids = [...new Set([...tracked, ...listening].filter(pid => pid && pid !== process.pid))];

  serverChild = null; clientChild = null;
  if (!pids.length) {
    log("No POS processes found to stop.");
    return;
  }

  await Promise.all(pids.map(pid => killPidTree(pid, { force })));

  // Give the OS a moment to release the listening sockets.
  await sleep(150);
  log(`POS processes stopped. Target PIDs: ${pids.join(", ")}`);
}

async function startPos({ openBrowser = true } = {}) {
  const apiAlreadyUp = await probeUrl(API_URL);
  const frontendAlreadyUp = await probeUrl(POS_URL);

  if (apiAlreadyUp && frontendAlreadyUp) {
    log("POS is already running; both API and frontend are reachable. Not starting duplicate processes.");
    if (openBrowser) openBrowserUrl(POS_URL);
    return;
  }

  log(`Starting POS from ${ROOT}`);
  const npm = npmCommand();

  if (!apiAlreadyUp && !(serverChild && processExists(childPid(serverChild)))) {
    serverChild = spawnPos(npm.file, process.platform === "win32" ? [...npm.prefix, "npm", "run", "server"] : ["run", "server"], "server.log");
    serverChild.on("exit", (code, signal) => { log(`Server process exited (code=${code}, signal=${signal || "none"}).`); if (!shuttingDown && code !== 0) log("Server stopped unexpectedly."); });
  } else if (apiAlreadyUp) {
    log(`POS API is already reachable at ${API_URL}; reusing the existing server process.`);
  }

  if (!frontendAlreadyUp && !(clientChild && processExists(childPid(clientChild)))) {
    clientChild = spawnPos(npm.file, process.platform === "win32" ? [...npm.prefix, "npm", "run", "client"] : ["run", "client"], "client.log");
    clientChild.on("exit", (code, signal) => { log(`Vite process exited (code=${code}, signal=${signal || "none"}).`); if (!shuttingDown && code !== 0) log("Vite stopped unexpectedly."); });
  } else if (frontendAlreadyUp) {
    log(`POS frontend is already reachable at ${POS_URL}; reusing the existing frontend process.`);
  }

  const apiReady = await waitForUrl(API_URL, 30000);
  const frontendReady = await waitForUrl(POS_URL, 30000);

  if (!apiReady) log(`Warning: POS API did not become reachable at ${API_URL} within 30 seconds.`);
  if (!frontendReady) log(`Warning: POS frontend did not become reachable at ${POS_URL} within 30 seconds.`);
  if (apiReady && frontendReady) {
    log(`POS is ready: API ${API_URL} and frontend ${POS_URL} are both reachable.`);
    if (openBrowser) openBrowserUrl(POS_URL);
  }
}

function waitForUrl(url, timeout) {
  const started = Date.now();
  return new Promise(resolve => {
    const retry = () => { if (Date.now() - started >= timeout) return resolve(false); setTimeout(check, 500); };
    const check = () => {
      const req = http.get(url, res => { res.resume(); if (res.statusCode >= 200 && res.statusCode < 500) return resolve(true); retry(); });
      req.on("error", retry); req.setTimeout(1000, () => { req.destroy(); retry(); });
    };
    check();
  });
}

function openBrowserUrl(url) {
  const custom = process.env.POS_BROWSER;
  try {
    if (custom) { spawn(custom, [url], { detached: true, stdio: "ignore", windowsHide: true }).unref(); return; }
    if (process.platform === "win32") {
      const candidates = [
        process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
        process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
        process.env["PROGRAMFILES(X86)"] && path.join(process.env["PROGRAMFILES(X86)"], "BraveSoftware", "Brave-Browser", "Application", "brave.exe")
      ].filter(Boolean);
      const brave = candidates.find(fs.existsSync);
      if (brave) { spawn(brave, ["--kiosk", "--no-first-run", "--disable-session-crashed-bubble", url], { detached: true, stdio: "ignore", windowsHide: true }).unref(); return; }
      const browserCandidates = [
        process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
        process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
        process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Microsoft", "Edge", "Application", "msedge.exe"),
        process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Microsoft", "EdgeWebView", "Application", "msedge.exe")
      ].filter(Boolean);
      const browser = browserCandidates.find(fs.existsSync);
      if (browser) { spawn(browser, ["--kiosk", "--no-first-run", "--disable-session-crashed-bubble", url], { detached: true, stdio: "ignore", windowsHide: true }).unref(); return; }
      execFileSync("cmd.exe", ["/c", "start", "", url], { windowsHide: true, stdio: "ignore" }); return;
    }
    for (const cmd of ["brave-browser", "brave", "google-chrome", "chromium", "chromium-browser", "microsoft-edge"]) {
      try { execFileSync("which", [cmd], { stdio: "ignore" }); spawn(cmd, ["--kiosk", "--no-first-run", "--disable-session-crashed-bubble", url], { detached: true, stdio: "ignore" }).unref(); return; } catch {}
    }
    spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  } catch (error) { log(`Could not open browser automatically: ${error.message}`); }
}
function openManagerUi() { openBrowserUrl(`http://127.0.0.1:${API_PORT}/`); }
function readManagerLog() { try { return fs.readFileSync(path.join(LOG_DIR, "manager.log"), "utf8").slice(-50000); } catch { return ""; } }

// Small ZIP implementation used for update validation/extraction and complete backups.
function crc32(buffer) {
  let crc = 0 ^ -1;
  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ -1) >>> 0;
}
function dosDateTime() {
  const d = new Date();
  return { dosTime: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2), dosDate: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}
function makeZip(entries) {
  const locals = [], centrals = []; let offset = 0; const now = dosDateTime();
  for (const entry of entries) {
    const name = entry.name.replace(/\\/g, "/"), nameBuf = Buffer.from(name, "utf8"), data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const compressed = zlib.deflateRawSync(data, { level: 6 }), crc = crc32(data);
    const local = Buffer.alloc(30 + nameBuf.length); local.writeUInt32LE(0x04034b50,0); local.writeUInt16LE(20,4); local.writeUInt16LE(8,8); local.writeUInt16LE(now.dosTime,10); local.writeUInt16LE(now.dosDate,12); local.writeUInt32LE(crc,14); local.writeUInt32LE(compressed.length,18); local.writeUInt32LE(data.length,22); local.writeUInt16LE(nameBuf.length,26); nameBuf.copy(local,30); locals.push(local,compressed);
    const central = Buffer.alloc(46 + nameBuf.length); central.writeUInt32LE(0x02014b50,0); central.writeUInt16LE(20,4); central.writeUInt16LE(20,6); central.writeUInt16LE(8,10); central.writeUInt16LE(now.dosTime,12); central.writeUInt16LE(now.dosDate,14); central.writeUInt32LE(crc,16); central.writeUInt32LE(compressed.length,20); central.writeUInt32LE(data.length,24); central.writeUInt16LE(nameBuf.length,28); central.writeUInt32LE(offset,42); nameBuf.copy(central,46); centrals.push(central); offset += local.length + compressed.length;
  }
  const localBuf = Buffer.concat(locals), centralBuf = Buffer.concat(centrals), eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50,0); eocd.writeUInt16LE(entries.length,8); eocd.writeUInt16LE(entries.length,10); eocd.writeUInt32LE(centralBuf.length,12); eocd.writeUInt32LE(localBuf.length,16); return Buffer.concat([localBuf,centralBuf,eocd]);
}
function findZipEnd(buffer) { for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) if (buffer.readUInt32LE(i) === 0x06054b50) return i; return -1; }
function readZipEntries(buffer) {
  const eocd = findZipEnd(buffer); if (eocd < 0) throw new Error("Invalid ZIP: end of archive was not found.");
  const count = buffer.readUInt16LE(eocd+10), centralSize = buffer.readUInt32LE(eocd+12), centralOffset = buffer.readUInt32LE(eocd+16);
  if (count > MAX_ZIP_ENTRIES || centralOffset + centralSize > buffer.length) throw new Error("Invalid ZIP: central directory is invalid.");
  const entries=[]; let pos=centralOffset;
  for(let i=0;i<count;i++) { if(pos+46>buffer.length||buffer.readUInt32LE(pos)!==0x02014b50) throw new Error("Invalid ZIP: corrupt central directory."); const method=buffer.readUInt16LE(pos+10), crc=buffer.readUInt32LE(pos+16), compressedSize=buffer.readUInt32LE(pos+20), uncompressedSize=buffer.readUInt32LE(pos+24), nameLen=buffer.readUInt16LE(pos+28), extraLen=buffer.readUInt16LE(pos+30), commentLen=buffer.readUInt16LE(pos+32), localOffset=buffer.readUInt32LE(pos+42); const name=buffer.subarray(pos+46,pos+46+nameLen).toString("utf8"); entries.push({name,method,crc,compressedSize,uncompressedSize,localOffset}); pos += 46+nameLen+extraLen+commentLen; }
  return entries;
}
function extractZipEntry(buffer, entry) {
  if(entry.localOffset+30>buffer.length||buffer.readUInt32LE(entry.localOffset)!==0x04034b50) throw new Error(`Invalid ZIP local header: ${entry.name}`);
  const nameLen=buffer.readUInt16LE(entry.localOffset+26), extraLen=buffer.readUInt16LE(entry.localOffset+28), start=entry.localOffset+30+nameLen+extraLen, end=start+entry.compressedSize; if(start<0||end>buffer.length) throw new Error(`Invalid ZIP entry: ${entry.name}`);
  const compressed=buffer.subarray(start,end); let data; if(entry.method===0) data=Buffer.from(compressed); else if(entry.method===8) data=zlib.inflateRawSync(compressed); else throw new Error(`Unsupported ZIP compression for ${entry.name}`);
  if(data.length!==entry.uncompressedSize||crc32(data)!==entry.crc) throw new Error(`ZIP checksum failed: ${entry.name}`); return data;
}
function safeRelative(name) {
  const n=String(name).replace(/\\/g,"/"); if(!n||n.includes("\0")||n.startsWith("/")||/^[A-Za-z]:/.test(n)) return null; const parts=n.split("/"); if(parts.some(p=>p===".."||p===".")) return null; return n;
}

function readUpdatePackage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) throw new Error("The update file is empty or not a valid ZIP.");
  if (buffer.length > MAX_UPDATE_BYTES) throw new Error("The update package is larger than the 300 MB limit.");
  const entries = readZipEntries(buffer);
  let total = 0;
  for (const e of entries) { if (!safeRelative(e.name)) throw new Error(`Unsafe path in update package: ${e.name}`); total += e.uncompressedSize; if (total > MAX_UNCOMPRESSED_UPDATE_BYTES) throw new Error("The uncompressed update is larger than the safety limit."); }
  const files = new Map();
  for (const e of entries) if (!e.name.endsWith("/")) files.set(e.name.replace(/\\/g,"/"), extractZipEntry(buffer,e));
  const packageEntry = [...files.keys()].find(k => /(^|\/)package\.json$/i.test(k));
  if (!packageEntry) throw new Error("The update package does not contain package.json.");
  const rootPrefix = packageEntry.slice(0, packageEntry.length - "package.json".length);
  const root = rootPrefix.endsWith("/") ? rootPrefix.slice(0,-1) : rootPrefix;
  const rel = name => name.startsWith(root + "/") ? name.slice(root.length+1) : (root === "" ? name : null);
  const rootFiles = new Map();
  for (const [name,data] of files) { const r=rel(name); if(r) rootFiles.set(r,data); else if(!name.startsWith(root+"/")) throw new Error(`Update contains multiple top-level folders/files: ${name}`); }
  const pkg = JSON.parse(rootFiles.get("package.json").toString("utf8"));
  if (pkg.name !== "grocery-pos") throw new Error("This ZIP is not a compatible Grocery POS update package.");
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(String(pkg.version||""))) throw new Error("The update package has an invalid version.");
  for (const r of rootFiles.keys()) { const first=r.split("/")[0]; if (["data","node_modules",".manager"].includes(first)) throw new Error(`Update package may not contain protected folder: ${first}`); }
  const required=["package.json","manager.js","server/index.js","src/main.jsx","manager-ui/index.html"];
  const missing=required.filter(x=>!rootFiles.has(x)); if(missing.length) throw new Error(`Update package is missing required files: ${missing.join(", ")}`);
  return { entries, files: rootFiles, package: pkg, rootPrefix: root, size: buffer.length, uncompressedSize: total };
}

async function extractUpdateTo(dir, packageInfoData) {
  await fsp.rm(dir,{recursive:true,force:true}); await fsp.mkdir(dir,{recursive:true});
  for(const [rel,data] of packageInfoData.files) { const target=path.join(dir,rel); const resolved=path.resolve(target); if(!resolved.startsWith(path.resolve(dir)+path.sep) && resolved!==path.resolve(dir)) throw new Error("Unsafe update extraction path."); await fsp.mkdir(path.dirname(target),{recursive:true}); await fsp.writeFile(target,data); }
}

async function createCompleteBackup(targetPath) {
  const dbPath=path.join(DATA_DIR,"pos.sqlite"); if(!fs.existsSync(dbPath)) throw new Error("POS database was not found.");
  let Database; try { Database=require("better-sqlite3"); } catch { throw new Error("better-sqlite3 is not available; run npm install before using backups."); }
  const tempDb=path.join(DATA_DIR,`manager-backup-${crypto.randomBytes(8).toString("hex")}.sqlite`);
  const db=new Database(dbPath,{readonly:true});
  try { await db.backup(tempDb); } finally { try { db.close(); } catch {} }
  const entries=[{name:"pos.sqlite",data:fs.readFileSync(tempDb)},{name:"product-images/",data:Buffer.alloc(0)}];
  const imageDir=path.join(DATA_DIR,"product-images");
  if(fs.existsSync(imageDir)) for(const name of fs.readdirSync(imageDir)) { const target=path.join(imageDir,name); if(fs.statSync(target).isFile()) entries.push({name:`product-images/${name}`,data:fs.readFileSync(target)}); }
  entries.push({name:"manifest.json",data:Buffer.from(JSON.stringify({format:"Grocery POS Complete Backup",version:currentVersion(),createdAt:new Date().toISOString(),createdBy:"EverJoy POS Manager",includes:["pos.sqlite","product-images/"]},null,2))});
  const zip=makeZip(entries); if(zip.length>250*1024*1024) throw new Error("Complete backup exceeds the 250 MB backup limit.");
  await fsp.writeFile(targetPath,zip); try{await fsp.unlink(tempDb);}catch{}
  return {path:targetPath,size:zip.length};
}

async function requestBody(req, limit=MAX_UPDATE_BYTES) {
  const chunks=[]; let total=0; return new Promise((resolve,reject)=>{ req.on("data",chunk=>{ total+=chunk.length; if(total>limit){ reject(new Error("Upload exceeds the 300 MB limit.")); req.destroy(); return; } chunks.push(chunk); }); req.on("end",()=>resolve(Buffer.concat(chunks))); req.on("error",reject); });
}

async function validateIncomingUpdate() { const buffer=await fsp.readFile(UPDATE_ZIP); const info=readUpdatePackage(buffer); const cur=currentVersion(); if(cur!=="unknown" && compareVersions(info.package.version,cur)<=0) throw new Error(`Update version ${info.package.version} is not newer than the installed version ${cur}.`); return info; }
function compareVersions(a,b){const parse=v=>String(v).trim().split(/[+-]/,1)[0].split(".").map(Number);const pa=parse(a),pb=parse(b);for(let i=0;i<3;i++){const av=Number.isFinite(pa[i])?pa[i]:0;const bv=Number.isFinite(pb[i])?pb[i]:0;if(av!==bv)return av-bv;}return 0;}

function readManagerConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")); } catch { return {}; }
}
function writeManagerConfig(patch) {
  const next = { ...readManagerConfig(), ...patch, updatedAt: new Date().toISOString() };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), "utf8");
  return next;
}
function githubRepo() { return readManagerConfig().githubRepo || DEFAULT_GITHUB_REPO; }
function normalizeGithubRepo(value) {
  let v = String(value || "").trim();
  v = v.replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/\.git$/i, "").replace(/^\/+|\/+$/g, "");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(v)) throw new Error("GitHub repository must look like owner/repository.");
  return v;
}
function githubHeaders() {
  return {
    "Accept": "application/vnd.github+json",
    "User-Agent": "EverJoy-POS-Manager",
    "X-GitHub-Api-Version": "2022-11-28"
  };
}
async function githubFetchJson(url) {
  const res = await fetch(url, { headers: githubHeaders(), redirect: "follow" });
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch {}
  if (!res.ok) {
    const msg = data.message || `GitHub request failed with HTTP ${res.status}.`;
    if (res.status === 404) throw new Error("GitHub repository or latest release was not found. Make sure the repository is public and has a published release.");
    if (res.status === 403) throw new Error("GitHub rate limit or access restriction was encountered. Try again later.");
    throw new Error(msg);
  }
  return data;
}
async function getGithubLatestRelease() {
  const repo = githubRepo();
  const data = await githubFetchJson(`${GITHUB_API}/repos/${repo}/releases/latest`);
  const tag = String(data.tag_name || "").trim().replace(/^v/i, "");
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(tag)) throw new Error(`GitHub release tag "${data.tag_name || ""}" does not contain a supported POS version.`);
  const zipAssets = Array.isArray(data.assets) ? data.assets.filter(a => String(a.name || "").toLowerCase().endsWith(".zip")) : [];
  if (!zipAssets.length) throw new Error("The latest GitHub release does not contain a .zip POS update asset.");
  const preferred = zipAssets.find(a => String(a.name).toLowerCase().includes("grocery-pos")) || zipAssets[0];
  return {
    repo,
    id: data.id,
    tag: data.tag_name,
    version: tag,
    name: data.name || data.tag_name,
    body: data.body || "",
    publishedAt: data.published_at || data.created_at || null,
    htmlUrl: data.html_url || `https://github.com/${repo}/releases/tag/${data.tag_name}`,
    asset: {
      id: preferred.id,
      name: preferred.name,
      size: Number(preferred.size || 0),
      url: preferred.url,
      browserDownloadUrl: preferred.browser_download_url,
      digest: preferred.digest || null
    }
  };
}
async function downloadGithubRelease(release) {
  if (githubDownloadInProgress) throw new Error("A GitHub update download is already in progress.");
  githubDownloadInProgress = true;
  const temp = path.join(UPDATE_DIR, `github-${Date.now()}.part`);
  try {
    writeUpdateStatus({ state: "github-downloading", source: "github", repo: release.repo, releaseUrl: release.htmlUrl, newVersion: release.version, assetName: release.asset.name, releaseName: release.name, releaseNotes: release.body, digest: release.asset.digest, downloadedBytes: 0, totalBytes: release.asset.size, message: `Downloading ${release.asset.name} from GitHub…` });
    const res = await fetch(release.asset.url, { headers: { ...githubHeaders(), "Accept": "application/octet-stream" }, redirect: "follow" });
    if (!res.ok || !res.body) throw new Error(`GitHub asset download failed with HTTP ${res.status}.`);
    const total = Number(res.headers.get("content-length") || release.asset.size || 0);
    if (total > MAX_UPDATE_BYTES) throw new Error("The GitHub update package is larger than the 300 MB limit.");
    const out = fs.createWriteStream(temp);
    const hash = crypto.createHash("sha256");
    let downloaded = 0;
    try {
      for await (const chunk of res.body) {
        downloaded += chunk.length;
        if (downloaded > MAX_UPDATE_BYTES) throw new Error("The GitHub update package exceeded the 300 MB limit.");
        hash.update(chunk); out.write(chunk);
        if (downloaded === chunk.length || downloaded - (githubDownloadProgressLast || 0) >= 256 * 1024) { githubDownloadProgressLast = downloaded; writeUpdateStatus({ downloadedBytes: downloaded, totalBytes: total }); }
      }
    } finally { out.end(); await new Promise(resolve => out.once("close", resolve)); }
    const actual = hash.digest("hex");
    const expected = release.asset.digest && /^sha256:/i.test(release.asset.digest) ? release.asset.digest.slice(7).toLowerCase() : null;
    if (expected && actual !== expected) throw new Error("GitHub update checksum verification failed. The downloaded file does not match GitHub's SHA-256 digest.");
    await fsp.rename(temp, UPDATE_ZIP);
    const info = await validateIncomingUpdate();
    writeUpdateStatus({ state: "github-ready", source: "github", repo: release.repo, releaseUrl: release.htmlUrl, releaseName: release.name, releaseNotes: release.body, assetName: release.asset.name, digest: release.asset.digest || `sha256:${actual}`, downloadedBytes: downloaded, totalBytes: total, filename: release.asset.name, newVersion: info.package.version, size: info.size, uncompressedSize: info.uncompressedSize, message: `✓ GitHub update ${info.package.version} downloaded, verified, and validated.` });
    return info;
  } catch (error) {
    try { await fsp.unlink(temp); } catch {}
    writeUpdateStatus({ state: "github-failed", source: "github", message: error.message, error: error.message });
    throw error;
  } finally { githubDownloadInProgress = false; githubDownloadProgressLast = 0; }
}
let githubDownloadProgressLast = 0;

function diskInfo() {
  try { const s=fs.statfsSync(DATA_DIR); return {freeBytes:Number(s.bavail)*Number(s.bsize), totalBytes:Number(s.blocks)*Number(s.bsize)}; } catch { return null; }
}

function createUpdaterScript(args) {
  const script = `
const fs=require('fs'), fsp=fs.promises, path=require('path'), http=require('http'), {spawn,execFileSync}=require('child_process');
const [ROOT,ZIP,BACKUP,MANAGER_PID,OLD_VERSION,NEW_VERSION]=process.argv.slice(2);
const DATA=path.join(ROOT,'data'), MGR=path.join(DATA,'.manager'), LOG=path.join(MGR,'logs','manager.log'), STATUS=path.join(MGR,'updates','status.json'), ROLLBACK=path.join(MGR,'rollbacks',OLD_VERSION+'-'+Date.now());
const sleep=ms=>new Promise(r=>setTimeout(r,ms)); const exists=p=>{try{fs.accessSync(p);return true}catch{return false}}; const log=m=>{try{fs.appendFileSync(LOG,'['+new Date().toISOString()+'] [UPDATER] '+m+'\\n')}catch{}};
const writeStatus=o=>{let x={};try{x=JSON.parse(fs.readFileSync(STATUS,'utf8'))}catch{};fs.writeFileSync(STATUS,JSON.stringify({...x,...o,updatedAt:new Date().toISOString()},null,2))};
function waitPid(pid,timeout){return new Promise(resolve=>{const st=Date.now();const c=()=>{if(!pid||!existsPid(pid)||Date.now()-st>timeout)return resolve(true);setTimeout(c,250)};c()})}; function existsPid(pid){try{process.kill(Number(pid),0);return true}catch{return false}};
function copyDir(src,dst,exclude){for(const ent of fs.readdirSync(src,{withFileTypes:true})){if(exclude.has(ent.name))continue;const a=path.join(src,ent.name),b=path.join(dst,ent.name);if(ent.isDirectory()){fs.mkdirSync(b,{recursive:true});copyDir(a,b,exclude)}else fs.copyFileSync(a,b)}}
function removeAppFiles(root){const preserved=new Set(['data','node_modules','.git','start-manager-linux.sh','start-manager-windows.bat','start-pos-linux.sh','start-pos-windows.bat']);for(const ent of fs.readdirSync(root,{withFileTypes:true})){if(preserved.has(ent.name))continue;const p=path.join(root,ent.name);if(ent.isDirectory())fs.rmSync(p,{recursive:true,force:true});else fs.rmSync(p,{force:true})}}
function copyAll(src,dst){for(const ent of fs.readdirSync(src,{withFileTypes:true})){const a=path.join(src,ent.name),b=path.join(dst,ent.name);if(ent.isDirectory()){fs.mkdirSync(b,{recursive:true});copyAll(a,b)}else{fs.mkdirSync(path.dirname(b),{recursive:true});fs.copyFileSync(a,b)}}}
function run(cmd,args,cwd){return new Promise((resolve,reject)=>{const p=spawn(cmd,args,{cwd,stdio:'pipe',windowsHide:process.platform==='win32'});let out='';p.stdout.on('data',d=>{out+=d.toString();log(d.toString().trim())});p.stderr.on('data',d=>{out+=d.toString();log(d.toString().trim())});p.on('error',reject);p.on('close',c=>c===0?resolve(out):reject(new Error(cmd+' exited with code '+c)))})}
async function stopManagerByApi(){try{await new Promise((resolve,reject)=>{const r=http.get('http://127.0.0.1:3010/status',x=>{let b='';x.on('data',d=>b+=d);x.on('end',()=>{try{const s=JSON.parse(b);const pid=Number(s.managerPid);if(pid&&process.platform==='win32'){try{execFileSync('taskkill',['/PID',String(pid),'/T','/F'],{stdio:'ignore',windowsHide:true})}catch{}}else if(pid){try{process.kill(pid,'SIGTERM')}catch{}}resolve()}catch{resolve()}})});r.on('error',()=>resolve());r.setTimeout(1000,()=>{r.destroy();resolve()})})}catch{}}
async function main(){
 writeStatus({state:'installing',oldVersion:OLD_VERSION,newVersion:NEW_VERSION,message:'Waiting for the Manager to close.'}); await waitPid(MANAGER_PID,15000);
 log('Manager process stopped; beginning application update.');
 fs.mkdirSync(ROLLBACK,{recursive:true}); copyDir(ROOT,ROLLBACK,new Set(['data','node_modules','.git']));
 writeStatus({state:'installing',message:'Installing application files.'});
 const tmp=path.join(MGR,'updates','extract-'+Date.now()); fs.mkdirSync(tmp,{recursive:true});
 // The manager already validated and extracted the package into this directory when launching us.
 const extracted=path.join(MGR,'updates','prepared');
 if(!exists(extracted)) throw new Error('Prepared update directory is missing.');
 removeAppFiles(ROOT); copyAll(extracted,ROOT);
 writeStatus({state:'installing',message:'Installing dependencies.'});
 const npm=process.platform==='win32'?(process.env.ComSpec||'cmd.exe'):'npm'; const npmArgs=process.platform==='win32'?['/d','/s','/c','npm','install','--no-audit','--no-fund']:['install','--no-audit','--no-fund']; await run(npm,npmArgs,ROOT);
 writeStatus({state:'starting',message:'Starting the updated POS Manager.'});
 const node=process.execPath; const child=spawn(node,['manager.js','start','--ui','--no-browser'],{cwd:ROOT,detached:true,stdio:'ignore',windowsHide:process.platform==='win32'}); child.unref();
 const started=Date.now(); let ready=false; while(Date.now()-started<45000){await sleep(1000); try{await new Promise((res,rej)=>{const r=http.get('http://127.0.0.1:3010/status',x=>{x.resume();x.statusCode>=200&&x.statusCode<500?res():rej()});r.on('error',rej);r.setTimeout(1200,()=>{r.destroy();rej()})}) ;ready=true;break}catch{}}
 if(!ready) throw new Error('Updated Manager did not become reachable within 45 seconds.');
 writeStatus({state:'success',oldVersion:OLD_VERSION,newVersion:NEW_VERSION,message:'Update installed successfully.',completedAt:new Date().toISOString(),backupPath:BACKUP});
 log('Update completed successfully.');
 try{fs.rmSync(ROLLBACK,{recursive:true,force:true})}catch{}
 try{fs.rmSync(ZIP,{force:true})}catch{} try{fs.rmSync(extracted,{recursive:true,force:true})}catch{}
} 
main().catch(async e=>{log('Update failed: '+(e.stack||e)); writeStatus({state:'rolling-back',message:'Update failed. Restoring the previous application.'}); await stopManagerByApi(); await sleep(1500); try{removeAppFiles(ROOT);copyAll(ROLLBACK,ROOT);const npm=process.platform==='win32'?(process.env.ComSpec||'cmd.exe'):'npm';const args=process.platform==='win32'?['/d','/s','/c','npm','install','--no-audit','--no-fund']:['install','--no-audit','--no-fund'];await run(npm,args,ROOT);const p=spawn(process.execPath,['manager.js','start','--ui','--no-browser'],{cwd:ROOT,detached:true,stdio:'ignore',windowsHide:process.platform==='win32'});p.unref();writeStatus({state:'rolled-back',message:'Update failed; previous version restored.',error:e.message,completedAt:new Date().toISOString()});}catch(rb){writeStatus({state:'failed',message:'Automatic rollback also failed.',error:e.message+' | Rollback: '+rb.message})}});
`;
  const file=path.join(os.tmpdir(),`everjoy-pos-updater-${process.pid}-${Date.now()}.js`); fs.writeFileSync(file,script,'utf8'); return file;
}

async function beginInstallUpdate() {
  const info=await validateIncomingUpdate();
  writeUpdateStatus({state:"preparing",oldVersion:currentVersion(),newVersion:info.package.version,message:"Creating a complete backup before updating."});
  const backupPath=path.join(BACKUP_DIR,`pre-update-${info.package.version}-${nowStamp()}.zip`);
  await createCompleteBackup(backupPath);
  const buffer=await fsp.readFile(UPDATE_ZIP); const parsed=readUpdatePackage(buffer); const prepared=path.join(UPDATE_DIR,"prepared"); await extractUpdateTo(prepared,parsed);
  writeUpdateStatus({state:"ready-to-install",oldVersion:currentVersion(),newVersion:info.package.version,backupPath,preparedAt:new Date().toISOString(),message:"Backup complete. Preparing the POS for update."});
  const runner=createUpdaterScript();
  const child=spawn(process.execPath,[runner,ROOT,UPDATE_ZIP,backupPath,String(process.pid),currentVersion(),info.package.version],{detached:true,stdio:"ignore",windowsHide:process.platform==="win32"}); child.unref();
  log(`Update ${info.package.version} accepted. Updater started in a separate process.`);
  setTimeout(()=>shutdownForUpdate(),500);
  return {ok:true,version:info.package.version};
}
async function shutdownForUpdate(){ if(shuttingDown)return; shuttingDown=true; log("Shutting down Manager for application update..."); await stopPos(); try{managerServer.close()}catch{} clearPid(); setTimeout(()=>process.exit(0),100); }

function serveManagerUi(req,res){ if(req.method!=="GET")return false; const pathname=new URL(req.url,`http://127.0.0.1:${API_PORT}`).pathname; if(pathname!=="/"&&pathname!=="/index.html")return false; if(!fs.existsSync(MANAGER_UI)){res.statusCode=500;res.end("Manager UI is missing.");return true;}res.statusCode=200;res.setHeader("Content-Type","text/html; charset=utf-8");fs.createReadStream(MANAGER_UI).pipe(res);return true; }

function postBackupToPos(buffer) {
  return new Promise((resolve, reject) => {
    const target = new URL("/api/backup/restore", API_URL);
    const req = http.request(target, { method: "POST", headers: { "Content-Type": "application/octet-stream", "Content-Length": buffer.length, "X-Manager-Token": MANAGER_ACCESS_TOKEN, "X-Allow-Schema-Mismatch": "true" }, timeout: 120000 }, res => {
      const chunks = []; res.on("data", chunk => chunks.push(chunk)); res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8"); let data = {}; try { data = JSON.parse(text); } catch { data = { error: text || `HTTP ${res.statusCode}` }; }
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(data); const error = new Error(data.error || `POS restore failed with HTTP ${res.statusCode}.`); error.statusCode = res.statusCode; reject(error);
      });
    });
    req.on("timeout", () => { try { req.destroy(new Error("POS restore request timed out.")); } catch {} }); req.on("error", reject); req.end(buffer);
  });
}

async function restoreManagerBackup(name) {
  if (!/^[A-Za-z0-9._-]+\.zip$/.test(name)) throw new Error("Invalid backup filename.");
  const target = path.join(BACKUP_DIR, name); if (!fs.existsSync(target)) throw new Error("Backup not found.");
  const stat = fs.statSync(target); if (stat.size > 300 * 1024 * 1024) throw new Error("Backup file is larger than the 300 MB restore limit.");
  if (!(await probeUrl(API_URL))) { await startPos({ openBrowser: false }); if (!(await probeUrl(API_URL))) throw new Error("The POS server could not be started for restore."); }
  const safetyPath = path.join(BACKUP_DIR, `pre-restore-${nowStamp()}.zip`); await createCompleteBackup(safetyPath);
  const buffer = await fsp.readFile(target); let result;
  try { result = await postBackupToPos(buffer); } catch (error) {
    if (error.statusCode === 401) { log("POS restore endpoint rejected the Manager token; restarting POS under Manager control and retrying."); await stopPos(); await startPos({ openBrowser: false }); result = await postBackupToPos(buffer); } else throw error;
  }
  return { ...result, filename: name, safetyBackup: path.basename(safetyPath) };
}

function createManagerServer(){
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,`http://127.0.0.1:${API_PORT}`); if(serveManagerUi(req,res))return;
  res.setHeader("Access-Control-Allow-Origin",`http://127.0.0.1:${API_PORT}`);res.setHeader("Access-Control-Allow-Methods","GET,POST,OPTIONS");res.setHeader("Access-Control-Allow-Headers","Content-Type, X-Update-Filename");
  if(req.method==="OPTIONS"){res.statusCode=204;return res.end();}
  const json=(code,obj)=>{res.statusCode=code;res.setHeader("Content-Type","application/json; charset=utf-8");res.end(JSON.stringify(obj));};
  try{
   if(req.method==="GET"&&url.pathname==="/status")return json(200,await status());
   if(req.method==="GET"&&url.pathname==="/logs")return json(200,{text:readManagerLog()});
   if(req.method==="GET"&&url.pathname==="/storage")return json(200,{dataDir:DATA_DIR,backupCount:fs.existsSync(BACKUP_DIR)?fs.readdirSync(BACKUP_DIR).filter(x=>x.endsWith('.zip')).length:0,storage:diskInfo(),dbSize:fs.existsSync(path.join(DATA_DIR,'pos.sqlite'))?fs.statSync(path.join(DATA_DIR,'pos.sqlite')).size:0});
   if(req.method==="GET"&&url.pathname==="/github/config")return json(200,{repo:githubRepo()});
   if(req.method==="POST"&&url.pathname==="/github/config"){const body=await requestBody(req,64*1024);let data={};try{data=JSON.parse(body.toString("utf8"))}catch{throw new Error("Invalid GitHub configuration JSON.");}const repo=normalizeGithubRepo(data.repo);writeManagerConfig({githubRepo:repo});return json(200,{ok:true,repo});}
   if(req.method==="GET"&&url.pathname==="/github/check"){const release=await getGithubLatestRelease();const comparison=compareVersions(release.version,currentVersion());return json(200,{ok:true,release,installedVersion:currentVersion(),updateAvailable:comparison>0,comparison});}
   if(req.method==="POST"&&url.pathname==="/github/download"){if(githubDownloadInProgress)return json(409,{error:"A GitHub update download is already in progress."});const release=await getGithubLatestRelease();if(compareVersions(release.version,currentVersion())<=0)throw new Error(`GitHub version ${release.version} is not newer than the installed version ${currentVersion()}.`);downloadGithubRelease(release).catch(error=>log(`GitHub download error: ${error.stack||error}`));return json(202,{ok:true,version:release.version,asset:release.asset.name});}
   if(req.method==="GET"&&url.pathname==="/update/status")return json(200,readUpdateStatus());
   if(req.method==="POST"&&url.pathname==="/update/clear"){try{fs.unlinkSync(UPDATE_STATUS)}catch{};return json(200,{ok:true,state:"idle"});}
   if(req.method==="GET"&&url.pathname==="/backups"){const items=fs.existsSync(BACKUP_DIR)?fs.readdirSync(BACKUP_DIR).filter(x=>x.endsWith(".zip")).map(name=>{const st=fs.statSync(path.join(BACKUP_DIR,name));return {name,size:st.size,createdAt:st.mtime.toISOString()}}).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)):[];return json(200,{items});}
   if(req.method==="GET"&&url.pathname==="/backup/download"){const name=String(url.searchParams.get("name")||"");if(!/^[A-Za-z0-9._-]+\.zip$/.test(name))return json(400,{error:"Invalid backup filename."});const target=path.join(BACKUP_DIR,name);if(!fs.existsSync(target))return json(404,{error:"Backup not found."});res.statusCode=200;res.setHeader("Content-Type","application/zip");res.setHeader("Content-Disposition",`attachment; filename="${name}"`);fs.createReadStream(target).pipe(res);return;} 
   if(req.method==="POST"&&url.pathname==="/start"){await startPos({openBrowser:false});return json(200,{ok:true,...await status()});}
   if(req.method==="POST"&&url.pathname==="/restart"){await stopPos();await startPos({openBrowser:false});return json(200,{ok:true,...await status()});}
   if(req.method==="POST"&&url.pathname==="/stop"){await stopPos();return json(200,{ok:true,...await status()});}
   if(req.method==="POST"&&url.pathname==="/force-stop"){await stopPos({force:true});return json(200,{ok:true,...await status()});}
   if(req.method==="POST"&&url.pathname==="/open"){openBrowserUrl(POS_URL);return json(200,{ok:true});}
   if(req.method==="POST"&&url.pathname==="/backup/create"){const target=path.join(BACKUP_DIR,`manual-${nowStamp()}.zip`);const result=await createCompleteBackup(target);return json(200,{ok:true,path:result.path,size:result.size,filename:path.basename(target)});}
   if(req.method==="POST"&&url.pathname==="/backup/restore"){const body=await requestBody(req,64*1024);let data={};try{data=JSON.parse(body.toString("utf8"))}catch{throw new Error("Invalid restore request.");}const result=await restoreManagerBackup(String(data.name||""));return json(200,{ok:true,...result,message:`Backup ${String(data.name||"")} restored successfully. A safety backup was created first.`});}
   if(req.method==="POST"&&url.pathname==="/update/upload"){const body=await requestBody(req);await fsp.writeFile(UPDATE_ZIP,body);writeUpdateStatus({state:"uploaded",filename:req.headers["x-update-filename"]||"update.zip",size:body.length,message:"Update package uploaded. Validate it before installing."});return json(200,{ok:true,size:body.length,filename:req.headers["x-update-filename"]||"update.zip"});}
   if(req.method==="POST"&&url.pathname==="/update/validate"){const info=await validateIncomingUpdate();writeUpdateStatus({state:"validated",filename:path.basename(String(req.headers["x-update-filename"]||"incoming.zip")),newVersion:info.package.version,size:info.size,uncompressedSize:info.uncompressedSize,message:"Update package is valid and ready to install."});return json(200,{ok:true,version:info.package.version,size:info.size,uncompressedSize:info.uncompressedSize});}
   if(req.method==="POST"&&url.pathname==="/update/install"){const result=await beginInstallUpdate();return json(202,result);}
   return json(404,{error:"Not found."});
  }catch(error){log(`Manager API error: ${error.stack||error}`);return json(400,{error:error.message||"Request failed."});}
 });
 server.listen(API_PORT,"127.0.0.1",()=>log(`Manager control API listening on http://127.0.0.1:${API_PORT}`));return server;
}

async function main(){
 const command=process.argv[2]||"start", noBrowser=process.argv.includes("--no-browser"), openUi=process.argv.includes("--ui");
 if(command==="status"){const pid=readPid();console.log(JSON.stringify({managerPid:pid,running:processExists(pid),pidFile:PID_FILE},null,2));return;}
 if(command==="stop"){const pid=readPid();if(!pid||!processExists(pid)){console.log("POS Manager is not running.");try{fs.unlinkSync(PID_FILE)}catch{}return;}if(process.platform==="win32"){try{execFileSync("taskkill",["/PID",String(pid),"/T","/F"],{windowsHide:true})}catch{}}else{try{process.kill(pid,"SIGTERM")}catch{}}console.log("POS Manager stop requested.");return;}
 if(command!=="start"){console.log("Usage: node manager.js [start|stop|status] [--no-browser] [--ui]");process.exitCode=1;return;}
 const existing=readPid();if(existing&&existing!==process.pid&&processExists(existing)){console.log(`POS Manager is already running (PID ${existing}).`);return;}
 writePid();managerServer=createManagerServer();const cleanup=async()=>{if(shuttingDown)return;shuttingDown=true;log("POS Manager shutting down.");await stopPos();try{managerServer.close()}catch{}clearPid();};process.on("SIGINT",cleanup);process.on("SIGTERM",cleanup);process.on("exit",clearPid);
 await startPos({openBrowser:!noBrowser}); if(openUi)openManagerUi(); log("EverJoy POS Manager is running.");
}
main().catch(async err=>{log(`Fatal manager error: ${err.stack||err}`);try{await stopPos()}catch{}clearPid();process.exit(1)});
