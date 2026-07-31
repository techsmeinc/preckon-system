"use client";
// The parsed drawings — what the CAD sidecar actually read out of each .dxf/.dwg.
//
// This sits on the Drawings stage beside BIM Studio, and the two are different
// things on purpose: the Studio is a model you author, this is a drawing
// somebody else issued. What makes it worth a screen is that these are the exact
// facts the agents were given. When an estimator questions a quantity, this is
// where the answer is — the layer it was run off, the block that was counted,
// the note that supplied the thickness.

import { useState } from "react";
import { useApi, Skeleton } from "@/lib/ui";
import { useI18n } from "@/lib/i18n";

interface CadLayerView {
  layer: string;
  runLength_m: number | null;
  largestArea_m2: number | null;
  inserts: number;
}
interface CadView {
  units: string | null;
  sheets: string[];
  titleBlock: Record<string, string>;
  footprint: { area_m2: number; layer: string } | null;
  layers: CadLayerView[];
  blocks: Array<{ name: string; total: number }>;
  schedules: Array<{ layer: string; header: string[]; rows: string[][] }>;
  notes: string[];
  warnings: string[];
  svg: string | null;
}

export function ParsedSheets({ pid }: { pid: string }) {
  const { t } = useI18n();
  const files = useApi<any[]>(`/projects/${pid}/files`, []);
  const drawings = (files.data ?? []).filter((f) => f.cad_layers != null);
  const [open, setOpen] = useState<string | null>(null);

  if (files.loading || drawings.length === 0) return null;
  const active = open ?? drawings[0].id;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="chead">
        <div>
          <h3>{t("cad.title")}</h3>
          <div className="csub">{t("cad.sub")}</div>
        </div>
      </div>

      {drawings.length > 1 && (
        <div className="bim-disc" style={{ marginBottom: 12 }}>
          {drawings.map((f) => (
            <button key={f.id} className={f.id === active ? "on" : ""} onClick={() => setOpen(f.id)}>
              {f.filename}
            </button>
          ))}
        </div>
      )}

      <SheetDetail pid={pid} fid={active} />
    </div>
  );
}

function SheetDetail({ pid, fid }: { pid: string; fid: string }) {
  const { t } = useI18n();
  const { data, loading, error } = useApi<CadView>(`/projects/${pid}/files/${fid}/cad`);
  if (loading) return <Skeleton rows={4} />;
  if (error || !data) return <div className="csub">{error ?? t("common.loadFail")}</div>;

  return (
    <>
      {data.warnings.length > 0 && (
        <div className="synth" style={{ marginBottom: 12 }}>
          <span>{data.warnings.slice(0, 3).join(" · ")}</span>
        </div>
      )}

      <div className="bim-wrap">
        <div className="bim-main">
          {data.svg ? (
            // The renderer emits a standalone, self-contained SVG — no scripts,
            // no external refs — so it is safe to inline and needed to make it
            // scale to the panel.
            <div className="cad-sheet" dangerouslySetInnerHTML={{ __html: data.svg }} />
          ) : (
            <div className="csub" style={{ padding: 24 }}>{t("cad.noRender")}</div>
          )}
        </div>

        <aside className="bim-side">
          <h4>{t("cad.measured")}</h4>
          <div className="trow-lbl" style={{ borderTop: 0 }}>
            {t("cad.units")} <b className="mono">{data.units ?? "—"}</b>
          </div>
          {data.footprint && (
            <div className="trow-lbl">
              {t("cad.footprint")} <b className="mono">{data.footprint.area_m2} m²</b>
            </div>
          )}
          {data.sheets.length > 0 && (
            <div className="trow-lbl">{t("cad.sheets")} <b>{data.sheets.join(", ")}</b></div>
          )}
          {Object.entries(data.titleBlock).slice(0, 6).map(([k, v]) => (
            <div className="trow-lbl" key={k}>{k} <b>{v}</b></div>
          ))}

          {data.blocks.length > 0 && (
            <>
              <h4 style={{ marginTop: 18 }}>{t("cad.blocks")}</h4>
              {data.blocks.slice(0, 12).map((b) => (
                <div className="bim-leg-r" key={b.name}>
                  <span>{b.name}</span>
                  <b className="mono">{b.total}</b>
                </div>
              ))}
            </>
          )}

          {data.layers.length > 0 && (
            <>
              <h4 style={{ marginTop: 18 }}>{t("cad.layers")}</h4>
              {data.layers.slice(0, 14).map((l) => (
                <div className="trow-lbl" key={l.layer}>
                  {l.layer}{" "}
                  <b className="mono">
                    {[
                      l.runLength_m ? `${l.runLength_m} m` : "",
                      l.largestArea_m2 ? `${l.largestArea_m2} m²` : "",
                      l.inserts ? `${l.inserts} nr` : "",
                    ].filter(Boolean).join(" · ") || "—"}
                  </b>
                </div>
              ))}
            </>
          )}
        </aside>
      </div>

      {data.schedules.map((s, i) => (
        <div className="tw" key={i} style={{ marginTop: 12 }}>
          <table className="tbl">
            <thead><tr>{s.header.map((h, j) => <th key={j}>{h}</th>)}</tr></thead>
            <tbody>
              {s.rows.slice(0, 30).map((r, j) => (
                <tr key={j}>{r.map((c, k) => <td key={k}>{c}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {data.notes.length > 0 && (
        <p className="csub" style={{ marginTop: 12 }}>
          <b>{t("cad.notes")}</b> {data.notes.slice(0, 20).join(" · ")}
        </p>
      )}
    </>
  );
}
