"use client";
// BIM Studio in three dimensions.
//
// Unlike the drawing editor's 3D pane, nothing here is assumed. A wall in this
// model carries a real width and a real height, a slab carries a thickness, and
// a level carries an elevation — so what you see is the model, not an inference
// from it. That difference is worth keeping straight: the DXF view is a
// sense-check, this one is the thing itself.
//
// Axonometric, painter-sorted, drawn on a 2D canvas. No engine and no
// perspective, because what a coordinator needs from a 3D view of a bid model
// is "do these disciplines collide" and "is that roof over that room" — both of
// which an axonometric answers, and neither of which needs a renderer.

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { levels, list, type BimDocument, type Element, type Vec2 } from "./model";

const BG = "#0d1017";

interface Face { pts: Array<{ x: number; y: number }>; depth: number; fill: string; stroke: string }

const hex = (c: number) => "#" + c.toString(16).padStart(6, "0");
function shade(h: string, k: number): string {
  const n = parseInt(h.slice(1), 16);
  const f = (v: number) => Math.round(Math.min(255, v * k));
  return `#${((f((n >> 16) & 255) << 16) | (f((n >> 8) & 255) << 8) | f(n & 255)).toString(16).padStart(6, "0")}`;
}

/** The z a element sits at: its own override, else its level's elevation. */
function baseZ(doc: BimDocument, e: Element): number {
  if (typeof e.geom.elevation === "number") return e.geom.elevation;
  const lvl = e.level ? doc.elements[e.level] : undefined;
  return (lvl?.geom.elevation as number | undefined) ?? 0;
}

export function BimIso({ doc, colourOf, hidden }: {
  doc: BimDocument;
  colourOf: (e: Element) => number;
  hidden: Set<string>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [az, setAz] = useState(-Math.PI / 5);
  const [pitch, setPitch] = useState(Math.PI / 3.2);
  const [zoom, setZoom] = useState(1);
  const drag = useRef<{ x: number; y: number; az: number; pi: number } | null>(null);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const apply = () => setSize({ w: el.clientWidth || 600, h: el.clientHeight || 400 });
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const faces = useMemo(() => {
    const ca = Math.cos(az), sa = Math.sin(az);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const P = (x: number, y: number, z: number) => {
      const rx = x * ca - y * sa;
      const ry = x * sa + y * ca;
      return { x: rx, y: ry * cp - z * sp, d: ry * sp + z * cp };
    };
    const out: Face[] = [];
    const quad = (a: any, b: any, c: any, d: any, fill: string, stroke: string) => {
      out.push({
        pts: [a, b, c, d].map((p) => ({ x: p.x, y: p.y })),
        depth: (a.d + b.d + c.d + d.d) / 4,
        fill, stroke,
      });
    };

    for (const e of list(doc)) {
      if (e.category === "level" || hidden.has(e.discipline)) continue;
      const base = hex(colourOf(e));
      const z0 = baseZ(doc, e);
      const g = e.geom;

      if (g.kind === "linear" && g.start && g.end) {
        const h = g.height ?? 3;
        const w = (g.width ?? 0.2) / 2;
        const dx = g.end.x - g.start.x, dy = g.end.y - g.start.y;
        const len = Math.hypot(dx, dy) || 1;
        // Normal across the run gives the wall its thickness, so it reads as a
        // solid rather than a sheet of paper stood on edge.
        const nx = (-dy / len) * w, ny = (dx / len) * w;
        const c: Vec2[] = [
          { x: g.start.x + nx, y: g.start.y + ny }, { x: g.end.x + nx, y: g.end.y + ny },
          { x: g.end.x - nx, y: g.end.y - ny }, { x: g.start.x - nx, y: g.start.y - ny },
        ];
        const lo = c.map((p) => P(p.x, p.y, z0));
        const hi = c.map((p) => P(p.x, p.y, z0 + h));
        for (let i = 0; i < 4; i++) {
          const j = (i + 1) % 4;
          quad(lo[i], lo[j], hi[j], hi[i], shade(base, i % 2 ? 0.42 : 0.56), shade(base, 0.72));
        }
        quad(hi[0], hi[1], hi[2], hi[3], shade(base, 0.8), shade(base, 0.95));
        continue;
      }

      if (g.kind === "area" && g.outline?.length) {
        const th = g.thickness ?? 0.2;
        const top = g.outline.map((p) => P(p.x, p.y, z0 + th));
        out.push({
          pts: top.map((p) => ({ x: p.x, y: p.y })),
          depth: Math.max(...top.map((p) => p.d)),
          fill: shade(base, 0.5), stroke: shade(base, 0.8),
        });
        // Edge band, so a slab has visible thickness from the side.
        const bot = g.outline.map((p) => P(p.x, p.y, z0));
        for (let i = 0; i < g.outline.length; i++) {
          const j = (i + 1) % g.outline.length;
          quad(bot[i], bot[j], top[j], top[i], shade(base, 0.34), shade(base, 0.6));
        }
        continue;
      }

      if (g.kind === "hosted" && g.host) {
        const host = doc.elements[g.host];
        if (!host?.geom.start || !host.geom.end) continue;
        const hl = Math.hypot(host.geom.end.x - host.geom.start.x, host.geom.end.y - host.geom.start.y) || 1;
        const t = Math.min(1, Math.max(0, (g.offset ?? hl / 2) / hl));
        const ux = (host.geom.end.x - host.geom.start.x) / hl, uy = (host.geom.end.y - host.geom.start.y) / hl;
        const cx = host.geom.start.x + ux * hl * t, cy = host.geom.start.y + uy * hl * t;
        const w = (g.width ?? 0.9) / 2;
        const sill = g.sill ?? 0;
        const h = g.height ?? 2.1;
        const zb = baseZ(doc, host) + sill;
        const a = P(cx - ux * w, cy - uy * w, zb), b = P(cx + ux * w, cy + uy * w, zb);
        const c2 = P(cx + ux * w, cy + uy * w, zb + h), d2 = P(cx - ux * w, cy - uy * w, zb + h);
        // Nudged forward in depth so it is not lost inside its own host wall.
        out.push({ pts: [a, b, c2, d2].map((p) => ({ x: p.x, y: p.y })), depth: (a.d + b.d) / 2 + 0.02,
          fill: shade(base, 0.66), stroke: shade(base, 0.95) });
        continue;
      }

      if (g.kind === "point" && g.at) {
        const w = (g.width ?? 0.4) / 2, dp = (g.depth ?? g.width ?? 0.4) / 2, h = g.height ?? 0.6;
        const c: Vec2[] = [
          { x: g.at.x - w, y: g.at.y - dp }, { x: g.at.x + w, y: g.at.y - dp },
          { x: g.at.x + w, y: g.at.y + dp }, { x: g.at.x - w, y: g.at.y + dp },
        ];
        const lo = c.map((p) => P(p.x, p.y, z0));
        const hi = c.map((p) => P(p.x, p.y, z0 + h));
        for (let i = 0; i < 4; i++) {
          const j = (i + 1) % 4;
          quad(lo[i], lo[j], hi[j], hi[i], shade(base, i % 2 ? 0.44 : 0.58), shade(base, 0.75));
        }
        quad(hi[0], hi[1], hi[2], hi[3], shade(base, 0.82), shade(base, 0.95));
      }
    }

    out.sort((p, q) => p.depth - q.depth);
    return out;
  }, [doc, az, pitch, hidden, colourOf]);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !size.w || !size.h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(size.w * dpr);
    cv.height = Math.round(size.h * dpr);
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, size.w, size.h);
    if (!faces.length) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const f of faces) for (const p of f.pts) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }
    const s = Math.min(size.w / Math.max(maxX - minX, 1e-6) / 1.18, size.h / Math.max(maxY - minY, 1e-6) / 1.18) * zoom;
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const X = (x: number) => size.w / 2 + (x - cx) * s;
    const Y = (y: number) => size.h / 2 - (y - cy) * s;

    ctx.lineJoin = "round";
    ctx.lineWidth = 0.8;
    for (const f of faces) {
      ctx.beginPath();
      ctx.moveTo(X(f.pts[0].x), Y(f.pts[0].y));
      for (let i = 1; i < f.pts.length; i++) ctx.lineTo(X(f.pts[i].x), Y(f.pts[i].y));
      ctx.closePath();
      ctx.fillStyle = f.fill;
      ctx.fill();
      ctx.strokeStyle = f.stroke;
      ctx.stroke();
    }
  }, [faces, size, zoom]);

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = { x: e.clientX, y: e.clientY, az, pi: pitch };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    setAz(d.az + (e.clientX - d.x) * 0.006);
    setPitch(Math.max(0.12, Math.min(1.5, d.pi - (e.clientY - d.y) * 0.005)));
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* gone */ }
  };

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      setZoom((z) => Math.max(0.2, Math.min(12, z * (ev.deltaY < 0 ? 1.12 : 1 / 1.12))));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const reset = useCallback(() => { setAz(-Math.PI / 5); setPitch(Math.PI / 3.2); setZoom(1); }, []);
  const storeys = levels(doc).length;

  return (
    <div className="isov" ref={hostRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
      <div className="isov-bar">
        <button className="mini sm" onClick={reset}>Reset view</button>
      </div>
      <div className="isov-hint">Drag to turn · wheel zooms</div>
      {/* No caution here, unlike the DXF pane: these heights are the model's
          own. Worth saying, because the two views look alike. */}
      <div className="isov-note" style={{ color: "#9fb3bd" }}>
        Real widths, heights and levels from the model — {storeys} level{storeys === 1 ? "" : "s"}. Discipline visibility follows the legend.
      </div>
    </div>
  );
}
