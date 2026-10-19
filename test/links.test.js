"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../renderer/links.js");

test("parseLinks: alias, folder, heading, dedupe", () => {
  const t = "[[Note|alias]] [[folder/Other]] [[Note#Heading]] [[note]] [[Third#H|x]]";
  assert.deepEqual(L.parseLinks(t), ["Note", "folder/Other", "Third"]);
});

test("parseLinks: links inside inline code and fenced blocks are ignored", () => {
  const t = "Real [[A]]. Example `[[B]]`.\n\n```\n[[C]]\n```\n~~~\n[[D]]\n~~~\nAfter [[E]]";
  assert.deepEqual(L.parseLinks(t), ["A", "E"]);
});

test("parseLinks: image embeds are not note links", () => {
  assert.deepEqual(L.parseLinks("![[pic.png]] [[Real]]"), ["Real"]);
});

test("resolve: by file name, case-insensitive", () => {
  const ix = L.makeIndex(["Home.md", "Projects/Demo/Context.md"]);
  assert.equal(L.resolve("home", ix), "Home.md");
  assert.equal(L.resolve("CONTEXT", ix), "Projects/Demo/Context.md");
  assert.equal(L.resolve("Missing", ix), null);
});

test("resolve: folder-qualified path, and same name in two folders → first by path order", () => {
  const ix = L.makeIndex(["b/Context.md", "a/Context.md"]);
  assert.equal(L.resolve("Context", ix), "a/Context.md");
  assert.equal(L.resolve("b/Context", ix), "b/Context.md");
  assert.equal(L.resolve("zzz/Context", ix), "a/Context.md");
});

test("resolve: same name in two projects → the one in the linking note's project", () => {
  const ix = L.makeIndex([
    "Projects/Alpha/Alpha.md", "Projects/Alpha/sessions/S1 - Kickoff.md",
    "Projects/Beta/Beta.md", "Projects/Beta/sessions/S1 - Kickoff.md", "Projects/Beta/wiki/Notes.md",
  ]);
  assert.equal(L.resolve("S1 - Kickoff", ix, "Projects/Alpha/Alpha.md"), "Projects/Alpha/sessions/S1 - Kickoff.md");
  assert.equal(L.resolve("S1 - Kickoff", ix, "Projects/Beta/Beta.md"), "Projects/Beta/sessions/S1 - Kickoff.md");
  assert.equal(L.resolve("S1 - Kickoff", ix, "Projects/Beta/wiki/Notes.md"), "Projects/Beta/sessions/S1 - Kickoff.md");
  const g = L.graphData([
    { path: "Projects/Alpha/Alpha.md", links: ["S1 - Kickoff"] },
    { path: "Projects/Alpha/sessions/S1 - Kickoff.md", links: ["Alpha"] },
    { path: "Projects/Beta/Beta.md", links: ["S1 - Kickoff"] },
    { path: "Projects/Beta/sessions/S1 - Kickoff.md", links: ["Beta"] },
  ]);
  assert.equal(g.edges.length, 2); // each project note links its own S1, never across projects
});

test("graphData: edges, ghosts, no self-loops, undirected dedupe", () => {
  const notes = [
    { path: "A.md", links: ["B", "Ghost", "A"] },
    { path: "B.md", links: ["A"] },
    { path: "C.md", links: ["ghost"] },
  ];
  const g = L.graphData(notes);
  assert.equal(g.edges.length, 3); // A–B, A–ghost, C–ghost
  assert.equal(g.missing, 1);
  const ghost = g.nodes.find((n) => n.ghost);
  assert.equal(ghost.id, "ghost:ghost");
  assert.equal(ghost.deg, 2);
  assert.equal(g.nodes.find((n) => n.id === "A.md").deg, 2);
});

test("backlinks", () => {
  const notes = [{ path: "A.md", links: ["C"] }, { path: "B.md", links: ["c"] }, { path: "C.md", links: ["A"] }];
  const ix = L.makeIndex(notes.map((n) => n.path));
  assert.deepEqual(L.backlinks("C.md", notes, ix).map((n) => n.path), ["A.md", "B.md"]);
});
