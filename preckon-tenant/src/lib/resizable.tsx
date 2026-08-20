"use client";
// A draggable divider for the editors' side panels.
//
// The drawing editor and BIM Studio both put the assistant in a fixed column —
// 250px and 280px. That is fine until somebody actually uses it: the copilot's
// answers wrap into a ribbon three words wide, and the person who wants to read
// one has no way to make room, while the person who wants the canvas has no way
// to get rid of it.
//
// So the width is a CSS variable, the divider drags it, and the value is
// remembered per panel. Three things that are easy to leave out and are the
// difference between a resizer and a resizer somebody can live with:
//
//   It remembers. A width you have to set on every visit is a width you stop
//   setting.
//   It collapses. Double-click, or drag past the minimum — because the fastest
//   way to see the whole drawing is to make the panel go away entirely, and
//   dragging it to 40px is not that.
//   It works from the keyboard. Arrow keys move it, Home restores the default.
//   A control only reachable by mouse is one a lot of estimators cannot use.

import { useCallback, useEffect, useRef, useState } from "react";

export interface ResizableOptions {
  /** Distinguishes stored widths — one per panel. */
  storageKey: string;
  defaultWidth: number;
  min?: number;
  max?: number;
  /** Which CSS variable the container reads for its column width. */
  cssVar: string;
  /** Panel is on the inline-end (right in LTR). Drag direction inverts if not. */
  side?: "end" | "start";
}

const read = (key: string, fallback: number): number => {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Width state plus the handle that changes it.
 *
 * Returns the props for a container and a `<SplitHandle />` to place between
 * the two panes. The container gets the CSS variable rather than an inline
 * width, so the stylesheet keeps owning the layout and this only owns the
 * number.
 */
export function useResizablePanel(opts: ResizableOptions) {
  const { storageKey, defaultWidth, cssVar, side = "end" } = opts;
  const min = opts.min ?? 180;
  const max = opts.max ?? 720;
  /** Under this, dragging is treated as "put it away" rather than "make it tiny". */
  const collapseAt = min * 0.6;

  const [width, setWidth] = useState(defaultWidth);
  const [collapsed, setCollapsed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Read after mount, never during render: localStorage does not exist on the
  // server, and a width that differs between the server's HTML and the
  // client's is a hydration mismatch.
  useEffect(() => {
    setWidth(read(storageKey, defaultWidth));
    setCollapsed(read(`${storageKey}:collapsed`, 0) === 1);
  }, [storageKey, defaultWidth]);

  const persist = useCallback((w: number, isCollapsed: boolean) => {
    try {
      window.localStorage.setItem(storageKey, String(w));
      window.localStorage.setItem(`${storageKey}:collapsed`, isCollapsed ? "1" : "0");
    } catch { /* private mode, quota — the panel still works, it just forgets */ }
  }, [storageKey]);

  const apply = useCallback((w: number, isCollapsed = false) => {
    const clamped = Math.min(max, Math.max(min, w));
    setWidth(clamped);
    setCollapsed(isCollapsed);
    persist(clamped, isCollapsed);
  }, [min, max, persist]);

  const toggle = useCallback(() => apply(width, !collapsed), [apply, width, collapsed]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const container = ref.current;
    if (!container) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDragging(true);

    const rect = container.getBoundingClientRect();

    const move = (ev: PointerEvent) => {
      // Measured from the container edge rather than by accumulating deltas:
      // deltas drift when the pointer leaves the window and comes back.
      const raw = side === "end" ? rect.right - ev.clientX : ev.clientX - rect.left;
      if (raw < collapseAt) { setCollapsed(true); return; }
      setCollapsed(false);
      setWidth(Math.min(max, Math.max(min, raw)));
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      // Read straight off the element: state is a render behind at this point.
      const current = Number(
        (container.style.getPropertyValue(cssVar) || `${defaultWidth}px`).replace("px", ""),
      );
      persist(Number.isFinite(current) ? current : defaultWidth, container.dataset.collapsed === "1");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, [side, collapseAt, min, max, cssVar, defaultWidth, persist]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 48 : 12;
    if (e.key === "ArrowLeft") { e.preventDefault(); apply(side === "end" ? width + step : width - step); }
    else if (e.key === "ArrowRight") { e.preventDefault(); apply(side === "end" ? width - step : width + step); }
    else if (e.key === "Home") { e.preventDefault(); apply(defaultWidth); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
  }, [apply, width, side, defaultWidth, toggle]);

  const effective = collapsed ? 0 : width;

  return {
    width: effective,
    collapsed,
    dragging,
    toggle,
    /**
     * Spread onto the grid container.
     *
     * Deliberately carries no className: the container already has one, and a
     * spread that overwrites it silently drops the layout class. The caller
     * composes `dragging` into its own className instead.
     */
    containerProps: {
      ref,
      "data-collapsed": collapsed ? "1" : "0",
      "data-resizing": dragging ? "1" : "0",
      style: { [cssVar]: `${effective}px` } as React.CSSProperties,
    },
    handleProps: {
      role: "separator" as const,
      "aria-orientation": "vertical" as const,
      "aria-valuenow": effective,
      "aria-valuemin": 0,
      "aria-valuemax": max,
      "aria-label": "Resize panel",
      tabIndex: 0,
      onPointerDown,
      onKeyDown,
      onDoubleClick: toggle,
    },
  };
}

/** The divider itself. Wide enough to grab, thin enough to ignore. */
export function SplitHandle(props: Record<string, unknown>) {
  return (
    <div className="split-handle" {...props}>
      <span className="grip" aria-hidden />
    </div>
  );
}
