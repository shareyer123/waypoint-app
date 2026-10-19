"use strict";
// Waypoint main process: window, menu, config, vault file access, live watch, network block.
const { app, BrowserWindow, Menu, dialog, ipcMain, shell, session, protocol, nativeTheme } = require("electron");
const path = require("path");
const fs = require("fs");

// Config lives in %APPDATA%\Waypoint (WAYPOINT_CONFIG_DIR overrides it, for tests).
const CONFIG_DIR = process.env.WAYPOINT_CONFIG_DIR || path.join(app.getPath("appData"), "Waypoint");
app.setPath("userData", path.join(CONFIG_DIR, "app-data"));
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

const IMAGE_TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".bmp": "image/bmp" };

protocol.registerSchemesAsPrivileged([{ scheme: "wpvault", privileges: { standard: true, secure: true } }]);

let win = null;
let vault = null;          // absolute path of the open vault
let watcher = null;
let dirty = false;         // renderer reports unsaved edits
const SAMPLE = path.join(__dirname, "sample-vault");   // shipped example vault (dev and testing)
const PICK = process.argv.includes("--pick");          // npm run dev: always show the vault picker
const blocked = [];        // network requests we cancelled (kept for the e2e report)

/* ---------- config ---------- */
function readConfig() {
  // Strip a BOM: Windows PowerShell 5.1 writes one with Set-Content -Encoding utf8 (SETUP.md step 5).
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8").replace(/^﻿/, "")); } catch { return {}; }
}
function writeConfig(cfg) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}
function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }

/** Vault path from the command line: `npm start -- "C:\path"`. Flags and the app path are skipped. */
function vaultFromArgs(argv) {
  const args = argv.slice(app.isPackaged ? 1 : 2).filter((a) => !a.startsWith("--") && a !== ".");
  for (let i = args.length - 1; i >= 0; i--) if (isDir(args[i])) return path.resolve(args[i]);
  return null;
}

/* ---------- vault files ---------- */
// _Template is the copy source for new projects: Codex reads it, Waypoint hides it.
const skipName = (n) => n.startsWith(".") || n === "node_modules" || n === "_Template";
const toRel = (abs) => path.relative(vault, abs).split(path.sep).join("/");

/** Resolve a vault-relative path; null if it escapes the vault. */
function inVault(rel) {
  if (!vault || typeof rel !== "string") return null;
  const abs = path.resolve(vault, rel);
  const r = path.relative(vault, abs);
  if (!r || r.startsWith("..") || path.isAbsolute(r)) return null;
  if (r.split(path.sep).some(skipName)) return null;
  return abs;
}
const isMd = (p) => /\.md$/i.test(p);
// Notes written by Windows PowerShell 5.1 start with a BOM, which would break the first heading.
const readText = (abs) => fs.readFileSync(abs, "utf8").replace(/^﻿/, "");

function listNotes() {
  const out = [];
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (skipName(e.name)) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile() && isMd(e.name)) {
        try { out.push({ path: toRel(abs), text: readText(abs) }); } catch { /* unreadable: skip */ }
      }
    }
  };
  if (vault) walk(vault);
  return out;
}

/* ---------- live watch ---------- */
function startWatch() {
  if (watcher) { watcher.close(); watcher = null; }
  if (!vault) return;
  let pending = new Set(), timer = null;
  const flush = () => {
    timer = null;
    const names = [...pending]; pending = new Set();
    if (!win || win.isDestroyed()) return;
    // Anything that is not a plain .md file (a folder renamed, moved or deleted) → full rescan.
    const simple = names.every((n) => n && isMd(n));
    if (!simple) { win.webContents.send("vault:reset", listNotes()); return; }
    const changes = [];
    for (const n of names) {
      const rel = n.split(path.sep).join("/");
      const abs = inVault(rel);
      if (!abs) continue;
      let text = null;
      try { text = readText(abs); } catch { /* gone */ }
      changes.push(text === null ? { type: "delete", path: rel } : { type: "upsert", path: rel, text });
    }
    if (changes.length) win.webContents.send("vault:changes", changes);
  };
  try {
    watcher = fs.watch(vault, { recursive: true }, (_ev, name) => {
      pending.add(name ? String(name) : "");
      clearTimeout(timer); timer = setTimeout(flush, 200);
    });
    watcher.on("error", () => { /* vault folder removed: the next open re-arms it */ });
  } catch (e) {
    console.error("Watch failed:", e.message);
  }
}

function setVault(p, save = true) {
  vault = p;
  if (save) { const cfg = readConfig(); cfg.vault = p; writeConfig(cfg); }
  startWatch();
  if (win) win.setTitle("Waypoint — " + path.basename(p));
  return vaultInfo();
}
function vaultInfo() {
  if (!vault) return null;
  const cfg = readConfig();
  return { path: vault, name: path.basename(vault), recent: (cfg.recent || []).filter(isDir) };
}
function remember(p) {
  const cfg = readConfig();
  cfg.recent = [p, ...(cfg.recent || []).filter((r) => r !== p)].slice(0, 5);
  writeConfig(cfg);
}

async function chooseVault() {
  if (!(await confirmDiscard())) return null;
  const r = await dialog.showOpenDialog(win, { title: "Choose vault folder", properties: ["openDirectory", "createDirectory"] });
  if (r.canceled || !r.filePaths[0]) return null;
  remember(r.filePaths[0]);
  dirty = false;
  const info = setVault(r.filePaths[0]);
  win.webContents.send("vault:opened", { ...info, notes: listNotes() });
  return info;
}

async function confirmDiscard() {
  if (!dirty) return true;
  const r = await dialog.showMessageBox(win, { type: "warning", buttons: ["Discard changes", "Cancel"], defaultId: 1, cancelId: 1,
    title: "Waypoint", message: "You have unsaved changes.", detail: "Discard them?" });
  return r.response === 0;
}

/* ---------- IPC ---------- */
function handlers() {
  ipcMain.handle("vault:get", () => (vault ? { ...vaultInfo(), notes: listNotes() }
    : { path: null, recent: (readConfig().recent || []).filter(isDir), sample: PICK && isDir(SAMPLE) }));
  ipcMain.handle("vault:sample", async () => {
    if (!isDir(SAMPLE) || !(await confirmDiscard())) return null;
    dirty = false;
    const info = setVault(SAMPLE, false);
    return { ...info, notes: listNotes() };
  });
  ipcMain.handle("vault:choose", () => chooseVault());
  ipcMain.handle("vault:openRecent", async (_e, p) => {
    if (!isDir(p) || !(await confirmDiscard())) return null;
    remember(p); dirty = false;
    const info = setVault(p);
    return { ...info, notes: listNotes() };
  });
  ipcMain.handle("note:read", (_e, rel) => { const abs = inVault(rel); return abs && isMd(abs) ? readText(abs) : null; });
  ipcMain.handle("note:write", (_e, rel, text) => {
    const abs = inVault(rel);
    if (!abs || !isMd(abs) || typeof text !== "string") throw new Error("Not a note inside the vault: " + rel);
    fs.writeFileSync(abs, text, "utf8");
    return true;
  });
  ipcMain.handle("note:create", (_e, rel, text) => {
    const abs = inVault(rel);
    if (!abs || !isMd(abs)) throw new Error("Not a note path inside the vault: " + rel);
    if (fs.existsSync(abs)) throw new Error("A note already exists at " + rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, String(text || ""), { encoding: "utf8", flag: "wx" });
    return toRel(abs);
  });
  ipcMain.handle("link:external", async (_e, url) => {
    if (!/^(https?:|mailto:)/i.test(String(url))) return false;
    const r = await dialog.showMessageBox(win, { type: "question", buttons: ["Open in browser", "Cancel"], defaultId: 1, cancelId: 1,
      title: "Open link", message: "Open this link in your web browser?", detail: String(url) });
    if (r.response !== 0) return false;
    await shell.openExternal(String(url));
    return true;
  });
  ipcMain.on("state:dirty", (_e, d) => { dirty = !!d; });
  ipcMain.on("app:close", () => { dirty = false; if (win && !win.isDestroyed()) win.close(); });
}

/* ---------- vault images (wpvault://vault/<path>) ---------- */
function imageProtocol() {
  protocol.handle("wpvault", (req) => {
    try {
      const u = new URL(req.url);
      const rel = decodeURIComponent(u.pathname.replace(/^\//, ""));
      const abs = inVault(rel);
      const type = abs && IMAGE_TYPES[path.extname(abs).toLowerCase()];
      if (!type) return new Response("Not found", { status: 404 });
      return new Response(fs.readFileSync(abs), { headers: { "content-type": type } });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

/* ---------- network block: only local schemes may load ---------- */
function lockDown() {
  const ses = session.defaultSession;
  const allowed = /^(file|devtools|wpvault|data|blob):/i;
  ses.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (d, cb) => {
    if (allowed.test(d.url)) return cb({});
    blocked.push(d.url);
    cb({ cancel: true });
  });
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
  app.on("web-contents-created", (_e, wc) => {
    wc.setWindowOpenHandler(() => ({ action: "deny" }));
    wc.on("will-navigate", (ev, url) => { if (!url.startsWith("file:")) ev.preventDefault(); });
    wc.on("will-attach-webview", (ev) => ev.preventDefault());
  });
}

/* ---------- menu ---------- */
function menu() {
  const send = (cmd) => () => win && win.webContents.send("menu", cmd);
  const tpl = [
    { label: "File", submenu: [
      { label: "Open vault…", accelerator: "CmdOrCtrl+O", click: () => chooseVault() },
      // The sample vault is a dev/testing aid: offered only under `npm run dev`.
      ...(PICK ? [{ label: "Open sample vault", click: () => win && win.webContents.send("menu", "sample") }] : []),
      { label: "New note", accelerator: "CmdOrCtrl+N", click: send("new") },
      { label: "Save", accelerator: "CmdOrCtrl+S", click: send("save") },
      { type: "separator" },
      { role: "quit" },
    ] },
    { label: "Edit", submenu: [
      { role: "undo" }, { role: "redo" }, { type: "separator" },
      { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" },
      { type: "separator" },
      { label: "Find in notes", accelerator: "CmdOrCtrl+F", click: send("search") },
    ] },
    { label: "View", submenu: [
      { label: "Edit / Preview", accelerator: "CmdOrCtrl+E", click: send("edit") },
      { label: "Note / Graph / Split", accelerator: "CmdOrCtrl+G", click: send("cycle") },
      { type: "separator" },
      { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" },
      { type: "separator" },
      { role: "toggleDevTools" },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

/* ---------- window ---------- */
function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 720, minHeight: 480,
    title: "Waypoint",
    icon: path.join(__dirname, "build", "icon.png"),
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#15181d" : "#f6f7f9",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      webSecurity: true, spellcheck: true,
    },
  });
  win.on("page-title-updated", (e) => e.preventDefault());
  if (vault) win.setTitle("Waypoint — " + path.basename(vault));
  // Unsaved typing: let the page save first; it then closes the window itself.
  win.on("close", (e) => {
    if (!dirty) return;
    e.preventDefault();
    win.webContents.send("menu", "close");
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  return win;
}

app.whenReady().then(() => {
  lockDown();
  imageProtocol();
  handlers();
  menu();
  const fromArgs = vaultFromArgs(process.argv);
  const saved = readConfig().vault;
  const start = fromArgs || (!PICK && isDir(saved) ? saved : null);
  if (start) { if (start !== SAMPLE) remember(start); setVault(start, path.resolve(start) !== SAMPLE); }
  createWindow();
  if (process.env.WAYPOINT_E2E) require("./e2e/driver")({ win, blocked, getVault: () => vault });
});

app.on("window-all-closed", () => {
  if (watcher) watcher.close();
  app.quit();
});
