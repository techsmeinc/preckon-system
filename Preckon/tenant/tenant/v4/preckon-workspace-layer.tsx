/**
 * Preckon tenant-app — workspace layer  (canonical §D rendering)
 * ---------------------------------------------------------------------------
 * Replaces the retired preckon-manifest-layer.tsx. It reads the REAL Core
 * endpoints — /entitlements (§8), /workflows (§4.6), /personas (§6.4.5),
 * /lifecycle (§1.6) — and composes them. There is no /workspace/manifest and
 * no pack_* tables in the canonical model; a "module" is a Host-catalog
 * capability (module_key) gated by entitlements. See preckon-frontend-integration.md.
 *
 * The shell hardcodes no domain: module labels/icons come from the Host catalog
 * (via /entitlements), personas/state/workflows all arrive as data.
 *
 * Repo layout (split on integration):
 *   lib/workspace/types.ts · client.ts · provider.tsx · lifecycle.ts · icons.ts
 *   components/shell/ModuleNav.tsx · PersonaBar.tsx · LifecycleBanner.tsx
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  FileSearch, Ruler, FileText, Calculator, DollarSign, CalendarClock,
  ShoppingCart, Bot, HelpCircle, type LucideIcon,
} from "lucide-react";

/* ─────────────────────────── lib/workspace/types.ts ───────────────────────
 * Mirrors the canonical endpoint payloads. Module display (label/icon/order)
 * is HOST-catalog data surfaced via /entitlements — not a tenant-plane table.
 * ---------------------------------------------------------------------------*/

/** One licensed module from GET /entitlements (§8) — display from the Host catalog. */
export interface EntitledModule {
  key: string; // module_key, e.g. "tenderlogix"
  label: string; // "TenderLogix" — Host catalog
  icon: string; // icon token — Host catalog
  order: number;
}

export interface Entitlements {
  licensedModules: EntitledModule[];
  permissions: string[]; // permission keys the user holds
}

/** GET /workflows (§4.6) — enabled under the tenant's edition. */
export interface WorkflowSummary {
  key: string; // "workflow.bidassembly"
  name: string; // "BidAssembly"
  moduleKey: string; // "tenderlogix"
  entitlementKey?: string | null;
}

/** GET /personas (§6.4.5) — already entitlement-filtered. */
export interface Persona {
  key: string; // supervisor agent key
  label: string; // "Construction Copilot"
  isDefault: boolean;
  scope?: { moduleKeys?: string[] };
  deviations?: string[];
}

/** GET /projects/{pid}/lifecycle (§1.6). */
export interface LifecycleTransition {
  to: string; // next state
  triggerType: string; // the gating artifact type to confirm
  requiredPermission: string;
}
export interface LifecycleState {
  lifecycleKey: string | null; // e.g. "bid_pursuit"; null = no lifecycle
  state: string; // opaque current state, e.g. "qualifying"
  transitions: LifecycleTransition[]; // available to this user (server-filtered)
}

/** Composed view: a licensed module with the workflows a user may start in it. */
export interface Module extends EntitledModule {
  workflows: WorkflowSummary[];
}

/* ─────────────────────────── lib/workspace/client.ts ──────────────────────*/

export class ApiError extends Error {
  constructor(public readonly status: number, path: string) {
    super(`${path} failed (${status})`);
    this.name = "ApiError";
  }
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { accept: "application/json" },
    signal,
  });
  if (!res.ok) throw new ApiError(res.status, path);
  return (await res.json()) as T;
}

export const api = {
  entitlements: (s?: AbortSignal) => get<Entitlements>("/v1/entitlements", s),
  workflows: (s?: AbortSignal) => get<WorkflowSummary[]>("/v1/workflows", s),
  personas: (s?: AbortSignal) => get<Persona[]>("/v1/personas", s),
  lifecycle: (pid: string, s?: AbortSignal) =>
    get<LifecycleState>(`/v1/projects/${pid}/lifecycle`, s),
};

/* ─────────────────────────── lib/workspace/provider.tsx ───────────────────
 * Fetch the three tenant-wide reads once, compose modules (licensed ∩ their
 * workflows). A per-project lifecycle is a separate hook (§ lifecycle.ts).
 * ---------------------------------------------------------------------------*/

interface WorkspaceState {
  modules: Module[];
  personas: Persona[];
  permissionSet: ReadonlySet<string>;
  loading: boolean;
  error: Error | null;
}

const Ctx = createContext<WorkspaceState | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [ent, setEnt] = useState<Entitlements | null>(null);
  const [wfs, setWfs] = useState<WorkflowSummary[] | null>(null);
  const [personas, setPersonas] = useState<Persona[] | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    Promise.all([
      api.entitlements(ac.signal),
      api.workflows(ac.signal),
      api.personas(ac.signal),
    ])
      .then(([e, w, p]) => {
        setEnt(e);
        setWfs(w);
        setPersonas(p);
      })
      .catch((err: unknown) => {
        if (!ac.signal.aborted)
          setError(err instanceof Error ? err : new Error(String(err)));
      });
    return () => ac.abort();
  }, []);

  const modules = useMemo<Module[]>(() => {
    if (!ent || !wfs) return [];
    const byModule = new Map<string, WorkflowSummary[]>();
    for (const w of wfs) {
      const arr = byModule.get(w.moduleKey) ?? [];
      arr.push(w);
      byModule.set(w.moduleKey, arr);
    }
    return [...ent.licensedModules]
      .sort((a, b) => a.order - b.order)
      .map((m) => ({ ...m, workflows: byModule.get(m.key) ?? [] }));
  }, [ent, wfs]);

  const value = useMemo<WorkspaceState>(
    () => ({
      modules,
      personas: personas ?? [],
      permissionSet: new Set(ent?.permissions ?? []),
      loading: !error && (!ent || !wfs || !personas),
      error,
    }),
    [modules, personas, ent, wfs, error],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function useWorkspaceState(): WorkspaceState {
  const c = useContext(Ctx);
  if (!c) throw new Error("useWorkspace must be used within <WorkspaceProvider>");
  return c;
}
export function useWorkspace(): WorkspaceState {
  return useWorkspaceState();
}
export function useHasPermission(key: string): boolean {
  return useWorkspaceState().permissionSet.has(key);
}

/* ─────────────────────────── lib/workspace/lifecycle.ts ───────────────────*/

export function useLifecycle(projectId: string): {
  lifecycle: LifecycleState | null;
  loading: boolean;
  error: Error | null;
  reload: () => void;
} {
  const [lifecycle, setLifecycle] = useState<LifecycleState | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const ac = new AbortController();
    setError(null);
    api
      .lifecycle(projectId, ac.signal)
      .then(setLifecycle)
      .catch((e: unknown) => {
        if (!ac.signal.aborted)
          setError(e instanceof Error ? e : new Error(String(e)));
      });
    return () => ac.abort();
  }, [projectId, nonce]);

  return {
    lifecycle,
    loading: !lifecycle && !error,
    error,
    reload: () => setNonce((n) => n + 1),
  };
}

/* ─────────────────────────── lib/workspace/icons.ts ───────────────────────*/

const ICONS: Record<string, LucideIcon> = {
  "file-search": FileSearch, ruler: Ruler, "file-text": FileText,
  calculator: Calculator, "dollar-sign": DollarSign, "calendar-clock": CalendarClock,
  "shopping-cart": ShoppingCart, bot: Bot,
};
export const iconFor = (token: string): LucideIcon => ICONS[token] ?? HelpCircle;

/* ─────────────────────────── components/shell/ModuleNav.tsx ───────────────
 * Renders the licensed modules (Host-catalog order) and, per module, the
 * workflows a user may start. No module is named in code.
 * ---------------------------------------------------------------------------*/

export interface ModuleNavProps {
  activeModuleKey: string | null;
  onSelectModule: (moduleKey: string) => void;
  onStartWorkflow: (workflowKey: string) => void;
}

export function ModuleNav({ activeModuleKey, onSelectModule, onStartWorkflow }: ModuleNavProps) {
  const { modules, loading } = useWorkspace();
  const hasRun = useHasPermission("workflow.run");
  if (loading) return <nav aria-busy aria-label="Modules" />;

  return (
    <nav aria-label="Modules">
      {modules.map((m) => {
        const Icon = iconFor(m.icon);
        const active = m.key === activeModuleKey;
        return (
          <div key={m.key} data-active={active}>
            <button type="button" onClick={() => onSelectModule(m.key)} aria-current={active ? "page" : undefined}>
              <Icon aria-hidden />
              <span>{m.label}</span>
            </button>
            {active && m.workflows.length > 0 && (
              <ul>
                {m.workflows.map((w) => (
                  <li key={w.key}>
                    <button type="button" disabled={!hasRun} onClick={() => onStartWorkflow(w.key)}>
                      {w.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}

/* ─────────────────────────── components/shell/PersonaBar.tsx ──────────────*/

export interface PersonaBarProps {
  onOpen: (personaKey: string) => void;
}
export function PersonaBar({ onOpen }: PersonaBarProps) {
  const { personas } = useWorkspace();
  if (personas.length === 0) return null;
  return (
    <div aria-label="Colleagues">
      {[...personas]
        .sort((a, b) => Number(b.isDefault) - Number(a.isDefault))
        .map((p) => (
          <button key={p.key} type="button" onClick={() => onOpen(p.key)}>
            <Bot aria-hidden />
            <span>{p.label}</span>
          </button>
        ))}
    </div>
  );
}

/* ─────────────────────────── components/shell/LifecycleBanner.tsx ─────────
 * On a project with a lifecycle (e.g. a bid pursuit), shows the current state
 * and the next transition(s) the user may act on. The shell never sets state —
 * it routes the user to confirm the gating artifact (§1.6, §2).
 * ---------------------------------------------------------------------------*/

export interface LifecycleBannerProps {
  projectId: string;
  onReviewTrigger: (triggerType: string) => void;
}

export function LifecycleBanner({ projectId, onReviewTrigger }: LifecycleBannerProps) {
  const { lifecycle } = useLifecycle(projectId);
  const { permissionSet } = useWorkspaceState();
  if (!lifecycle || lifecycle.lifecycleKey == null) return null;

  return (
    <section aria-label="Pursuit status">
      <span data-state={lifecycle.state}>{lifecycle.state}</span>
      {lifecycle.transitions.map((t) => {
        const allowed = permissionSet.has(t.requiredPermission);
        return (
          <button
            key={`${t.to}:${t.triggerType}`}
            type="button"
            disabled={!allowed}
            title={allowed ? undefined : `requires ${t.requiredPermission}`}
            onClick={() => onReviewTrigger(t.triggerType)}
          >
            {`Review ${t.triggerType} → ${t.to}`}
          </button>
        );
      })}
    </section>
  );
}
