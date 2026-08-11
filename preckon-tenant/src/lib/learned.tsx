"use client";
// What this workspace has learned, on a screen.
//
// The agents change what they propose because of these rows, so the rows have
// to be readable and switchable. That is the argument for learning this way
// rather than by training a model: an estimator who disagrees with a learned
// rate can see it, see how many times it has been applied, and retire it. Once
// a preference is inside a set of weights, none of that is possible — you
// cannot show it to a client, and you cannot take it back.

import { useState } from "react";
import { api } from "@/lib/apiclient";
import { useApi, useCan, useToast, Skeleton } from "@/lib/ui";

interface Lesson {
  id: string;
  type_key: string;
  subject: string;
  field: string;
  was_value: string | null;
  now_value: string;
  times_seen: number;
  status: "active" | "retired";
  learned_on: string | null;
  updated_at: string;
}

const shortType = (t: string) => (t ?? "").split(".").pop()?.replace(/_/g, " ") ?? t;

export function LearnedLessons() {
  const { data, loading, reload } = useApi<Lesson[]>("/learning", []);
  const canManage = useCan("library.manage");
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function setStatus(l: Lesson, status: "active" | "retired") {
    setBusy(l.id);
    try {
      await api.patch("/learning", { id: l.id, status });
      reload();
    } catch (e: any) {
      toast(e?.message ?? "Could not change that", "bad");
    } finally { setBusy(null); }
  }

  if (loading) return <Skeleton rows={3} />;
  const rows = data ?? [];

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="chead">
        <div>
          <h2>Learned from your corrections</h2>
          <div className="csub">
            When somebody edits a proposal, the change is remembered and offered on the next
            project. Nothing is trained — these are rows you can read and switch off.
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="csub" style={{ margin: 0 }}>
          Nothing yet. Correct a rate or a unit on a proposal and it will appear here, ready for
          the next project that uses the same code.
        </p>
      ) : (
        <div className="tw">
          <table className="tbl">
            <thead>
              <tr>
                <th>Subject</th>
                <th>What changed</th>
                <th className="num">Times</th>
                <th>Learned on</th>
                <th><span className="vh">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} className={l.status === "retired" ? "warn" : ""}>
                  <td>
                    <b className="mono">{l.subject}</b>
                    <div className="csub">{shortType(l.type_key)}</div>
                  </td>
                  <td>
                    {l.field}
                    {l.was_value ? (
                      <>
                        {" "}<span className="csub">{l.was_value}</span>
                        {" → "}<b className="mono">{l.now_value}</b>
                      </>
                    ) : (
                      <> <b className="mono">{l.now_value}</b></>
                    )}
                  </td>
                  {/* The number that decides whether this is a house rule or a
                      one-off, so it is a column rather than a footnote. */}
                  <td className="num mono">{l.times_seen}</td>
                  <td className="csub">{l.learned_on ?? "—"}</td>
                  <td className="num">
                    {canManage && (
                      <button
                        className="mini sm"
                        disabled={busy === l.id}
                        onClick={() => setStatus(l, l.status === "active" ? "retired" : "active")}
                      >
                        {l.status === "active" ? "Retire" : "Restore"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
