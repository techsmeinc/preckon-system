"use client";
// The work programme — an editable P6-style Gantt.
//
// Ported from TenderLogix's work-programme, with one architectural difference
// that matters: every activity here is an ARTIFACT. Editing one therefore goes
// through the same path as confirming an agent's proposal — a new version, the
// old one superseded, an entry on the audit chain. That is slower per keystroke
// than mutating a row, and it is the right trade for a tender programme: when a
// client asks why the handover date moved, the answer is on the chain.
//
// Everything the planner can do — rename, retime, relink, add, delete, assign,
// mark progress — the agent can also do, because both write the same payload.

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/apiclient";
import { useCan, useToast } from "@/lib/ui";
import { useI18n } from "@/lib/i18n";
import { buildTree, computeCpm, type RelType, type TreeNode } from "@/lib/cpm";

const REL_TYPES: RelType[] = ["FS", "SS", "FF", "SF"];
const ROW_H = 34;

interface Member { id: string; name: string; email: string }

export interface GanttProps {
  pid: string;
  rows: any[];
  /** boq code → amount in minor units, for the Cost column. */
  costByCode: Map<string, number>;
  currency: string;
  commencement: string | null;
  members: Member[];
  reload: () => void;
  onSettings: (iso: string | null) => Promise<void>;
}

/* ── Dates ────────────────────────────────────────────────────────────────── */

const MS_DAY = 86_400_000;
const addDays = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * MS_DAY);

export function ProgrammeGantt({
  pid, rows, costByCode, currency, commencement, members, reload, onSettings,
}: GanttProps) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const canEdit = useCan("artifact.edit");

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [onlyCritical, setOnlyCritical] = useState(false);
  const [assignee, setAssignee] = useState("");
  const [busy, setBusy] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);

  const { nodes, total, criticalPath, warnings } = useMemo(() => computeCpm(rows), [rows]);
  const tree = useMemo(() => buildTree(nodes), [nodes]);

  // Hide the children of a collapsed section, and anything filtered out.
  const visible = useMemo(() => {
    const hidden = new Set<string>();
    for (const n of tree) {
      const parent = String(n.a.payload?.parent ?? "");
      if (parent && (collapsed.has(parent) || hidden.has(parent))) hidden.add(n.name);
    }
    return tree.filter((n) => {
      if (hidden.has(n.name)) return false;
      if (onlyCritical && !n.critical && !n.isSection) return false;
      if (assignee && String(n.a.payload?.assignee ?? "") !== assignee) return false;
      return true;
    });
  }, [tree, collapsed, onlyCritical, assignee]);

  const dayW = Math.max(2, 8 * zoom);
  const chartW = Math.max(320, (total + 2) * dayW);
  const x = (d: number) => d * dayW;

  const fmtDay = (d: number) => {
    if (!commencement) return t("prog.dayN", { n: d });
    return addDays(commencement, d).toLocaleDateString(locale, { day: "2-digit", month: "short" });
  };

  /* ── Mutations. Each one supersedes the artifact and appends to the chain. ── */

  async function patch(node: TreeNode, changes: Record<string, unknown>) {
    if (!canEdit) return;
    setBusy(true);
    try {
      await api.patch(`/projects/${pid}/artifacts/${node.a.id}`, {
        payload: { ...node.a.payload, ...changes },
      });
      reload();
    } catch (e: any) {
      toast(e?.message ?? t("prog.saveFail"), "bad");
    } finally { setBusy(false); }
  }

  async function add(kind: "section" | "activity", parent?: string, milestone = false) {
    if (!canEdit) return;
    setBusy(true);
    try {
      await api.post(`/projects/${pid}/programme`, {
        activity: milestone ? t("prog.newMilestone") : kind === "section" ? t("prog.newSection") : t("prog.newActivity"),
        kind,
        parent: parent ?? null,
        duration_days: milestone ? 0 : 5,
        is_milestone: milestone,
        seq: rows.length + 1,
      });
      reload();
    } catch (e: any) {
      toast(e?.message ?? t("prog.addFail"), "bad");
    } finally { setBusy(false); }
  }

  async function remove(node: TreeNode) {
    if (!canEdit) return;
    // Anything depending on it would otherwise be left pointing at a name that
    // no longer exists, which CPM would then report as a dangling link.
    const dependents = tree.filter((n) => n.links.some((l) => l.activity === node.name));
    if (dependents.length && !confirm(t("prog.confirmDeleteLinked", { n: dependents.length, name: node.name }))) return;
    setBusy(true);
    try {
      await api.post(`/projects/${pid}/artifacts/${node.a.id}/reject`, {});
      for (const d of dependents) {
        await api.patch(`/projects/${pid}/artifacts/${d.a.id}`, {
          payload: {
            ...d.a.payload,
            depends_on: (d.a.payload.depends_on ?? []).filter((l: any) => l.activity !== node.name),
            predecessors: (d.a.payload.predecessors ?? []).filter((p: string) => p !== node.name),
          },
        });
      }
      reload();
    } catch (e: any) {
      toast(e?.message ?? t("prog.deleteFail"), "bad");
    } finally { setBusy(false); }
  }

  /** Renaming has to carry the old name across every link that cites it, or the
   *  network silently breaks the moment somebody tidies up a title. */
  async function rename(node: TreeNode, name: string) {
    const from = node.name;
    if (!name.trim() || name === from) return;
    const citing = tree.filter(
      (n) => n.links.some((l) => l.activity === from) || String(n.a.payload?.parent ?? "") === from
    );
    setBusy(true);
    try {
      await api.patch(`/projects/${pid}/artifacts/${node.a.id}`, {
        payload: { ...node.a.payload, activity: name.trim() },
      });
      for (const n of citing) {
        if (n.a.id === node.a.id) continue;
        const p = n.a.payload;
        await api.patch(`/projects/${pid}/artifacts/${n.a.id}`, {
          payload: {
            ...p,
            ...(String(p.parent ?? "") === from ? { parent: name.trim() } : {}),
            depends_on: (p.depends_on ?? []).map((l: any) => (l.activity === from ? { ...l, activity: name.trim() } : l)),
            predecessors: (p.predecessors ?? []).map((s: string) => (s === from ? name.trim() : s)),
          },
        });
      }
      reload();
    } catch (e: any) {
      toast(e?.message ?? t("prog.saveFail"), "bad");
    } finally { setBusy(false); }
  }

  const cost = (n: TreeNode): number => {
    if (n.isSection) {
      return tree.filter((c) => String(c.a.payload?.parent ?? "") === n.name).reduce((s, c) => s + cost(c), 0);
    }
    return (n.a.payload?.boq_refs ?? []).reduce((s: number, r: string) => s + (costByCode.get(String(r).trim()) ?? 0), 0);
  };
  const money = (minor: number) =>
    minor > 0 ? new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 }).format(minor / 100) : "—";

  function exportCsv() {
    const head = ["WBS", "Activity", "Assignee", "Start", "Finish", "Duration", "% done", "Float", "Critical", "Predecessors", "Basis"];
    const lines = [head.join(",")];
    const q = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    for (const n of tree) {
      lines.push([
        q(n.a.payload?.wbs ?? ""), q("  ".repeat(n.depth) + n.name), q(nameFor(n.a.payload?.assignee, members)),
        q(fmtDay(n.es)), q(fmtDay(n.ef)), n.milestone ? 0 : n.dur, n.percent, n.float,
        n.critical ? "yes" : "no",
        q(n.links.map((l) => `${l.activity} (${l.type}${l.lag_days ? `${l.lag_days > 0 ? "+" : ""}${l.lag_days}` : ""})`).join("; ")),
        q(n.a.payload?.basis ?? ""),
      ].join(","));
    }
    const blob = new Blob([lines.join("\r\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "work-programme.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // Week/month ticks across the top.
  const ticks: number[] = [];
  const step = dayW < 4 ? 28 : dayW < 8 ? 14 : 7;
  for (let d = 0; d <= total + step; d += step) ticks.push(d);

  const rowIndex = new Map(visible.map((n, i) => [n.name, i]));

  return (
    <div className="card prog">
      <div className="chead">
        <div>
          <h3>{t("prog.title")}</h3>
          <div className="csub">{t("prog.sub")}</div>
        </div>
        <div className="prog-actions">
          <button className="mini sm" onClick={exportCsv}>{t("prog.export")}</button>
          {canEdit && <button className="mini sm" disabled={busy} onClick={() => add("section")}>{t("prog.addSection")}</button>}
        </div>
      </div>

      <div className="prog-bar">
        <label className="prog-field">
          <span>{t("prog.commencement")}</span>
          <input
            type="date"
            value={commencement ?? ""}
            disabled={!canEdit}
            onChange={(e) => onSettings(e.target.value || null)}
          />
        </label>
        <span className="prog-stat">
          {t("prog.summary", { activities: tree.filter((n) => !n.isSection).length, days: total, weeks: Math.ceil(total / 7) })}
        </span>
        <label className="tgl">
          <input type="checkbox" checked={onlyCritical} onChange={(e) => setOnlyCritical(e.target.checked)} />
          {t("prog.criticalOnly", { n: criticalPath.length })}
        </label>
        {members.length > 0 && (
          <select className="mini" value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label={t("prog.assignee")}>
            <option value="">{t("prog.allAssignees")}</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name || m.email}</option>)}
          </select>
        )}
        <span className="zoomctl2">
          <button onClick={() => setZoom((z) => Math.max(0.25, z / 1.5))} title={t("prog.zoomOut")}>−</button>
          <button onClick={() => setZoom((z) => Math.min(6, z * 1.5))} title={t("prog.zoomIn")}>+</button>
        </span>
      </div>

      {warnings.length > 0 && (
        <div className="synth" style={{ marginBottom: 10 }}><span>{warnings.join(" ")}</span></div>
      )}

      <div className="prog-wrap">
        {/* ── Grid ── */}
        <div className="prog-grid">
          <div className="prog-hrow">
            <div className="pc pc-act">{t("prog.colActivity")}</div>
            <div className="pc pc-who">{t("prog.colResources")}</div>
            <div className="pc pc-d">{t("prog.colStart")}</div>
            <div className="pc pc-d">{t("prog.colFinish")}</div>
            <div className="pc pc-n">{t("prog.colDur")}</div>
            <div className="pc pc-p">{t("prog.colDone")}</div>
            <div className="pc pc-c">{t("prog.colCost")}</div>
          </div>
          {visible.map((n) => (
            <div
              key={n.a.id}
              className={"prow" + (n.isSection ? " sec" : "") + (sel === n.a.id ? " on" : "")}
              style={{ height: ROW_H }}
              onClick={() => setSel(n.a.id)}
            >
              <div className="pc pc-act" style={{ paddingInlineStart: 8 + n.depth * 14 }}>
                {n.children.length > 0 ? (
                  <button
                    className="ptw"
                    onClick={(e) => {
                      e.stopPropagation();
                      setCollapsed((s) => { const x = new Set(s); x.has(n.name) ? x.delete(n.name) : x.add(n.name); return x; });
                    }}
                    aria-label={collapsed.has(n.name) ? t("prog.expand") : t("prog.collapse")}
                  >{collapsed.has(n.name) ? "▸" : "▾"}</button>
                ) : <span className="ptw-spacer" />}
                {n.milestone && <span className="pmi" />}
                <EditableText
                  value={n.name}
                  disabled={!canEdit || busy}
                  onSave={(v) => rename(n, v)}
                />
                {n.critical && !n.isSection && <span className="pcrit">{t("prog.critical")}</span>}
                {n.flagged && <span className="sd review" title={t("prog.pending")} />}
                {canEdit && (
                  <span className="prow-tools" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => setEditing(editing === n.a.id ? null : n.a.id)} title={t("prog.edit")}>✎</button>
                    <button onClick={() => add("activity", n.isSection ? n.name : String(n.a.payload?.parent ?? "") || undefined)} title={t("prog.addChild")}>+</button>
                    <button onClick={() => remove(n)} title={t("common.remove")}>🗑</button>
                  </span>
                )}
              </div>
              <div className="pc pc-who" onClick={(e) => e.stopPropagation()}>
                {!n.isSection && canEdit ? (
                  <select
                    className="passign"
                    value={String(n.a.payload?.assignee ?? "")}
                    onChange={(e) => patch(n, { assignee: e.target.value || undefined })}
                  >
                    <option value="">{t("prog.unassigned")}</option>
                    {members.map((m) => <option key={m.id} value={m.id}>{m.name || m.email}</option>)}
                  </select>
                ) : <span className="csub">{nameFor(n.a.payload?.assignee, members)}</span>}
              </div>
              <div className="pc pc-d mono">{fmtDay(n.es)}</div>
              <div className="pc pc-d mono">{n.milestone ? "—" : fmtDay(n.ef)}</div>
              <div className="pc pc-n mono">{n.milestone ? "◆" : `${n.dur}d`}</div>
              <div className="pc pc-p" onClick={(e) => e.stopPropagation()}>
                <Percent value={n.percent} disabled={!canEdit || n.isSection || busy} onSave={(v) => patch(n, { percent_complete: v })} />
              </div>
              <div className="pc pc-c mono">{money(cost(n))}</div>
            </div>
          ))}
        </div>

        {/* ── Timeline ── */}
        <div className="prog-track" ref={trackRef}>
          <div style={{ width: chartW, position: "relative" }}>
            <div className="prog-hrow prog-axis" style={{ width: chartW }}>
              {ticks.map((d) => (
                <span key={d} className="ptick" style={{ insetInlineStart: x(d) }}>
                  {commencement ? fmtDay(d) : `W${Math.round(d / 7)}`}
                </span>
              ))}
            </div>

            {/* Dependency arrows, drawn under the bars. */}
            <svg className="parrows" width={chartW} height={visible.length * ROW_H} aria-hidden>
              {visible.flatMap((n) =>
                n.links.map((l, i) => {
                  const pi = rowIndex.get(l.activity);
                  const ni = rowIndex.get(n.name);
                  if (pi == null || ni == null) return null;
                  const pred = visible[pi];
                  const fromX = x(l.type === "SS" || l.type === "SF" ? pred.es : pred.ef);
                  const toX = x(l.type === "FF" || l.type === "SF" ? n.ef : n.es);
                  const fromY = pi * ROW_H + ROW_H / 2;
                  const toY = ni * ROW_H + ROW_H / 2;
                  const mid = Math.max(fromX, toX - 10) + 6;
                  return (
                    <path
                      key={`${n.a.id}-${i}`}
                      className={"parrow" + (n.critical && pred.critical ? " crit" : "")}
                      d={`M ${fromX} ${fromY} H ${mid} V ${toY} H ${toX}`}
                      markerEnd="url(#pah)"
                    />
                  );
                })
              )}
              <defs>
                <marker id="pah" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6 z" className="pahfill" />
                </marker>
              </defs>
            </svg>

            {visible.map((n) => (
              <div key={n.a.id} className={"ptrow" + (sel === n.a.id ? " on" : "")} style={{ height: ROW_H }}>
                {ticks.map((d) => <div key={d} className="pgrid" style={{ insetInlineStart: x(d) }} />)}
                {n.milestone ? (
                  <span className={"pdiamond" + (n.critical ? " crit" : "")} style={{ insetInlineStart: x(n.es) }} title={`${n.name} · ${fmtDay(n.es)}`} />
                ) : n.isSection ? (
                  <span className="psec" style={{ insetInlineStart: x(n.es), width: Math.max(4, x(n.dur)) }} title={`${n.name} · ${n.dur}d`} />
                ) : (
                  <>
                    {n.float > 0 && (
                      <span className="pfloat" style={{ insetInlineStart: x(n.ef), width: Math.max(2, x(n.float)) }} title={t("prog.floatDays", { n: n.float })} />
                    )}
                    <button
                      className={"pbar" + (n.flagged ? " flag" : n.critical ? " crit" : "") + (sel === n.a.id ? " on" : "")}
                      style={{ insetInlineStart: x(n.es), width: Math.max(6, x(n.dur)) }}
                      onClick={() => setSel(n.a.id)}
                      title={`${n.name} · ${fmtDay(n.es)} → ${fmtDay(n.ef)} · ${n.dur}d`}
                    >
                      {n.percent > 0 && <span className="pbar-done" style={{ width: `${n.percent}%` }} />}
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {editing && (() => {
        const n = tree.find((x) => x.a.id === editing);
        return n ? (
          <ActivityEditor
            node={n}
            all={tree}
            commencement={commencement}
            busy={busy}
            onClose={() => setEditing(null)}
            onSave={(changes) => patch(n, changes).then(() => setEditing(null))}
          />
        ) : null;
      })()}
    </div>
  );
}

function nameFor(id: unknown, members: Member[]): string {
  const s = String(id ?? "");
  if (!s) return "—";
  const m = members.find((x) => x.id === s);
  return m ? m.name || m.email : s;
}

/* ── Click to rename ──────────────────────────────────────────────────────── */

function EditableText({ value, onSave, disabled }: { value: string; onSave: (v: string) => void; disabled?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  if (disabled || !editing) {
    return (
      <span className="pname" onClick={() => !disabled && setEditing(true)} title={value}>{value}</span>
    );
  }
  return (
    <input
      className="pname-in"
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { setEditing(false); onSave(draft); }}
      onKeyDown={(e) => {
        if (e.key === "Enter") { setEditing(false); onSave(draft); }
        if (e.key === "Escape") { setEditing(false); setDraft(value); }
      }}
    />
  );
}

/* ── Click to set progress ────────────────────────────────────────────────── */

function Percent({ value, onSave, disabled }: { value: number; onSave: (v: number) => void; disabled?: boolean }) {
  const [editing, setEditing] = useState(false);
  if (editing && !disabled) {
    return (
      <input
        className="ppct-in"
        type="number" min={0} max={100} autoFocus defaultValue={value}
        onBlur={(e) => { setEditing(false); onSave(Math.max(0, Math.min(100, Number(e.target.value) || 0))); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      />
    );
  }
  return (
    <span className="ppct" onClick={() => !disabled && setEditing(true)} title={`${value}%`}>
      <span className="ppct-track"><span className="ppct-fill" style={{ width: `${value}%` }} /></span>
      <b>{value}%</b>
    </span>
  );
}

/* ── The activity editor: dates, duration, milestone, typed links ─────────── */

function ActivityEditor({ node, all, commencement, busy, onClose, onSave }: {
  node: TreeNode;
  all: TreeNode[];
  commencement: string | null;
  busy: boolean;
  onClose: () => void;
  onSave: (changes: Record<string, unknown>) => void;
}) {
  const { t } = useI18n();
  const p = node.a.payload ?? {};
  const [dur, setDur] = useState(Number(p.duration_days ?? 0));
  const [start, setStart] = useState(Number(p.start_offset_days ?? node.es));
  const [milestone, setMilestone] = useState(p.is_milestone === true);
  const [basis, setBasis] = useState(String(p.basis ?? ""));
  const [links, setLinks] = useState<Array<{ activity: string; type: RelType; lag_days: number }>>(
    (p.depends_on ?? []).map((l: any) => ({ activity: l.activity, type: (l.type ?? "FS") as RelType, lag_days: Number(l.lag_days ?? 0) }))
  );

  // Only earlier activities may be predecessors — offering the full list is how
  // a planner creates a cycle by accident.
  const candidates = all.filter((n) => n.a.id !== node.a.id && !n.isSection && n.es <= node.es);

  return (
    <div className="pedit" role="dialog" aria-label={t("prog.edit")}>
      <div className="pedit-head">
        <b>{node.name}</b>
        <button className="mini sm" onClick={onClose}>{t("common.close")}</button>
      </div>

      <div className="pedit-grid">
        <label>
          <span>{t("prog.colDur")}</span>
          <input type="number" min={0} value={dur} disabled={milestone} onChange={(e) => setDur(Number(e.target.value) || 0)} />
        </label>
        <label>
          <span>{t("prog.startOffset")}</span>
          <input type="number" min={0} value={start} onChange={(e) => setStart(Number(e.target.value) || 0)} />
          {commencement && <small className="csub">{new Date(Date.parse(commencement + "T00:00:00Z") + start * MS_DAY).toDateString()}</small>}
        </label>
        <label className="tgl">
          <input type="checkbox" checked={milestone} onChange={(e) => setMilestone(e.target.checked)} />
          {t("prog.isMilestone")}
        </label>
      </div>

      <div className="pedit-links">
        <div className="pedit-lh">
          <span>{t("prog.predecessors")}</span>
          <button className="mini sm" onClick={() => setLinks((l) => [...l, { activity: candidates[0]?.name ?? "", type: "FS", lag_days: 0 }])}>
            {t("prog.addLink")}
          </button>
        </div>
        {links.length === 0 && <div className="csub">{t("prog.noLinks")}</div>}
        {links.map((l, i) => (
          <div className="pedit-link" key={i}>
            <select value={l.activity} onChange={(e) => setLinks((s) => s.map((x, j) => (j === i ? { ...x, activity: e.target.value } : x)))}>
              {candidates.map((c) => <option key={c.a.id} value={c.name}>{c.name}</option>)}
            </select>
            <select value={l.type} onChange={(e) => setLinks((s) => s.map((x, j) => (j === i ? { ...x, type: e.target.value as RelType } : x)))}>
              {REL_TYPES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <input
              type="number" value={l.lag_days} title={t("prog.lag")}
              onChange={(e) => setLinks((s) => s.map((x, j) => (j === i ? { ...x, lag_days: Number(e.target.value) || 0 } : x)))}
            />
            <button className="mini sm" onClick={() => setLinks((s) => s.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
      </div>

      <label className="pedit-basis">
        <span>{t("prog.basis")}</span>
        <textarea rows={2} value={basis} onChange={(e) => setBasis(e.target.value)} placeholder={t("prog.basisHint")} />
      </label>

      <div className="pedit-foot">
        <button
          className="mini pri"
          disabled={busy}
          onClick={() =>
            onSave({
              duration_days: milestone ? 0 : dur,
              start_offset_days: start,
              is_milestone: milestone,
              basis: basis.trim() || undefined,
              depends_on: links.filter((l) => l.activity),
              predecessors: links.filter((l) => l.activity).map((l) => l.activity),
            })
          }
        >
          {t("common.save")}
        </button>
      </div>
    </div>
  );
}
