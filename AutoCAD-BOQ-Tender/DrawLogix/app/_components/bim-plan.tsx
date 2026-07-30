"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { type BimDocument, CATALOG, type Discipline, type Element, linLength } from "@/bim/model";

/**
 * 2D plan view of the BIM model — a top-down architectural drawing generated from the
 * SAME document as the 3D viewport. Walls as thick bands, rooms/slabs as polygons, doors
 * with swings, windows as sills, columns/equipment/fixtures as symbols, MEP linework, and
 * grids with bubbles. Zoom (wheel), pan (drag), click to select, per-discipline show/hide.
 */

const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

export function BimPlan({ doc, selected, onSelect, hidden }: { doc: BimDocument; selected: string | null; onSelect: (id: string | null) => void; hidden: Set<Discipline> }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ s: 20, tx: 0, ty: 0 }); // scale (px/m), pan (px)
  const viewRef = useRef(view);
  viewRef.current = view;
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const fittedFor = useRef(0);

  const els = doc.order.map((id) => doc.elements[id]).filter((e) => e && e.geom && e.category !== "level" && !hidden.has(e.discipline)) as Element[];

  // Fit to bounds when the model first appears (or count jumps).
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const bounds = planBounds(els);
    if (!bounds) return;
    const count = els.length;
    if (fittedFor.current !== 0 && Math.abs(count - fittedFor.current) < 3) return; // don't fight the user on small changes
    fittedFor.current = count;
    const W = wrap.clientWidth || 800;
    const H = wrap.clientHeight || 600;
    const spanX = Math.max(bounds.maxX - bounds.minX, 1);
    const spanY = Math.max(bounds.maxY - bounds.minY, 1);
    const s = Math.max(2, Math.min(120, 0.85 * Math.min(W / spanX, H / spanY)));
    // world (x, -y) → screen; centre the bounds
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    setView({ s, tx: W / 2 - cx * s, ty: H / 2 + cy * s });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [els.length]);

  // Wheel zoom toward cursor (non-passive).
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = wrap.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      const v = viewRef.current;
      const ns = Math.max(1, Math.min(400, v.s * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
      const k = ns / v.s;
      setView({ s: ns, tx: mx - (mx - v.tx) * k, ty: my - (my - v.ty) * k });
    };
    wrap.addEventListener("wheel", onWheel, { passive: false });
    return () => wrap.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, tx: viewRef.current.tx, ty: viewRef.current.ty };
    (e.target as unknown as { setPointerCapture?: (id: number) => void }).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setView((v) => ({ ...v, tx: drag.current!.tx + (e.clientX - drag.current!.x), ty: drag.current!.ty + (e.clientY - drag.current!.y) }));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const { s, tx, ty } = view;
  // world → screen helpers (Y flipped so north is up)
  const P = (x: number, y: number) => `${(x * s + tx).toFixed(1)},${(-y * s + ty).toFixed(1)}`;

  return (
    <div className="relative h-full w-full overflow-hidden bg-white" style={{ backgroundImage: "radial-gradient(#dfe4ec 0.8px, transparent 0.8px)", backgroundSize: "20px 20px" }}>
      <div ref={wrapRef} className="h-full w-full cursor-grab touch-none active:cursor-grabbing" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}>
        <svg className="h-full w-full" onClick={(e) => { if ((e.target as SVGElement).tagName === "svg") onSelect(null); }}>
          <title>BIM plan</title>
          {els.map((el) => (
            <PlanElement key={el.id} el={el} doc={doc} selected={el.id === selected} onSelect={onSelect} P={P} s={s} />
          ))}
        </svg>
      </div>
      <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-white/85 px-2 py-1 text-[11px] text-slate-500 shadow-sm">Top-down plan · scroll = zoom · drag = pan · click = select</div>
    </div>
  );
}

function PlanElement({ el, doc, selected, onSelect, P, s }: { el: Element; doc: BimDocument; selected: boolean; onSelect: (id: string) => void; P: (x: number, y: number) => string; s: number }) {
  const cat = CATALOG[el.category];
  const color = selected ? "#2563eb" : hex(cat?.color ?? 0x9aa3b2);
  const g = el.geom;
  if (!g) return null;
  const pick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(el.id);
  };
  const isWallish = /wall/.test(el.category);

  const wrap = (node: ReactNode) => (
    <g onClick={pick} className="cursor-pointer">
      {node}
    </g>
  );

  if (g.kind === "linear" && g.start && g.end) {
    const [x1, y1] = [g.start.x, g.start.y];
    const [x2, y2] = [g.end.x, g.end.y];
    const wpx = Math.max(1, (g.width ?? 0.15) * s);
    const [ax, ay] = P(x1, y1).split(",").map(Number);
    const [bx, by] = P(x2, y2).split(",").map(Number);
    // grids: dashed thin line
    if (el.category === "grid") {
      return wrap(<line x1={ax} y1={ay} x2={bx} y2={by} stroke={color} strokeWidth={1} strokeDasharray="6 4" />);
    }
    return wrap(
      <>
        <line x1={ax} y1={ay} x2={bx} y2={by} stroke="transparent" strokeWidth={Math.max(wpx, 10)} strokeLinecap="round" />
        <line x1={ax} y1={ay} x2={bx} y2={by} stroke={color} strokeWidth={wpx} strokeLinecap={isWallish ? "butt" : "round"} opacity={isWallish ? 0.95 : 0.9} />
      </>,
    );
  }

  if (g.kind === "area" && g.outline && g.outline.length >= 3) {
    const pts = g.outline.map((p) => P(p.x, p.y)).join(" ");
    const isRoom = el.category === "room";
    const [cx, cy] = centroid(g.outline);
    return wrap(
      <>
        <polygon points={pts} fill={selected ? "#2563eb22" : isRoom ? `${color}1f` : `${color}12`} stroke={color} strokeWidth={isRoom ? 1 : 1.2} />
        {isRoom && s > 6 && <text x={Number(P(cx, cy).split(",")[0])} y={Number(P(cx, cy).split(",")[1])} textAnchor="middle" fontSize={11} fill="#475569">{el.name ?? "Room"}</text>}
      </>,
    );
  }

  if (g.kind === "point" && g.at) {
    const w = (g.width ?? 0.4) * s;
    const d = (g.depth ?? 0.4) * s;
    const [px, py] = P(g.at.x, g.at.y).split(",").map(Number);
    const big = (g.width ?? 0) > 0.6 || (g.depth ?? 0) > 0.6;
    if (big || el.category === "column" || el.category === "footing") {
      return wrap(<rect x={px - w / 2} y={py - d / 2} width={Math.max(w, 3)} height={Math.max(d, 3)} fill={`${color}cc`} stroke={color} strokeWidth={1} transform={`rotate(${((g.rot ?? 0) * -180) / Math.PI} ${px} ${py})`} />);
    }
    const r = Math.max(3, Math.min(w, d) / 2 || 4);
    return wrap(<circle cx={px} cy={py} r={r} fill={color} stroke="#334155" strokeWidth={0.6} />);
  }

  if (g.kind === "hosted" && g.host) {
    const host = doc.elements[g.host];
    if (!host || host.geom.kind !== "linear" || !host.geom.start || !host.geom.end) return null;
    const len = linLength(host) || 0.01;
    const ux = (host.geom.end.x - host.geom.start.x) / len;
    const uy = (host.geom.end.y - host.geom.start.y) / len;
    const nx = -uy;
    const ny = ux;
    const a0 = (g.offset ?? 0);
    const a1 = a0 + (g.width ?? 0.9);
    const p0 = { x: host.geom.start.x + ux * a0, y: host.geom.start.y + uy * a0 };
    const p1 = { x: host.geom.start.x + ux * a1, y: host.geom.start.y + uy * a1 };
    if (el.category === "door") {
      const sw = g.width ?? 0.9;
      const [hx, hy] = P(p0.x, p0.y).split(",").map(Number);
      const [ex, ey] = P(p0.x + nx * sw, p0.y + ny * sw).split(",").map(Number);
      const [lx, ly] = P(p1.x, p1.y).split(",").map(Number);
      return wrap(
        <>
          <line x1={hx} y1={hy} x2={lx} y2={ly} stroke="#fff" strokeWidth={Math.max(2, (host.geom.width ?? 0.2) * s)} />
          <line x1={hx} y1={hy} x2={ex} y2={ey} stroke={color} strokeWidth={1.4} />
          <path d={`M ${lx} ${ly} A ${sw * s} ${sw * s} 0 0 0 ${ex} ${ey}`} fill="none" stroke={color} strokeWidth={1} opacity={0.7} />
        </>,
      );
    }
    // window: gap + double sill line
    const [ax, ay] = P(p0.x, p0.y).split(",").map(Number);
    const [bx, by] = P(p1.x, p1.y).split(",").map(Number);
    return wrap(
      <>
        <line x1={ax} y1={ay} x2={bx} y2={by} stroke="#fff" strokeWidth={Math.max(2, (host.geom.width ?? 0.2) * s)} />
        <line x1={ax} y1={ay} x2={bx} y2={by} stroke={color} strokeWidth={2} />
      </>,
    );
  }
  return null;
}

function planBounds(els: Element[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const grow = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const e of els) {
    const g = e.geom;
    if (g.start) grow(g.start.x, g.start.y);
    if (g.end) grow(g.end.x, g.end.y);
    if (g.at) grow(g.at.x, g.at.y);
    if (g.outline) for (const p of g.outline) grow(p.x, p.y);
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

function centroid(pts: { x: number; y: number }[]): [number, number] {
  const n = pts.length || 1;
  return [pts.reduce((a, p) => a + p.x, 0) / n, pts.reduce((a, p) => a + p.y, 0) / n];
}
