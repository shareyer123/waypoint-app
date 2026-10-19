"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { md } = require("../renderer/markdown.js");

test("escapes raw HTML in text", () => {
  const h = md("Hello <script>alert(1)</script> & <b>bold</b>");
  assert.ok(!h.includes("<script>"));
  assert.ok(h.includes("&lt;script&gt;"));
  assert.ok(h.includes("&amp;"));
  assert.ok(!h.includes("<b>"));
});

test("escapes wikilink targets and link URLs used in attributes", () => {
  const h = md('[[a" onmouseover="x]] and [t](https://e.com/"onclick="x)');
  assert.ok(!/onmouseover="x"/.test(h));
  assert.ok(!/ onclick=/.test(h));
});

test("headings, bold, italic, strike, highlight", () => {
  const h = md("# Title\n\n**b** *i* ~~s~~ ==m==");
  assert.ok(h.includes("<h1>Title</h1>"));
  for (const t of ["<strong>b</strong>", "<em>i</em>", "<del>s</del>", "<mark>m</mark>"]) assert.ok(h.includes(t), t);
});

test("tables", () => {
  const h = md("| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |");
  assert.ok(h.includes("<table>"));
  assert.equal((h.match(/<th>/g) || []).length, 2);
  assert.equal((h.match(/<td>/g) || []).length, 4);
});

test("nested lists", () => {
  const h = md("- one\n  - one.a\n  - one.b\n- two");
  assert.match(h, /<ul><li>one<ul><li>one\.a<\/li><li>one\.b<\/li><\/ul><\/li><li>two<\/li><\/ul>/);
  assert.ok(md("1. a\n2. b").startsWith("<ol>"));
});

test("task boxes", () => {
  const h = md("- [x] done\n- [ ] open");
  assert.ok(h.includes('<input type="checkbox" disabled checked> done'));
  assert.ok(h.includes('<input type="checkbox" disabled> open'));
});

test("inline and fenced code are escaped and not linked", () => {
  const h = md("Use `[[Not a link]]` here.\n\n```\n<div>[[Also not]]</div>\n```");
  assert.ok(!h.includes('class="wl"'));
  assert.ok(h.includes("<code>[[Not a link]]</code>"));
  assert.ok(h.includes("&lt;div&gt;[[Also not]]&lt;/div&gt;"));
});

test("wikilinks: alias, existing vs missing", () => {
  const h = md("[[Home|start]] and [[Nope]]", { exists: (t) => t === "Home" });
  assert.ok(h.includes('<a href="#" class="wl" data-target="Home">start</a>'));
  assert.ok(h.includes('class="wl missing" data-target="Nope"'));
});

test("front matter shows as a muted block", () => {
  const h = md("---\ntype: note\n---\n# T");
  assert.ok(h.startsWith('<div class="fm">type: note</div>'));
});

test("external links are marked for the confirm-then-open flow", () => {
  const h = md("[site](https://example.com)");
  assert.ok(h.includes('class="ext" data-href="https://example.com"'));
  assert.ok(!/\shref="https/.test(h));
});

test("images: vault images via the image hook, outside images as placeholder", () => {
  const o = { image: (src) => "wpvault://vault/" + src };
  assert.ok(md("![pic](img/a.png)", o).includes('<img src="wpvault://vault/img/a.png" alt="pic"'));
  const out = md("![remote](https://e.com/a.png)", o);
  assert.ok(!out.includes("<img"));
  assert.ok(out.includes("[image: remote — outside the vault, not loaded]"));
});
