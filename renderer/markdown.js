"use strict";
// Markdown → HTML. Ported from v0.1. Everything from the note is HTML-escaped; only our own tags are emitted.
// opts.exists(target) → does a wikilink target exist; opts.image(src) → safe URL for a vault image, or null.
(function (root) {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const IMG = /\.(png|jpe?g|gif|webp|svg|bmp)$/i;

  function inline(raw, o) {
    const tok = []; const put = (h) => "\u0000" + (tok.push(h) - 1) + "\u0000";
    let s = raw.replace(/`([^`]+)`/g, (_, c) => put("<code>" + esc(c) + "</code>"));
    // Image embeds: ![[pic.png]] and ![alt](path)
    s = s.replace(/!\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_, t, a) => put(image(t.trim(), a || t.trim(), o)));
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_, a, u) => put(image(u, a, o)));
    s = s.replace(/\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_, t, h, a) => {
      const ok = o.exists(t.trim());
      return put('<a href="#" class="wl' + (ok ? "" : " missing") + '" data-target="' + esc(t.trim()) + '"' +
        (ok ? "" : ' title="No note yet — click to create it"') + ">" + esc(a || t.trim()) + "</a>");
    });
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_, t, u) => {
      if (/^(https?:|mailto:)/i.test(u)) return put('<a href="#" class="ext" data-href="' + esc(u) + '" title="' + esc(u) + '">' + esc(t) + "</a>");
      if (/\.md(#.*)?$/i.test(u)) {
        let target = u.replace(/#.*$/, "");
        try { target = decodeURIComponent(target); } catch { /* keep raw */ }
        const ok = o.exists(target);
        return put('<a href="#" class="wl' + (ok ? "" : " missing") + '" data-target="' + esc(target) + '">' + esc(t) + "</a>");
      }
      return put(esc(t));
    });
    s = esc(s);
    s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/__(.+?)__/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, "$1<em>$2</em>").replace(/(^|\W)_(?!\s)(.+?)_(?=\W|$)/g, "$1<em>$2</em>")
      .replace(/~~(.+?)~~/g, "<del>$1</del>").replace(/==(.+?)==/g, "<mark>$1</mark>");
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => tok[+i]);
  }

  function image(src, alt, o) {
    const url = !/^[a-z][a-z0-9+.-]*:/i.test(src) && IMG.test(src.split(/[?#]/)[0]) ? o.image(src) : null;
    if (url) return '<img src="' + esc(url) + '" alt="' + esc(alt || "") + '" loading="lazy">';
    return '<span class="img">[image: ' + esc(alt || "untitled") + (/^https?:/i.test(src) ? " — outside the vault, not loaded" : "") + "]</span>";
  }

  const indentOf = (l) => { let n = 0; for (const c of l) { if (c === " ") n++; else if (c === "\t") n += 4; else break; } return n; };
  const ITEM = /^\s*([-*+]|\d+[.)])\s+/;

  function parseList(lines, i, o) {
    const base = indentOf(lines[i]); const tag = /^\s*\d/.test(lines[i]) ? "ol" : "ul"; const items = [];
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) { if (i + 1 < lines.length && ITEM.test(lines[i + 1]) && indentOf(lines[i + 1]) >= base) { i++; continue; } break; }
      const ind = indentOf(l);
      if (ITEM.test(l) && ind === base) { items.push({ text: l.replace(ITEM, ""), sub: "" }); i++; continue; }
      if (ITEM.test(l) && ind > base && items.length) { const r = parseList(lines, i, o); items[items.length - 1].sub += r[0]; i = r[1]; continue; }
      if (!ITEM.test(l) && ind > base && items.length) { items[items.length - 1].text += " " + l.trim(); i++; continue; }
      break;
    }
    const html = items.map((it) => {
      const m = it.text.match(/^\[([ xX])\]\s+/);
      const box = m ? '<input type="checkbox" disabled' + (m[1] !== " " ? " checked" : "") + "> " : "";
      return "<li" + (m ? ' class="task"' : "") + ">" + box + inline(m ? it.text.slice(m[0].length) : it.text, o) + it.sub + "</li>";
    }).join("");
    return ["<" + tag + ">" + html + "</" + tag + ">", i];
  }

  const TSEP = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
  const trow = (s) => s.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

  function md(src, opts) {
    const o = { exists: () => true, image: () => null, ...(opts || {}) };
    const lines = String(src).replace(/\r\n?/g, "\n").split("\n"); const out = []; let i = 0, m;
    if (lines[0] === "---") {
      const end = lines.indexOf("---", 1);
      if (end > 0) { out.push('<div class="fm">' + esc(lines.slice(1, end).join("\n")) + "</div>"); i = end + 1; }
    }
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) { i++; continue; }
      if ((m = l.match(/^\s*(```|~~~)/))) {
        const fence = m[1]; const buf = []; i++;
        while (i < lines.length && !lines[i].trim().startsWith(fence)) buf.push(lines[i++]);
        i++; out.push("<pre><code>" + esc(buf.join("\n")) + "</code></pre>"); continue;
      }
      if ((m = l.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/))) { const n = m[1].length; out.push("<h" + n + ">" + inline(m[2], o) + "</h" + n + ">"); i++; continue; }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { out.push("<hr>"); i++; continue; }
      if (/^\s*>/.test(l)) {
        const buf = []; while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ""));
        out.push("<blockquote>" + md(buf.join("\n"), o) + "</blockquote>"); continue;
      }
      if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && TSEP.test(lines[i + 1])) {
        const head = trow(l); const body = []; i += 2;
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) body.push(trow(lines[i++]));
        out.push('<div class="tw"><table><thead><tr>' + head.map((c) => "<th>" + inline(c, o) + "</th>").join("") + "</tr></thead><tbody>" +
          body.map((r) => "<tr>" + r.map((c) => "<td>" + inline(c, o) + "</td>").join("") + "</tr>").join("") + "</tbody></table></div>");
        continue;
      }
      if (ITEM.test(l)) { const r = parseList(lines, i, o); out.push(r[0]); i = r[1]; continue; }
      const buf = [l.trim()]; i++;
      while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|\s*```|\s*~~~|\s*>)/.test(lines[i]) && !ITEM.test(lines[i])) buf.push(lines[i++].trim());
      out.push("<p>" + inline(buf.join(" "), o) + "</p>");
    }
    return out.join("\n");
  }

  const api = { md, esc };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WPMarkdown = api;
})(typeof self !== "undefined" ? self : globalThis);
