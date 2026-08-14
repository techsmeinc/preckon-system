"use client";
/**
 * Authoring mode — build your own tool out of the built-in ones.
 *
 * The ArchiLabs recordings show PERSONAL tools sitting beside the global
 * catalogue ("Room Renaming", "tool test"), which means the product is partly a
 * tool-BUILDING environment and not only a tool-using one. This is that.
 *
 * A tool is DATA: a list of steps naming built-in tools, with {{...}} templates
 * substituted as plain values. There is no expression to evaluate, so nothing
 * here can run user code — see db/migrations/017 for why that property is worth
 * defending.
 *
 * The arguments are a JSON box rather than a generated form. A form would have to
 * guess at selectors, nested params and template references, and would end up
 * either lying about what is possible or being a worse JSON editor. What it does
 * instead is show the exact parameters of the chosen tool next to the box, so the
 * shape is in front of you while you type it.
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/apiclient";
import { useApi, useToast, Skeleton, ErrorBox } from "@/lib/ui";
import { useI18n } from "@/lib/i18n";

interface CatalogTool {
  name: string;
  label: string;
  module: string;
  scope: string;
  kind: string;
  description: string;
  params: { name: string; type: string; description: string; required?: boolean; default?: unknown }[];
}

interface Step {
  tool: string;
  args: Record<string, unknown>;
  as?: string;
}

interface Authored {
  id: string;
  name: string;
  label: string;
  module: string;
  description: string;
  steps: Step[];
  updatedAt: string;
}

interface Loaded {
  tools: CatalogTool[];
  modules: string[];
  authored: Authored[];
  skipped: { name: string; reason: string }[];
}

const BLANK = { name: "", label: "", description: "", steps: [] as Step[] };

export function AuthoringPanel({ pid, onSaved }: { pid: string; onSaved?: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const { data, loading, error, reload } = useApi<Loaded>(`/projects/${pid}/bim/tools`);

  const [draft, setDraft] = useState(BLANK);
  /* One JSON string per step, kept beside the parsed steps. Parsing on every
     keystroke would fight the user halfway through typing `{"selector":` — so
     the text is what they typed and the parse happens when it can. */
  const [argText, setArgText] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const builtins = (data?.tools ?? []).filter((x) => x.scope === "global");

  useEffect(() => {
    setArgText(draft.steps.map((s) => JSON.stringify(s.args ?? {}, null, 2)));
    // Only when the step count changes — re-serialising on every keystroke would
    // overwrite what is being typed.
  }, [draft.steps.length]);

  function addStep() {
    setDraft((d) => ({ ...d, steps: [...d.steps, { tool: builtins[0]?.name ?? "", args: {} }] }));
  }

  function removeStep(i: number) {
    setDraft((d) => ({ ...d, steps: d.steps.filter((_, j) => j !== i) }));
    setArgText((a) => a.filter((_, j) => j !== i));
  }

  function setStep(i: number, patch: Partial<Step>) {
    setDraft((d) => ({ ...d, steps: d.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  }

  function edit(a: Authored) {
    setEditingId(a.id);
    setDraft({ name: a.name, label: a.label, description: a.description, steps: a.steps ?? [] });
    setArgText((a.steps ?? []).map((s) => JSON.stringify(s.args ?? {}, null, 2)));
  }

  function cancel() {
    setEditingId(null);
    setDraft(BLANK);
    setArgText([]);
  }

  async function save() {
    // Parse here rather than on every keystroke, and name the step that is wrong
    // — "unexpected token" with no location is not a fixable complaint.
    const steps: Step[] = [];
    for (let i = 0; i < draft.steps.length; i++) {
      try {
        steps.push({ ...draft.steps[i], args: JSON.parse(argText[i] || "{}") });
      } catch {
        toast(t("auth.badJson", { n: i + 1 }), "bad");
        return;
      }
    }

    setSaving(true);
    try {
      await api.post(`/projects/${pid}/bim/tools`, {
        name: draft.name.trim(),
        label: draft.label.trim(),
        description: draft.description.trim(),
        module: "My Tools",
        steps,
        params: [],
      });
      toast(t("auth.saved"));
      cancel();
      reload();
      onSaved?.();
    } catch (e: any) {
      // The server validates with the same function the runtime uses, so its
      // complaint is the accurate one — show it rather than a generic failure.
      toast(e?.message ?? t("auth.saveFail"), "bad");
    } finally {
      setSaving(false);
    }
  }

  async function remove(a: Authored) {
    if (!window.confirm(t("auth.deleteConfirm", { name: a.label || a.name }))) return;
    try {
      await api.del(`/projects/${pid}/bim/tools?id=${encodeURIComponent(a.id)}`);
      toast(t("auth.deleted"));
      if (editingId === a.id) cancel();
      reload();
    } catch (e: any) {
      toast(e?.message ?? t("auth.saveFail"), "bad");
    }
  }

  if (loading) return <Skeleton rows={4} />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;

  return (
    <div className="bim-authoring">
      {/* Tools that no longer compile. Shown rather than silently missing — the
          author needs to know why the assistant stopped finding one. */}
      {!!data?.skipped?.length && (
        <div className="auth-broken">
          <b>{t("auth.broken")}</b>
          <ul>{data.skipped.map((s) => <li key={s.name}><code>{s.name}</code> — {s.reason}</li>)}</ul>
        </div>
      )}

      <div className="auth-mine">
        <div className="auth-head">
          <b>{t("auth.mine")}</b>
          <span className="csub">{t("auth.mineSub", { n: data?.authored?.length ?? 0 })}</span>
        </div>
        {data?.authored?.length ? (
          <ul className="auth-list">
            {data.authored.map((a) => (
              <li key={a.id} className={editingId === a.id ? "is-editing" : ""}>
                <div>
                  <b>{a.label}</b> <code>{a.name}</code>
                  <div className="csub">{a.description}</div>
                  <div className="csub">{t("auth.stepCount", { n: a.steps?.length ?? 0 })}</div>
                </div>
                <div className="auth-row-acts">
                  <button className="mini sm" onClick={() => edit(a)}>{t("common.edit")}</button>
                  <button className="mini sm" onClick={() => remove(a)}>{t("common.remove")}</button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="csub">{t("auth.none")}</p>
        )}
      </div>

      <div className="auth-form">
        <div className="auth-head">
          <b>{editingId ? t("auth.editing", { name: draft.label || draft.name }) : t("auth.newTool")}</b>
        </div>

        <div className="auth-fields">
          <label>
            <span>{t("auth.name")}</span>
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="tag_untagged_rooms"
              disabled={!!editingId}
            />
            <span className="csub">{t("auth.nameHint")}</span>
          </label>
          <label>
            <span>{t("auth.label")}</span>
            <input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="Tag Untagged Rooms" />
          </label>
        </div>

        <label className="auth-wide">
          <span>{t("auth.description")}</span>
          <input
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            placeholder={t("auth.descriptionPlaceholder")}
          />
          {/* Not decoration: the registry searches on this, so a vague one is a
              tool the assistant never finds. */}
          <span className="csub">{t("auth.descriptionHint")}</span>
        </label>

        <div className="auth-steps">
          {draft.steps.map((s, i) => {
            const spec = builtins.find((b) => b.name === s.tool);
            return (
              <div className="auth-step" key={i}>
                <div className="auth-step-head">
                  <span className="auth-n">{i + 1}</span>
                  <select value={s.tool} onChange={(e) => setStep(i, { tool: e.target.value })}>
                    {builtins.map((b) => (
                      <option key={b.name} value={b.name}>{b.label} — {b.module}</option>
                    ))}
                  </select>
                  <input
                    className="auth-as"
                    value={s.as ?? ""}
                    onChange={(e) => setStep(i, { as: e.target.value || undefined })}
                    placeholder={t("auth.asPlaceholder")}
                  />
                  <button className="mini sm" onClick={() => removeStep(i)}>{t("common.remove")}</button>
                </div>

                {/* The chosen tool's parameters, next to the box you type them
                    into. Without this the JSON is guesswork. */}
                {spec && (
                  <div className="auth-spec csub">
                    {spec.params.length
                      ? spec.params.map((p) => (
                          <span key={p.name} className="auth-param">
                            <code>{p.name}</code>:{p.type}{p.required ? "*" : ""}
                          </span>
                        ))
                      : t("auth.noParams")}
                  </div>
                )}

                <textarea
                  rows={4}
                  className="mono"
                  value={argText[i] ?? "{}"}
                  onChange={(e) => setArgText((a) => a.map((x, j) => (j === i ? e.target.value : x)))}
                  spellCheck={false}
                />
              </div>
            );
          })}

          <button className="mini sm" onClick={addStep} disabled={!builtins.length}>{t("auth.addStep")}</button>
          <p className="csub auth-tmpl">{t("auth.templateHint")}</p>
        </div>

        <div className="auth-acts">
          <button
            className="mini sm pri"
            onClick={save}
            disabled={saving || !draft.name.trim() || !draft.label.trim() || !draft.description.trim() || !draft.steps.length}
          >
            {saving ? t("common.saving") : t("common.save")}
          </button>
          {editingId && <button className="mini sm" onClick={cancel}>{t("common.cancel")}</button>}
        </div>
      </div>
    </div>
  );
}
