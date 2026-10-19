"use strict";
// Force-directed graph on a canvas. Ported from v0.1.
// createGraph(canvas, { onOpen(id, node), current() }) → { setData(data), resize(), fit(), zoom(f), settle(), state }
(function (root) {
  function createGraph(canvas, hooks) {
    const G = { nodes: [], edges: [], by: new Map(), scale: 1, ox: 0, oy: 0, alpha: 0, running: false, hover: null, drag: null, w: 0, h: 0, visible: false };
    const cur = () => (hooks.current ? hooks.current() : null);

    function setData(data) {
      const old = G.by; G.nodes = []; G.edges = []; G.by = new Map();
      for (const d of data.nodes) {
        const p = old.get(d.id); const a = Math.random() * 6.283, r = 40 + Math.random() * 160;
        const n = { ...d, session: !d.ghost && /\/sessions\//i.test("/" + d.id), x: p ? p.x : Math.cos(a) * r, y: p ? p.y : Math.sin(a) * r, vx: 0, vy: 0, fixed: false };
        G.nodes.push(n); G.by.set(n.id, n);
      }
      for (const [a, b] of data.edges) if (G.by.has(a) && G.by.has(b)) G.edges.push([G.by.get(a), G.by.get(b)]);
      G.alpha = Math.max(G.alpha, old.size ? 0.4 : 1); kick();
    }

    function tick() {
      const N = G.nodes, k = G.alpha;
      for (let i = 0; i < N.length; i++) for (let j = i + 1; j < N.length; j++) {
        const a = N[i], b = N[j]; let dx = a.x - b.x, dy = a.y - b.y; let d2 = dx * dx + dy * dy;
        if (d2 > 250000) continue; if (d2 < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 0.25; }
        const f = 1400 / d2; a.vx += dx * f * k; a.vy += dy * f * k; b.vx -= dx * f * k; b.vy -= dy * f * k;
      }
      for (const [a, b] of G.edges) {
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1, f = (d - 80) * 0.04 * k;
        a.vx += dx / d * f; a.vy += dy / d * f; b.vx -= dx / d * f; b.vy -= dy / d * f;
      }
      for (const n of N) {
        if (n.fixed) { n.vx = n.vy = 0; continue; }
        n.vx -= n.x * 0.004 * k; n.vy -= n.y * 0.004 * k; n.vx *= 0.6; n.vy *= 0.6; n.x += n.vx; n.y += n.vy;
      }
      G.alpha *= 0.985;
    }
    function kick() { if (G.running) return; G.running = true; requestAnimationFrame(loop); }
    function loop() {
      if (G.alpha > 0.01) tick();
      if (G.visible) draw();
      if (G.alpha > 0.01 || G.drag) requestAnimationFrame(loop); else { G.running = false; if (G.visible) draw(); }
    }
    /** Run the layout to rest before showing, with a work cap so big vaults don't freeze. */
    function settle() {
      const n = Math.max(1, G.nodes.length), steps = Math.min(300, Math.floor(2e7 / (n * n)));
      for (let i = 0; i < steps && G.alpha > 0.02; i++) tick();
    }
    function resize() {
      const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      G.w = r.width; G.h = r.height; canvas.width = Math.max(1, r.width * dpr); canvas.height = Math.max(1, r.height * dpr);
      canvas.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0); draw();
    }
    function fit() {
      if (!G.nodes.length || !G.w) return;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const n of G.nodes) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y); }
      const s = Math.min(1.6, Math.max(0.15, Math.min(G.w / (x1 - x0 + 280), G.h / (y1 - y0 + 140))));
      G.scale = s; G.ox = -((x0 + x1) / 2) * s; G.oy = -((y0 + y1) / 2) * s; draw();
    }
    function zoom(f) {
      G.scale = Math.min(4, Math.max(0.15, G.scale * f));
      G.ox *= f; G.oy *= f; draw();
    }
    const toScreen = (n) => [n.x * G.scale + G.ox + G.w / 2, n.y * G.scale + G.oy + G.h / 2];
    const radius = (n) => 4 + Math.sqrt(n.deg) * 2.2;
    function nodeAt(px, py) {
      for (let i = G.nodes.length - 1; i >= 0; i--) {
        const n = G.nodes[i], [x, y] = toScreen(n), r = radius(n) * Math.max(G.scale, 0.6) + 4;
        if ((px - x) ** 2 + (py - y) ** 2 <= r * r) return n;
      }
      return null;
    }
    function draw() {
      if (!canvas.width) return;
      const ctx = canvas.getContext("2d"), cs = getComputedStyle(document.documentElement), col = (v) => cs.getPropertyValue(v).trim();
      ctx.clearRect(0, 0, G.w, G.h);
      const focus = G.hover || G.by.get(cur()) || null, near = new Set();
      if (focus) for (const [a, b] of G.edges) { if (a === focus) near.add(b); if (b === focus) near.add(a); }
      for (const [a, b] of G.edges) {
        const on = focus && (a === focus || b === focus); const [x1, y1] = toScreen(a), [x2, y2] = toScreen(b);
        const ghost = a.ghost || b.ghost;
        ctx.lineWidth = on ? 1.6 : 1;
        ctx.setLineDash(ghost ? [4, 4] : []);
        ctx.strokeStyle = on ? (ghost ? col("--missing") : col("--accent")) : col("--edge");
        ctx.globalAlpha = focus && !on ? 0.45 : 1;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1; ctx.font = "12px " + col("--f-ui"); ctx.textAlign = "center"; ctx.textBaseline = "top";
      const labelsAll = G.scale > 0.85 || G.nodes.length <= 40;
      for (const n of G.nodes) {
        const [x, y] = toScreen(n), r = radius(n) * Math.max(G.scale, 0.6);
        const isCur = n.id === cur(), hot = n === focus || near.has(n);
        ctx.globalAlpha = focus && !hot && !isCur ? 0.5 : 1;
        if (isCur) { ctx.fillStyle = col("--accent-soft"); ctx.beginPath(); ctx.arc(x, y, r + 7, 0, 6.2832); ctx.fill(); }
        if (n.ghost) {
          ctx.setLineDash([3, 3]); ctx.lineWidth = 1.5; ctx.strokeStyle = col("--missing");
          ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.stroke(); ctx.setLineDash([]);
        } else {
          // Session notes (the shared notes) are orange; everything else is purple or grey.
          ctx.fillStyle = n.session ? col("--session") : isCur || n === focus ? col("--accent") : near.has(n) ? col("--node-near") : col("--node");
          ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
        }
        if (labelsAll || hot || isCur) {
          ctx.fillStyle = n.ghost ? col("--missing") : n.session ? col("--session") : col("--ink");
          ctx.font = (isCur ? "600 " : "") + "12px " + col("--f-ui");
          ctx.fillText(n.label, x, y + r + (isCur ? 9 : 4));
        }
      }
      ctx.globalAlpha = 1;
      if (!G.nodes.length) { ctx.fillStyle = col("--ink-3"); ctx.textBaseline = "middle"; ctx.fillText("No notes yet", G.w / 2, G.h / 2); }
    }

    // Pointer: click a node to open it, drag a node to move it, drag empty space to pan, wheel to zoom.
    let down = null;
    canvas.addEventListener("pointerdown", (e) => {
      const r = canvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top, n = nodeAt(px, py);
      down = { px, py, n, ox: G.ox, oy: G.oy, moved: false };
      try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
      canvas.classList.add("dragging");
      if (n) { G.drag = n; n.fixed = true; G.alpha = Math.max(G.alpha, 0.3); kick(); }
    });
    canvas.addEventListener("pointermove", (e) => {
      const r = canvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      if (!down) { const h = nodeAt(px, py); if (h !== G.hover) { G.hover = h; canvas.style.cursor = h ? "pointer" : ""; draw(); } return; }
      if (Math.abs(px - down.px) + Math.abs(py - down.py) > 4) down.moved = true;
      if (down.n) { down.n.x = (px - G.ox - G.w / 2) / G.scale; down.n.y = (py - G.oy - G.h / 2) / G.scale; }
      else { G.ox = down.ox + px - down.px; G.oy = down.oy + py - down.py; draw(); }
    });
    const up = () => {
      if (!down) return; canvas.classList.remove("dragging");
      if (down.n) { down.n.fixed = false; G.drag = null; if (!down.moved) hooks.onOpen(down.n.id, down.n); }
      down = null;
    };
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("pointerleave", () => { if (!down && G.hover) { G.hover = null; draw(); } });
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault(); const r = canvas.getBoundingClientRect(), px = e.clientX - r.left - G.w / 2, py = e.clientY - r.top - G.h / 2;
      const f = Math.exp(-e.deltaY * 0.0015), ns = Math.min(4, Math.max(0.15, G.scale * f)), q = ns / G.scale;
      G.ox = px - (px - G.ox) * q; G.oy = py - (py - G.oy) * q; G.scale = ns; draw();
    }, { passive: false });
    canvas.addEventListener("dblclick", fit);

    return { setData, resize, fit, zoom, settle, draw, toScreen, state: G };
  }

  root.WPGraph = { createGraph };
})(typeof self !== "undefined" ? self : globalThis);
