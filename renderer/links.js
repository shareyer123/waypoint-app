"use strict";
// Wikilink parsing, link resolution and graph data. Pure functions: used by the app and by node:test.
(function (root) {
  const WIKI = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g;

  const norm = (p) => p.trim().replace(/\\/g, "/").replace(/^\.?\//, "");
  /** Note name from a path or link target: "folder/My Note.md" → "my note". */
  const keyOf = (t) => norm(t).split("/").pop().replace(/\.md$/i, "").toLowerCase();
  const nameOf = (p) => norm(p).split("/").pop().replace(/\.md$/i, "");
  const dirOf = (p) => { const n = norm(p); const i = n.lastIndexOf("/"); return i < 0 ? "" : n.slice(0, i + 1); };

  /** Remove code so example links inside `code` or fenced blocks are not counted. */
  function stripCode(text) {
    return text.replace(/\r\n?/g, "\n").replace(/^[ \t]*(```|~~~)[\s\S]*?^[ \t]*\1[^\n]*$/gm, "").replace(/`[^`\n]*`/g, "");
  }

  /** Raw link targets in a note, heading part removed, in order, unique (case-insensitive). */
  function parseLinks(text) {
    const out = [], seen = new Set();
    const s = stripCode(text);
    let m; WIKI.lastIndex = 0;
    while ((m = WIKI.exec(s))) {
      const t = norm(m[1]);
      if (!t || /^!/.test(t)) continue;
      const k = t.toLowerCase();
      if (!seen.has(k)) { seen.add(k); out.push(t); }
    }
    // Image embeds ![[x.png]] are not note links.
    return out.filter((t) => !/\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(t));
  }

  /**
   * Index of notes for resolution. `paths` = vault-relative paths.
   * Same name in two folders: resolve() picks the one nearest the linking note.
   */
  function makeIndex(paths) {
    const sorted = [...paths].sort((a, b) => a.localeCompare(b));
    const byName = new Map(), byPath = new Map();
    for (const p of sorted) {
      const k = keyOf(p);
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k).push(p);              // every note with this name, in path order
      byPath.set(norm(p).replace(/\.md$/i, "").toLowerCase(), p);
    }
    return { byName, byPath };
  }

  /** Number of leading folders two paths share. */
  function sharedDepth(a, b) {
    const x = dirOf(a).split("/").filter(Boolean), y = dirOf(b).split("/").filter(Boolean);
    let i = 0; while (i < x.length && i < y.length && x[i].toLowerCase() === y[i].toLowerCase()) i++;
    return i;
  }

  /**
   * Resolve a link target to a note path, or null when the note does not exist.
   * Same name in several folders: the one nearest the linking note (`from`) wins —
   * most shared folders, then the shortest path, then path order. So "S1 - Kickoff"
   * links stay inside their own project.
   */
  function resolve(target, index, from) {
    const t = norm(target).replace(/\.md$/i, "").toLowerCase();
    if (t.includes("/") && index.byPath.has(t)) return index.byPath.get(t);
    const all = index.byName.get(keyOf(t));
    if (!all || !all.length) return null;
    if (all.length === 1 || !from) return all[0];
    let best = all[0], bestScore = -Infinity;
    for (const p of all) {
      const score = sharedDepth(p, from) * 1000 - p.split("/").length;
      if (score > bestScore) { best = p; bestScore = score; }
    }
    return best;
  }

  /**
   * Graph data. notes = [{ path, links: [raw targets] }].
   * Nodes are notes (id = path) plus ghost nodes for missing targets (id = "ghost:" + name).
   * Edges are undirected and unique.
   */
  function graphData(notes, index) {
    index = index || makeIndex(notes.map((n) => n.path));
    const nodes = new Map(), edges = [], seen = new Set();
    for (const n of notes) nodes.set(n.path, { id: n.path, label: nameOf(n.path), ghost: false, deg: 0 });
    let missing = 0;
    for (const n of notes) {
      for (const t of n.links) {
        let to = resolve(t, index, n.path);
        if (!to) {
          to = "ghost:" + keyOf(t);
          if (!nodes.has(to)) { nodes.set(to, { id: to, label: nameOf(t), ghost: true, deg: 0 }); missing++; }
        }
        if (to === n.path) continue;
        const id = n.path < to ? n.path + "\u0001" + to : to + "\u0001" + n.path;
        if (seen.has(id)) continue;
        seen.add(id);
        edges.push([n.path, to]);
        nodes.get(n.path).deg++; nodes.get(to).deg++;
      }
    }
    return { nodes: [...nodes.values()], edges, missing };
  }

  /** Notes that link to `path`. */
  function backlinks(path, notes, index) {
    return notes.filter((n) => n.path !== path && n.links.some((t) => resolve(t, index, n.path) === path));
  }

  const api = { WIKI, norm, keyOf, nameOf, dirOf, stripCode, parseLinks, makeIndex, resolve, graphData, backlinks };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WPLinks = api;
})(typeof self !== "undefined" ? self : globalThis);
