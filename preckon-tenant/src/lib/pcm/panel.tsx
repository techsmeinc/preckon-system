"use client";
// The construction model, beside the tool that produced it.
//
// This panel is where BIM Studio stops being a drawing program. Until it
// existed, a wall you modelled was an entry in a JSON document: real on screen,
// invisible to everything else. Published, the same wall is an object with an
// identity, a measured area and a place in the graph — and this is where you
// see that it worked.
//
// The design rule here is that a number is never shown without a way to ask why
// it is that number. Every quantity opens its own arithmetic: the length, the
// height, the openings deducted, the threshold that decided which ones counted.

import { useCallback, useState } from "react";
import { api } from "@/lib/apiclient";
import { useApi, useCan, useToast, Skeleton } from "@/lib/ui";

interface Quantity { rule: string; value: number; unit: string; stale: boolean }
interface PcmObject {
  id: string; type: string; typeName: string; name: string | null; mark: string | null;
  source: string; confidence: number | null; quantities: Quantity[];
}
interface ModelView {
  revision: number; count: number; objects: PcmObject[];
  totals: Array<{ rule: string; unit: string; value: number }>;
}

/** "NET_WALL_AREA:v1" reads as engineering; "Net wall area" reads as a bill.
 *  The version stays available in the trace, where it matters. */
const ruleLabel = (code: string) =>
  code.replace(/:v\d+$/, "").toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

const UNIT: Record<string, string> = { m: "m", m2: "m²", m3: "m³", nr: "nr" };
const fmt = (n: number, unit: string) =>
  `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${UNIT[unit] ?? unit}`;

export function PcmPanel({ pid }: { pid: string }) {
  const toast = useToast();
  const canEdit = useCan("artifact.edit");
  const { data, loading, reload } = useApi<ModelView>(`/projects/${pid}/pcm/objects`);
  const [publishing, setPublishing] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const publish = useCallback(async () => {
    setPublishing(true);
    try {
      const r = await api.post<{ objects: number; quantities: number; revision: number; skipped: number }>(
        `/projects/${pid}/pcm/publish`
      );
      toast(`${r.objects} objects published and measured — revision ${r.revision}.`);
      reload();
    } catch (e: any) {
      toast(e?.message ?? "Could not publish the model", "bad");
    } finally { setPublishing(false); }
  }, [pid, reload, toast]);

  if (loading) return <Skeleton rows={4} />;

  const objects = data?.objects ?? [];

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="chead">
        <div>
          <h2>Construction model</h2>
          <div className="csub">
            {objects.length
              ? `${objects.length} objects · revision ${data?.revision ?? 0} — every quantity below traces to one of them`
              : "The objects behind the drawing — what a bill line can point at"}
          </div>
        </div>
        {canEdit && (
          <button className="mini sm pri" onClick={publish} disabled={publishing}>
            {publishing ? "Publishing…" : objects.length ? "Publish again" : "Publish to model"}
          </button>
        )}
      </div>

      {!objects.length ? (
        <p className="csub" style={{ margin: 0 }}>
          Nothing published yet. Model something in the Studio above, then publish it — the elements
          become construction objects with measured quantities, and a bill line can cite them.
        </p>
      ) : (
        <>
          {/* What the model measures, in total. The number an estimator reads. */}
          {!!data?.totals.length && (
            <div className="dwg-stat" style={{ marginBottom: 12 }}>
              {data.totals.map((t) => (
                <div className="st" key={t.rule}>
                  <div className="k">{ruleLabel(t.rule)}</div>
                  <div className="v mono">{fmt(t.value, t.unit)}</div>
                </div>
              ))}
            </div>
          )}

          <div className="tw">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Object</th>
                  <th>Type</th>
                  <th>Measured</th>
                  <th>Source</th>
                  <th><span className="vh">Trace</span></th>
                </tr>
              </thead>
              <tbody>
                {objects.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <b>{o.name ?? o.mark ?? o.typeName}</b>
                      {o.mark && <div className="csub mono">{o.mark}</div>}
                    </td>
                    <td>{o.typeName}</td>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {o.quantities.length
                        ? o.quantities.map((q) => (
                            <div key={q.rule}>
                              {fmt(q.value, q.unit)}
                              <span className="csub"> {ruleLabel(q.rule).toLowerCase()}</span>
                              {/* Said out loud. A stale figure that looks
                                  current is the one failure the blueprint
                                  names by itself. */}
                              {q.stale && <span className="conf warn" style={{ marginInlineStart: 6 }}>stale</span>}
                            </div>
                          ))
                        : "—"}
                    </td>
                    <td>
                      <span className="srcchip">{o.source.toLowerCase()}</span>
                      {o.confidence != null && (
                        <span className={"conf" + (o.confidence < 0.9 ? " warn" : "")} style={{ marginInlineStart: 6 }}>
                          {Math.round(o.confidence * 100)}%
                        </span>
                      )}
                    </td>
                    <td className="num">
                      <button className="mini sm" onClick={() => setOpen(open === o.id ? null : o.id)}>
                        {open === o.id ? "Hide" : "Why?"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {open && <ObjectTrace pid={pid} oid={open} />}
        </>
      )}
    </div>
  );
}

/**
 * The working out.
 *
 * Not a summary of the calculation — the calculation. Length, height, gross
 * area, each opening deducted by name, and the threshold that decided which
 * openings were big enough to count. This is what turns a number somebody has
 * to believe into a number they can check.
 */
function ObjectTrace({ pid, oid }: { pid: string; oid: string }) {
  const { data, loading } = useApi<any>(`/projects/${pid}/pcm/objects/${oid}/trace`);
  if (loading) return <Skeleton rows={3} />;
  if (!data) return null;

  return (
    <div className="dwg-det" style={{ marginTop: 12 }}>
      <div className="dt">{data.object.name ?? data.object.mark ?? data.object.typeName}</div>
      <div className="dk">
        {data.object.typeName}
        {data.provenance.fromFile ? ` · recognised from ${data.provenance.fromFile}` : ` · ${data.provenance.method.toLowerCase()}`}
        {data.provenance.confidence != null ? ` · ${Math.round(data.provenance.confidence * 100)}% confidence` : ""}
      </div>

      {data.quantities.map((q: any) => (
        <div key={q.rule} style={{ marginTop: 12 }}>
          <div className="trow-lbl">
            {ruleLabel(q.rule)}
            <b className="mono">{fmt(q.value, q.unit)}{q.stale ? " (stale)" : ""}</b>
          </div>
          <p className="csub" style={{ margin: "4px 0 0" }}>{q.calculation?.basis}</p>

          {/* The inputs, so the multiplication can be redone by hand. */}
          {q.calculation?.inputs && (
            <div className="csub mono" style={{ marginTop: 4, fontSize: 11.5 }}>
              {Object.entries(q.calculation.inputs).map(([k, v]) => `${k} ${v}`).join("  ·  ")}
            </div>
          )}

          {/* The deductions, itemised. "Less openings" is not an answer. */}
          {!!q.calculation?.deductions?.length && (
            <ul className="sch-notes" style={{ marginTop: 6 }}>
              {q.calculation.deductions.map((d: any) => (
                <li key={d.objectId}>less {d.description} — {d.areaM2} m²</li>
              ))}
            </ul>
          )}

          {/* When it could not be measured, why. Never a silent zero. */}
          {q.calculation?.problem && (
            <p className="csub warn" style={{ margin: "4px 0 0" }}>{q.calculation.problem}</p>
          )}
        </div>
      ))}

      {!!data.relationships.hosts.length && (
        <div className="trow-lbl" style={{ marginTop: 12 }}>
          Hosts <b>{data.relationships.hosts.map((h: any) => h.mark ?? h.type).join(", ")}</b>
        </div>
      )}
      {!!data.boqLines.length && (
        <div className="trow-lbl">
          In the bill <b>{data.boqLines.map((b: any) => b.code ?? b.artifactId.slice(0, 8)).join(", ")}</b>
        </div>
      )}
    </div>
  );
}
