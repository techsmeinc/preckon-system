"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { type BimDocument, CATALOG, type Discipline, type Element, levelElev } from "@/bim/model";

/**
 * Multi-discipline 3D BIM viewport (three.js, Z-up). Renders every element by its
 * geometry archetype (linear / area / point / hosted) in its catalog colour, with orbit
 * navigation, click-to-select, and per-discipline visibility. Pure view of the model.
 */

const SEL = 0x2563eb;

export function BimViewport({
  doc,
  selected,
  onSelect,
  hidden,
}: {
  doc: BimDocument;
  selected: string | null;
  onSelect: (id: string | null) => void;
  hidden: Set<Discipline>;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const st = useRef<{ scene: THREE.Scene; camera: THREE.PerspectiveCamera; renderer: THREE.WebGLRenderer; controls: OrbitControls; group: THREE.Group; ray: THREE.Raycaster } | null>(null);
  const docRef = useRef(doc);
  const selRef = useRef(selected);
  const hidRef = useRef(hidden);
  docRef.current = doc;
  selRef.current = selected;
  hidRef.current = hidden;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    THREE.Object3D.DEFAULT_UP.set(0, 0, 1);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xeef1f6);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 8000);
    camera.up.set(0, 0, 1);
    camera.position.set(22, -26, 18);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(5, 5, 1.5);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a94a6, 1.15));
    const sun = new THREE.DirectionalLight(0xffffff, 1.35);
    sun.position.set(30, -40, 60);
    scene.add(sun);
    const grid = new THREE.GridHelper(400, 400, 0xc7cdd8, 0xdfe4ec);
    grid.rotation.x = Math.PI / 2;
    scene.add(grid);
    scene.add(new THREE.AxesHelper(2));

    const group = new THREE.Group();
    scene.add(group);
    const ray = new THREE.Raycaster();
    st.current = { scene, camera, renderer, controls, group, ray };

    let raf = 0;
    const loop = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();

    const resize = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    let downXY = { x: 0, y: 0 };
    const onDown = (e: PointerEvent) => {
      downXY = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - downXY.x, e.clientY - downXY.y) > 5) return; // drag, not click
      const s = st.current;
      if (!s) return;
      const r = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      s.ray.setFromCamera(ndc, s.camera);
      const hit = s.ray.intersectObjects(s.group.children, true).find((h) => h.object.userData?.id);
      onSelect(hit ? (hit.object.userData.id as string) : null);
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);

    rebuild(st.current, docRef.current, selRef.current, hidRef.current);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      controls.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
      st.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: rebuild reads props directly
  useEffect(() => {
    if (st.current) rebuild(st.current, doc, selected, hidden);
  }, [doc, selected, hidden]);

  return <div ref={mountRef} className="h-full w-full" />;
}

function rebuild(st: { group: THREE.Group }, doc: BimDocument, selected: string | null, hidden: Set<Discipline>) {
  const g = st.group;
  for (const c of [...g.children]) {
    g.remove(c);
    (c as THREE.Mesh).geometry?.dispose?.();
  }
  const mat = (color: number, opts: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0.03, ...opts });
  const add = (o: THREE.Object3D, id: string) => {
    o.userData.id = id;
    g.add(o);
  };

  for (const el of doc.order.map((id) => doc.elements[id]).filter(Boolean) as Element[]) {
    if (!el || !el.geom || el.category === "level" || hidden.has(el.discipline)) continue;
    try {
    const cat = CATALOG[el.category];
    const color = el.id === selected ? SEL : (cat?.color ?? 0x9aa3b2);
    const base = levelElev(doc, el.level) + (el.geom.elevation ?? 0);
    const gg = el.geom;

    if (gg.kind === "linear" && gg.start && gg.end) {
      const dx = gg.end.x - gg.start.x;
      const dy = gg.end.y - gg.start.y;
      const len = Math.hypot(dx, dy) || 0.05;
      const h = gg.height ?? 0.2;
      const box = new THREE.Mesh(new THREE.BoxGeometry(len, gg.width ?? 0.2, h), mat(color));
      box.position.set((gg.start.x + gg.end.x) / 2, (gg.start.y + gg.end.y) / 2, base + h / 2);
      box.rotation.z = Math.atan2(dy, dx);
      add(box, el.id);
    } else if (gg.kind === "area" && gg.outline && gg.outline.length >= 3) {
      const shape = new THREE.Shape(gg.outline.map((p) => new THREE.Vector2(p.x, p.y)));
      const t = gg.thickness ?? 0;
      if (t > 0.001) {
        const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false }), mat(color));
        mesh.position.z = base - t;
        add(mesh, el.id);
      } else {
        const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat(color, { transparent: true, opacity: 0.16, side: THREE.DoubleSide }));
        mesh.position.z = base + 0.02;
        add(mesh, el.id);
      }
    } else if (gg.kind === "point" && gg.at) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(gg.width ?? 0.4, gg.depth ?? 0.4, gg.height ?? 1), mat(color));
      box.position.set(gg.at.x, gg.at.y, base + (gg.height ?? 1) / 2);
      box.rotation.z = gg.rot ?? 0;
      add(box, el.id);
    } else if (gg.kind === "hosted" && gg.host) {
      const host = doc.elements[gg.host];
      if (host && host.geom.kind === "linear" && host.geom.start && host.geom.end) {
        const hx = host.geom.end.x - host.geom.start.x;
        const hy = host.geom.end.y - host.geom.start.y;
        const len = Math.hypot(hx, hy) || 0.05;
        const along = (gg.offset ?? 0) + (gg.width ?? 0.9) / 2;
        const px = host.geom.start.x + (hx / len) * along;
        const py = host.geom.start.y + (hy / len) * along;
        const hb = levelElev(doc, host.level);
        const cz = hb + (gg.sill ?? 0) + (gg.height ?? 2) / 2;
        const isWin = el.category === "window";
        const panel = new THREE.Mesh(new THREE.BoxGeometry(gg.width ?? 0.9, (host.geom.width ?? 0.2) * 1.3, gg.height ?? 2), mat(color, isWin ? { transparent: true, opacity: 0.5 } : {}));
        panel.position.set(px, py, cz);
        panel.rotation.z = Math.atan2(hy, hx);
        add(panel, el.id);
      }
    }
    } catch {
      /* skip any element with malformed geometry rather than crash the whole viewport */
    }
  }
}
