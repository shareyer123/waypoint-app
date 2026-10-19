"use strict";
// Waypoint UI. File access goes through window.waypoint (preload.js); nothing here touches the network.
const { md, esc } = window.WPMarkdown;
const L = window.WPLinks;
const api = window.waypoint;
const $ = (id) => document.getElementById(id);

const S = {
  vault: null,             // { path, name }
  notes: new Map(),        // path → { path, text, links }
  index: L.makeIndex([]),
  data: { nodes: [], edges: [], missing: 0 },
  current: null,           // path of the open note
  editing: false,
  dirty: false,
  view: "note",            // note | graph | split
  fresh: new Set(),        // paths added by another program, not opened yet
  disk: null,              // { kind: "changed"|"deleted", text } when the open note changed on disk under unsaved edits
  fitted: false,
};
const SPLIT_MIN = 900;      // Split (note + graph) is the default view at this width and wider

const graph = window.WPGraph.createGraph($("graph"), {
  current: () => S.current,
  onOpen: (id, node) => (node.ghost ? followLink(node.label) : openNote(id)),
});

/* ---------- helpers ---------- */
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 1800);
}
function live(msg) { $("liveText").textContent = msg; }
const nameOf = L.nameOf;
// List order: notes in the vault root first, then folder by folder.
const byFolder = (a, b) => {
  const da = L.dirOf(a.path), db = L.dirOf(b.path);
  if (da !== db) return !da ? -1 : !db ? 1 : da.localeCompare(db);
  return a.path.localeCompare(b.path);
};
const sorted = () => [...S.notes.values()].sort(byFolder);
const resolve = (t) => L.resolve(t, S.index, S.current);   // repeated names resolve inside the open note's project

/** Vault-relative image path → wpvault URL; only paths that stay inside the vault. */
function imageUrl(src, notePath) {
  let p = src.split(/[?#]/)[0];
  try { p = decodeURIComponent(p); } catch { /* keep raw */ }
  const parts = (p.startsWith("/") ? "" : L.dirOf(notePath)) + p.replace(/^\/+/, "");
  const out = [];
  for (const seg of parts.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") { if (!out.length) return null; out.pop(); } else out.push(seg);
  }
  return out.length ? "wpvault://vault/" + out.map(encodeURIComponent).join("/") : null;
}

function setDirty(d) {
  S.dirty = d; api.setDirty(d);
  $("btnSave").disabled = !d;
  const a = document.querySelector('#list a.cur span'); if (a) a.textContent = nameOf(S.current) + (d ? " ●" : "");
}

/* ---------- loading ---------- */
function putNote(path, text) { S.notes.set(path, { path, text, links: L.parseLinks(text) }); }

function rebuild() {
  S.index = L.makeIndex([...S.notes.keys()]);
  const notes = [...S.notes.values()];
  S.data = L.graphData(notes, S.index);
  graph.setData(S.data);
  renderList(); renderCounts();
}

function loadVault(info) {
  S.vault = { path: info.path, name: info.name };
  S.notes.clear(); S.fresh.clear(); S.disk = null; S.fitted = false;
  for (const n of info.notes) putNote(n.path, n.text);
  rebuild();
  $("firstRun").hidden = true;
  const first = ["home.md", "index.md", "readme.md"].map((k) => sorted().find((n) => n.path.toLowerCase() === k)).find(Boolean) || sorted()[0];
  S.current = null; S.editing = false; setDirty(false);
  openNote(first ? first.path : null, true);
  setView(window.innerWidth >= SPLIT_MIN ? "split" : "note");
  live("Live — watching vault");
}

function showFirstRun(recent, sample) {
  $("firstRun").hidden = false;
  $("btnSample").hidden = !sample;
  const box = $("recentBox"), list = $("recentList");
  box.hidden = !recent || !recent.length;
  list.innerHTML = (recent || []).map((p, i) => '<button type="button" data-i="' + i + '"><b>' + esc(p.split(/[\\/]/).pop()) + "</b><span>" + esc(p) + "</span></button>").join("");
  list.onclick = async (e) => {
    const b = e.target.closest("button[data-i]"); if (!b) return;
    const info = await api.openRecent(recent[+b.dataset.i]); if (info) loadVault(info);
  };
}

/* ---------- list: folder tree ---------- */
// Collapsed folders are remembered per computer; the tree opens fully expanded the first time.
const collapsed = new Set((() => { try { return JSON.parse(localStorage.getItem("wp.collapsed") || "[]"); } catch { return []; } })());
function saveCollapsed() { try { localStorage.setItem("wp.collapsed", JSON.stringify([...collapsed])); } catch { /* storage off: session only */ } }

function buildTree(notes) {
  const root = { dirs: new Map(), notes: [] };
  for (const n of notes) {
    let node = root, acc = "";
    for (const part of L.dirOf(n.path).split("/").filter(Boolean)) {
      acc += part + "/";
      if (!node.dirs.has(part)) node.dirs.set(part, { path: acc, dirs: new Map(), notes: [] });
      node = node.dirs.get(part);
    }
    node.notes.push(n);
  }
  return root;
}

function renderList() {
  const q = $("search").value.trim().toLowerCase();
  const notes = sorted().filter((n) => !q || n.path.toLowerCase().includes(q) || n.text.toLowerCase().includes(q));
  const curDir = S.current ? L.dirOf(S.current) : "";
  const row = (n, depth) => {
    const cur = n.path === S.current, session = /\/sessions\//i.test("/" + n.path);
    return '<a href="#" data-path="' + esc(n.path) + '" class="note' + (cur ? " cur" : "") + (session ? " session" : "") + '"' + (cur ? ' aria-current="page"' : "") +
      ' style="padding-left:' + (12 + depth * 16) + 'px"><span>' + esc(nameOf(n.path)) + (cur && S.dirty ? " ●" : "") + "</span>" +
      (S.fresh.has(n.path) ? '<b class="new">NEW</b>' : "") + "</a>";
  };
  const walk = (node, depth) => {
    // Notes first, then subfolders: the project note sits above its wiki and sessions folders.
    let html = node.notes.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true })).map((n) => row(n, depth)).join("");
    for (const [name, d] of [...node.dirs.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))) {
      // Searching, or holding the open note, forces a folder open.
      const open = q || !collapsed.has(d.path) || curDir.startsWith(d.path);
      html += '<button type="button" class="fold" data-dir="' + esc(d.path) + '" aria-expanded="' + !!open + '" style="padding-left:' + (6 + depth * 16) + 'px">' +
        '<svg class="chev" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M4 2.5 8 6l-4 3.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>' +
        "<span>" + esc(name) + "</span></button>";
      if (open) html += walk(d, depth + 1);
    }
    return html;
  };
  $("list").innerHTML = notes.length ? walk(buildTree(notes), 0)
    : '<div class="none">' + (S.notes.size ? "No notes match." : "No notes yet. Click + New note.") + "</div>";
}

function renderCounts() {
  const m = S.data.missing;
  $("counts").textContent = S.notes.size + " notes · " + S.data.edges.length + " links · " + m + " missing";
}

/* ---------- note ---------- */
function renderNote(cursor) {
  const v = $("noteView"); const n = S.notes.get(S.current);
  v.classList.toggle("editing", !!(n && S.editing));
  // No Edit button: click into the note to edit. "Done" shows only while editing (Ctrl+E also toggles).
  $("btnEdit").hidden = !(n && S.editing);
  $("btnEdit").textContent = S.editing ? "Done" : "Edit";
  $("btnSave").hidden = true;          // autosave; Ctrl+S still saves at once
  if (!n) {
    v.innerHTML = '<div class="page empty"><h2>No note open</h2><p>Pick a note on the left, or click <b>+ New note</b>. ' +
      "Link notes with <code>[[Note name]]</code>; the graph shows how they connect.</p></div>";
    return;
  }
  const crumb = '<div class="crumb">' + esc(n.path.split("/").join(" / ")) + (S.editing ? " — editing" : "") + "</div>";
  if (S.editing) {
    v.innerHTML = '<div class="page"><div class="editwrap">' +
      '<label for="editor">' + esc(n.path.split("/").join(" / ")) + " — editing, saves automatically</label>" +
      '<textarea id="editor" spellcheck="true"></textarea>' +
      '<div class="keys">Saves as you type · Esc to finish · Ctrl+S save now · Ctrl+G Graph</div></div></div>';
    const ta = $("editor");
    ta.value = S.editBuffer != null ? S.editBuffer : n.text;
    ta.addEventListener("input", () => { S.editBuffer = ta.value; if (!S.dirty) setDirty(true); scheduleSave(); });
    ta.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); finishEdit(); } });
    ta.focus();
    if (cursor != null) { const p = Math.min(cursor, ta.value.length); ta.setSelectionRange(p, p); }
    return;
  }
  const bl = L.backlinks(n.path, [...S.notes.values()], S.index).sort((a, b) => a.path.localeCompare(b.path));
  v.innerHTML = '<div class="page">' + crumb +
    '<article class="md">' + md(n.text, { exists: (t) => !!resolve(t), image: (src) => imageUrl(src, n.path) }) + "</article>" +
    '<div class="back"><div class="cap">Linked from (' + bl.length + ")</div>" +
    '<div class="pills">' + (bl.map((b) => '<a href="#" data-path="' + esc(b.path) + '">' + esc(nameOf(b.path)) + "</a>").join("") ||
      '<span class="none">No notes link here yet.</span>') + "</div></div></div>";
}

function openNote(path, force) {
  if (!force && path === S.current && !S.editing) { setView(S.view === "graph" ? "note" : S.view); return; }
  if (S.dirty && S.editing && !S.disk) save(true);       // leaving a note saves it
  else if (!force && S.dirty && !confirm("This note changed on disk while you were editing. Leave without keeping your text?")) return;
  clearTimeout(saveTimer);
  S.current = path; S.editing = false; S.editBuffer = null; S.disk = null; setDirty(false);
  if (path) S.fresh.delete(path);
  hideBanner();
  if (S.view === "graph") setView("note");
  renderList(); renderNote(); graph.draw();
  $("noteView").scrollTop = 0;
}

/* Editing: click into a note to type; it saves itself shortly after you stop. */
let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  if (!S.disk) saveTimer = setTimeout(() => save(true), 800);   // paused while a disk conflict is open
}

function startEdit(cursor) {
  if (!S.notes.get(S.current) || S.editing) return;
  S.editing = true; S.editBuffer = null;
  if (S.view === "graph") setView("note");
  renderNote(cursor);
}

async function finishEdit() {
  if (!S.editing) return;
  if (S.disk && !confirm("This note changed on disk while you were editing. Leave without keeping your text?")) return;
  if (S.dirty && !S.disk) await save(true);
  clearTimeout(saveTimer);
  S.editing = false; S.editBuffer = null; S.disk = null; setDirty(false); hideBanner();
  renderNote();
}

function toggleEdit() { if (S.editing) finishEdit(); else startEdit(); }

/** Where to put the cursor: find the clicked block's text in the note's source. */
function cursorFor(el, x, y) {
  const n = S.notes.get(S.current); if (!n) return null;
  // 1. Find where the clicked block starts in the source.
  const block = el.closest("li, p, h1, h2, h3, h4, h5, h6, td, th, blockquote, pre, .fm");
  const t = block ? block.textContent.trim() : "";
  let start = -1, fallback = null;
  for (const len of [40, 20, 10]) {
    const snip = t.slice(0, len); if (snip.length < 4) break;
    const i = n.text.indexOf(snip); if (i >= 0) { start = i; fallback = i + snip.length; break; }
  }
  // 2. Find the clicked spot: the text just before the caret, searched from the block's start.
  const r = document.caretRangeFromPoint ? document.caretRangeFromPoint(x, y) : null;
  if (r && r.startContainer.nodeType === 3) {
    const before = r.startContainer.textContent.slice(0, r.startOffset);
    for (const len of [16, 8, 4]) {
      const ctx = before.slice(-len); if (ctx.length < Math.min(len, before.length) || !ctx) break;
      const i = n.text.indexOf(ctx, Math.max(0, start)); if (i >= 0) return i + ctx.length;
    }
  }
  return fallback;
}

async function save(quiet) {
  clearTimeout(saveTimer);
  const n = S.notes.get(S.current), ta = $("editor");
  if (!n || !S.editing || !ta) return false;
  if (S.disk && quiet) return false;                 // never autosave over another program's change
  const path = n.path, text = ta.value;
  try { await api.writeNote(path, text); }
  catch (e) { toast("Could not save: " + e.message); return false; }
  putNote(path, text);
  if (S.current === path && S.editing) {
    // Typing may have continued while the file was written: only clear "unsaved" if nothing changed.
    const now = $("editor") ? $("editor").value : text;
    S.editBuffer = now; S.disk = null; hideBanner();
    if (now === text) setDirty(false); else scheduleSave();
  }
  rebuild();
  live("Saved " + nameOf(path));
  if (!quiet) toast("Saved");
  return true;
}

/* ---------- links + new notes ---------- */
async function followLink(target) {
  const p = resolve(target);
  if (p) return openNote(p);
  if (!confirm('No note named "' + target + '" yet. Create it?')) return;
  const rel = target.includes("/") ? target.replace(/\.md$/i, "") + ".md" : L.dirOf(S.current || "") + target.trim() + ".md";
  await createNote(rel);
}

function cleanName(s) { return String(s || "").replace(/\.md$/i, "").replace(/[\\:*?"<>|]/g, "").replace(/^\/+|\/+$/g, "").trim(); }

async function createNote(rel) {
  rel = rel.split("/").map(cleanName).filter(Boolean).join("/");
  if (!rel) return;
  if (!/\.md$/i.test(rel)) rel += ".md";
  const existing = resolve(rel.replace(/\.md$/i, ""));
  if (existing && existing.toLowerCase() === rel.toLowerCase()) return openNote(existing);
  if (S.dirty && S.editing && !S.disk) await save(true);
  else if (S.dirty && !confirm("This note changed on disk while you were editing. Leave without keeping your text?")) return;
  const text = "# " + nameOf(rel) + "\n\n";
  try { rel = await api.createNote(rel, text); }
  catch (e) { toast(e.message); return; }
  putNote(rel, text); rebuild();
  S.dirty = false;
  openNote(rel, true);
  S.editing = true; renderNote();
  live("Created " + nameOf(rel));
}

function newNoteDialog() {
  if (!S.vault) return;
  const dlg = $("newDlg"), where = $("newWhere"), dir = L.dirOf(S.current || "");
  where.innerHTML = (dir ? '<option value="' + esc(dir) + '">This folder (' + esc(dir.replace(/\/$/, "")) + ")</option>" : "") +
    '<option value="">Vault root</option>';
  $("newName").value = "";
  dlg.showModal();
  $("newName").focus();
}
$("newForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = cleanName($("newName").value); if (!name) return;
  $("newDlg").close();
  createNote($("newWhere").value + name + ".md");
});
$("newCancel").addEventListener("click", () => $("newDlg").close());

/* ---------- live sync ---------- */
function showBanner(text) { $("bannerText").innerHTML = text; $("banner").hidden = false; }
function hideBanner() { $("banner").hidden = true; }

function applyChanges(changes) {
  let structural = false, rerender = false;
  for (const c of changes) {
    const old = S.notes.get(c.path);
    if (c.type === "upsert") {
      if (old && old.text === c.text) continue;           // our own save echoing back
      if (!old) { S.fresh.add(c.path); live(nameOf(c.path) + ".md added by another program"); }
      else live(nameOf(c.path) + ".md changed on disk");
      if (c.path === S.current && S.editing && S.dirty) {
        S.disk = { kind: "changed", text: c.text };
        showBanner("<b>Changed on disk.</b> Another program saved " + esc(nameOf(c.path)) + ".md while you were editing.");
        putNote(c.path, c.text); structural = true; continue;
      }
      putNote(c.path, c.text); structural = true;
      if (c.path === S.current) rerender = true;
    } else if (c.type === "delete" && old) {
      S.notes.delete(c.path); S.fresh.delete(c.path); structural = true;
      live(nameOf(c.path) + ".md deleted on disk");
      if (c.path === S.current) {
        if (S.editing && S.dirty) {
          S.disk = { kind: "deleted" };
          showBanner("<b>Deleted on disk.</b> Another program removed " + esc(nameOf(c.path)) + ".md. Keep mine and save to recreate it.");
        } else { S.current = null; S.editing = false; rerender = true; }
      }
    }
  }
  if (structural) rebuild();
  if (rerender) {
    const ta = $("editor"), pos = ta ? ta.selectionStart : null;
    if (S.editing && !S.dirty) S.editBuffer = null;
    renderNote(pos);
  }
}

function resetNotes(list) {
  const before = new Set(S.notes.keys());
  const changes = list.map((n) => ({ type: "upsert", path: n.path, text: n.text }));
  const now = new Set(list.map((n) => n.path));
  for (const p of before) if (!now.has(p)) changes.push({ type: "delete", path: p });
  applyChanges(changes);
}

$("btnReload").addEventListener("click", () => {
  if (S.disk && S.disk.kind === "deleted") { S.dirty = false; api.setDirty(false); S.current = null; S.editing = false; S.disk = null; hideBanner(); renderList(); renderNote(); return; }
  clearTimeout(saveTimer);
  S.editBuffer = null; S.disk = null; setDirty(false); hideBanner(); renderNote();
});
$("btnKeep").addEventListener("click", () => { hideBanner(); S.disk = null; if (S.dirty) scheduleSave(); });

/* ---------- views ---------- */
function setView(v) {
  if (v === "split" && window.innerWidth < SPLIT_MIN) v = "note";
  S.view = v;
  $("noteView").hidden = v === "graph";
  $("graphView").hidden = v === "note";
  $("main").classList.toggle("split", v === "split");
  for (const [id, name] of [["tabNote", "note"], ["tabGraph", "graph"], ["tabSplit", "split"]]) {
    $(id).classList.toggle("on", v === name); $(id).setAttribute("aria-pressed", String(v === name));
  }
  graph.state.visible = v !== "note";
  if (v !== "note") {
    graph.resize();
    if (!S.fitted) { graph.settle(); S.fitted = true; }
    graph.fit();
  }
}
function cycleView() {
  const order = window.innerWidth >= SPLIT_MIN ? ["note", "graph", "split"] : ["note", "graph"];
  setView(order[(order.indexOf(S.view) + 1) % order.length]);
}
function splitAvailability() {
  const wide = window.innerWidth >= SPLIT_MIN;
  $("tabSplit").disabled = !wide;
  $("tabSplit").title = wide ? "Note and graph side by side" : "Needs a wider window (900 px or more)";
  if (!wide && S.view === "split") setView("note");
}
window.addEventListener("resize", () => { splitAvailability(); if (S.view !== "note") graph.resize(); });

/* ---------- wiring ---------- */
$("tabNote").addEventListener("click", () => setView("note"));
$("tabGraph").addEventListener("click", () => setView("graph"));
$("tabSplit").addEventListener("click", () => setView("split"));
$("zoomIn").addEventListener("click", () => graph.zoom(1.25));
$("zoomOut").addEventListener("click", () => graph.zoom(0.8));
$("zoomFit").addEventListener("click", () => graph.fit());
$("btnEdit").addEventListener("click", toggleEdit);
$("btnSave").addEventListener("click", () => save(false));
$("btnNew").addEventListener("click", newNoteDialog);
$("btnOpen").addEventListener("click", () => api.openVault());
$("btnChoose").addEventListener("click", () => api.openVault());
async function openSample() { const info = await api.openSample(); if (info) loadVault(info); }
$("btnSample").addEventListener("click", openSample);
$("search").addEventListener("input", renderList);
$("list").addEventListener("click", (e) => {
  const f = e.target.closest("button.fold");
  if (f) { const d = f.dataset.dir; if (collapsed.has(d)) collapsed.delete(d); else collapsed.add(d); saveCollapsed(); renderList(); return; }
  const a = e.target.closest("a[data-path]"); if (a) { e.preventDefault(); openNote(a.dataset.path); }
});
$("noteView").addEventListener("click", (e) => {
  const wl = e.target.closest("a.wl"); if (wl) { e.preventDefault(); followLink(wl.dataset.target); return; }
  const ext = e.target.closest("a.ext"); if (ext) { e.preventDefault(); api.openExternal(ext.dataset.href); return; }
  const pill = e.target.closest(".pills a[data-path]"); if (pill) { e.preventDefault(); openNote(pill.dataset.path); return; }
  if (S.editing) { if (!e.target.closest(".editwrap")) finishEdit(); return; }
  if (String(window.getSelection() || "")) return;    // selecting text to copy is not editing
  if (e.target.closest("a, button, input, .back")) return;
  startEdit(cursorFor(e.target, e.clientX, e.clientY));
});
api.onMenu((cmd) => {
  if (cmd === "new") newNoteDialog();
  else if (cmd === "save") save(false);
  else if (cmd === "close") closeWindow();
  else if (cmd === "edit") toggleEdit();
  else if (cmd === "cycle") cycleView();
  else if (cmd === "search") { $("search").focus(); $("search").select(); }
  else if (cmd === "sample") openSample();
});
api.onOpened((info) => loadVault(info));
// Closing the window saves first (asks only if a disk conflict is still open).
async function closeWindow() {
  if (S.disk && !confirm("This note changed on disk while you were editing. Quit without keeping your text?")) return;
  if (S.dirty && !S.disk) await save(true);
  api.closeWindow();
}
api.onChanges(applyChanges);
api.onReset(resetNotes);

(async () => {
  splitAvailability();
  const info = await api.getVault();
  if (info && info.path) loadVault(info); else showFirstRun(info ? info.recent : [], info && info.sample);
  window.__waypointReady = true;
})();
