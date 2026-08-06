"use client";
// The 3D pane — the same drawing, stood up.
//
// Drag to turn it, wheel to zoom. There is no orbit camera and no perspective
// because there is nothing to be gained from either: this exists to answer
// "does that read as a building" and "is that courtyard actually open", and an
// axonometric answers both without a 3D engine in the bundle.
//
// It states its own assumption on screen. A DXF carries no heights, so the
// storey height here is assumed and the walls are whichever layers are NAMED
// like walls. Nobody should take a quantity off this view, and the caption says
// so where it cannot be missed.

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { DxfModel } from "./model";
import { assumedHeight, buildFaces, faceBounds, guessWallLayers } from "./iso";

const BG = "#0d1017";

export function IsoView({
  model, units, wallHeight, onWallHeight, hint,
}: {
  model: DxfModel;
  units: string;
  /** In drawing units. Assumed, and editable, because it is a guess. */
  wallHeight?: number;
  onWallHeight?: (h: number) => void;
  hint?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [azimuth, setAzimuth] = useState(-Math.PI / 5);
  const [pitch, setPitch] = useState(Math.PI / 3.2);
  const [zoom, setZoom] = useState(1);
  const drag = useRef<{ x: number; y: number; az: number; pi: number } | null>(null);

  const height = wallHeight ?? assumedHeight(model);
  const wallLayers = useMemo(() => guessWallLayers(model), [model.layers]);

  const built = useMemo(
    () => buildFaces(model, { azimuth, pitch, wallHeight: height, wallLayers }),
    [model.entities, model.layers, azimuth, pitch, height, wallLayers]
  );

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const apply = () => setSize({ w: el.clientWidth || 600, h: el.clientHeight || 400 });
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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

    const b = faceBounds(built.faces);
    const bw = Math.max(b.maxX - b.minX, 1e-6);
    const bh = Math.max(b.maxY - b.minY, 1e-6);
    const s = Math.min(size.w / (bw * 1.15), size.h / (bh * 1.15)) * zoom;
    const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    const X = (x: number) => size.w / 2 + (x - cx) * s;
    // Screen Y grows downward; the projection's Y grows up.
    const Y = (y: number) => size.h / 2 - (y - cy) * s;

    ctx.lineJoin = "round";
    for (const f of built.faces) {
      if (f.kind === "line") {
        ctx.strokeStyle = f.stroke;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(X(f.pts[0].x), Y(f.pts[0].y));
        ctx.lineTo(X(f.pts[1].x), Y(f.pts[1].y));
        ctx.stroke();
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(X(f.pts[0].x), Y(f.pts[0].y));
      for (let i = 1; i < f.pts.length; i++) ctx.lineTo(X(f.pts[i].x), Y(f.pts[i].y));
      ctx.closePath();
      ctx.fillStyle = f.fill;
      ctx.fill();
      ctx.strokeStyle = f.stroke;
      ctx.lineWidth = f.kind === "wall" ? 0.8 : 1;
      ctx.stroke();
    }
  }, [built, size, zoom]);

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = { x: e.clientX, y: e.clientY, az: azimuth, pi: pitch };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    setAzimuth(d.az + (e.clientX - d.x) * 0.006);
    // Clamped short of plan and elevation: at either extreme the drawing
    // collapses to a line and there is no way to tell which way to drag back.
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

  const reset = useCallback(() => {
    setAzimuth(-Math.PI / 5);
    setPitch(Math.PI / 3.2);
    setZoom(1);
  }, []);

  return (
    <div className="isov" ref={hostRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />

      <div className="isov-bar">
        <label>
          <span>Storey</span>
          <input
            type="number"
            value={Math.round(height)}
            min={1}
            step={Math.max(1, Math.round(height / 20))}
            onChange={(e) => onWallHeight?.(Number(e.target.value) || height)}
          />
          <span className="u">{units}</span>
        </label>
        <button className="mini sm" onClick={reset}>Reset view</button>
      </div>

      {/* The caption is not decoration. Somebody will otherwise take a height
          off this picture, and the drawing never contained one. */}
      <div className="isov-note">
        {wallLayers.size > 0
          ? `Assumed ${Math.round(height)} ${units} storey, stood up from ${wallLayers.size} layer${wallLayers.size === 1 ? "" : "s"} named like walls. A DXF carries no heights — measure in 2D.`
          : `No layer here is named like a wall, so nothing has been stood up. A DXF carries no heights — measure in 2D.`}
        {built.truncated ? " Showing the longest linework only." : ""}
      </div>

      {hint && <div className="isov-hint">{hint}</div>}
    </div>
  );
}
