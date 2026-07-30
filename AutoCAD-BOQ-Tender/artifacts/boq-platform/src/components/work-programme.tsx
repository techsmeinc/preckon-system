import { useState, useMemo, useEffect, useRef, useLayoutEffect, type ReactNode, type MouseEvent as ReactMouseEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useModelPreference } from "@/hooks/use-model-preference";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  CalendarClock, Loader2, FileSpreadsheet, Diamond, Plus, Trash2, Pencil,
  CornerDownRight, ZoomIn, ZoomOut, Link2, Users, UserPlus, Filter, X, Check,
  ChevronRight, ChevronDown,
} from "lucide-react";
import {
  computeCpm, parseDependencies, serializeDependencies, relLabel,
  type Dependency, type RelType, type CpmResult,
} from "@workspace/db/schedule-cpm";
import {
  placeWork, workingByOffset, defaultCalendar, leaveDateSet, assignmentCost,
  offsetToIso, CALENDAR_PRESETS, type WorkCalendar,
} from "@workspace/db/calendar-engine";
import { CalendarDays, Zap, Coins, AlertTriangle } from "lucide-react";

const REL_TYPES: RelType[] = ["FS", "SS", "FF", "SF"];
const REL_LABELS: Record<RelType, string> = {
  FS: "Finish → Start",
  SS: "Start → Start",
  FF: "Finish → Finish",
  SF: "Start → Finish",
};

interface ScheduleActivity {
  id: number;
  projectId: number;
  seq: number;
  phase: string | null;
  sowRef: string | null;
  activity: string;
  parentId: number | null;
  durationDays: number;
  startOffsetDays: number;
  predecessor: string | null;
  predecessorIds: string | null;
  dependencies: string | null;
  isMilestone: number;
  /** Assigned resource id (P6-style), or null when unassigned. */
  resourceId: number | null;
  /** Progress 0–100. */
  percentComplete: number;
  notes: string | null;
}

interface ProjectResource {
  id: number;
  projectId: number;
  name: string;
  role: string | null;
  color: string | null;
  // ── P6 attributes ──
  kind?: string;            // 'labour' | 'equipment' | 'material'
  rateBasis?: string;       // 'hourly' | 'daily'
  rate?: string | null;     // decimal string
  currency?: string | null;
  powerKw?: string | null;  // decimal string (kW)
  capacity?: number;
  status?: string;          // 'active' | 'inactive'
  calendarId?: number | null;
  createdAt?: string;
}

interface ProjectCalendarRow {
  id: number;
  projectId: number;
  name: string;
  isDefault: number;
  weekendDays: string | null; // JSON array
  hoursPerDay: string;        // decimal string
  holidays: string | null;    // JSON array
  preset: string | null;
}

interface ResourceLeaveRow {
  id: number;
  projectId: number;
  resourceId: number;
  type: string;
  fromDate: string;
  toDate: string;
  note: string | null;
}

interface ActivityResourceRow {
  id: number;
  projectId: number;
  activityId: number;
  resourceId: number;
  allocationPct: number;
  unitsPerDay: string;  // decimal string
  isDriving: number;
}

// Parse a stored calendar row into the engine's WorkCalendar shape.
function parseCalendar(row: ProjectCalendarRow | undefined): WorkCalendar {
  if (!row) return defaultCalendar();
  let weekendDays: number[] = [5, 6];
  let holidays: WorkCalendar["holidays"] = [];
  try { const w = JSON.parse(row.weekendDays || "[]"); if (Array.isArray(w)) weekendDays = w; } catch { /* keep default */ }
  try { const h = JSON.parse(row.holidays || "[]"); if (Array.isArray(h)) holidays = h; } catch { /* keep default */ }
  const hoursPerDay = Number(row.hoursPerDay) || 8;
  return { weekendDays, hoursPerDay, holidays };
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// Format a money number with the project currency (3dp suits KWD; trims to 2 for others).
function fmtMoney(n: number, currency?: string | null): string {
  if (!Number.isFinite(n) || n === 0) return "—";
  const cur = currency || "KWD";
  const dp = cur === "KWD" || cur === "BHD" || cur === "OMR" ? 3 : 2;
  return `${cur} ${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: dp })}`;
}

// Initials for a resource avatar chip, e.g. "Ahmed Khan" → "AK".
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
// Readable text colour (black/white) over a given hex background.
function contrastText(hex?: string | null): string {
  if (!hex) return "#fff";
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? "#1a1a1a" : "#fff";
}

// ── Geometry constants for the timeline ──────────────────────────────────────
const ROW_H = 36;       // px height of every row (label + bar must match)
const HEADER_H = 52;    // px height of the date/week header (month band + week row)
const MS_DAY = 86_400_000;

// ── Left-panel columns (P6/MS-Project-style grid; widths are drag-resizable) ──
// The Activity column holds the name + tree twisties + row actions; the rest are
// data columns. Every column's width lives in state so a divider on each header
// can widen/narrow it (and, summed, the whole frozen panel).
const COL_KEYS = ["activity", "assignee", "start", "finish", "dur", "pct", "cost"] as const;
type ColKey = (typeof COL_KEYS)[number];
const COL_LABELS: Record<ColKey, string> = { activity: "Activity", assignee: "Resources", start: "Start", finish: "Finish", dur: "Dur", pct: "% Done", cost: "Cost" };
const COL_MIN: Record<ColKey, number> = { activity: 150, assignee: 80, start: 60, finish: 60, dur: 46, pct: 84, cost: 80 };
const COL_DEFAULT: Record<ColKey, number> = { activity: 240, assignee: 128, start: 92, finish: 92, dur: 58, pct: 112, cost: 104 };

// Per-section accent palette — each Section gets its own colour so a bar's phase
// is readable at a glance even when the name column is scrolled away. The
// critical path always overrides these with red.
const PHASE_COLORS = [
  "#2563eb", "#7c3aed", "#0891b2", "#0d9488", "#d97706",
  "#db2777", "#16a34a", "#4f46e5", "#0284c7", "#ca8a04",
];

// ── Date helpers (commencement date is an ISO "YYYY-MM-DD" string) ───────────
function offsetToDate(iso: string, offset: number): Date {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + offset);
  return d;
}
function toInputDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function dateToOffset(iso: string, target: string): number {
  const a = new Date(`${iso}T00:00:00`).getTime();
  const b = new Date(`${target}T00:00:00`).getTime();
  return Math.max(0, Math.round((b - a) / MS_DAY));
}
function fmtDate(iso: string | null, offset: number): string | null {
  if (!iso) return null;
  return offsetToDate(iso, offset).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "2-digit" });
}

/**
 * Editable Work-Programme Gantt for a single project: Section -> Activity ->
 * Sub-activity hierarchy, real calendar dates (from a commencement date),
 * predecessor dependency arrows, and full add/edit/delete. Shared by the
 * standalone /schedule page and the in-project "Work Programme" tab.
 */
export function WorkProgramme({ projectId }: { projectId: number }) {
  const { pref, providerConfig } = useModelPreference();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);
  // Timeline horizontal scale. By default the chart auto-fits the available
  // width so it always fills the screen (responsive). Zoom is a multiplier on top
  // of that fit width — 1 = fit (the minimum), so zooming out simply returns to
  // a full-width fit and no separate "Fit" control is needed.
  const [zoom, setZoom] = useState(1);
  const [viewportW, setViewportW] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Activity the user is hovering — used to spotlight its dependency links and
  // the activities directly connected to it.
  const [hoverId, setHoverId] = useState<number | null>(null);
  // Per-row measured heights so the timeline bars stay aligned when rows wrap.
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [measuredHeights, setMeasuredHeights] = useState<number[]>([]);

  const scheduleKey = ["schedule", projectId] as const;
  const { data: activities, isLoading } = useQuery<ScheduleActivity[]>({
    queryKey: scheduleKey,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/schedule`);
      if (!res.ok) throw new Error("Failed to load schedule");
      return res.json();
    },
  });

  const commKey = ["commencement", projectId] as const;
  const { data: comm } = useQuery<{ commencementDate: string | null }>({
    queryKey: commKey,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/commencement`);
      if (!res.ok) return { commencementDate: null };
      return res.json();
    },
  });
  const commencementDate = comm?.commencementDate ?? null;

  // ── Resources / Team (P6-style assignees) ───────────────────────────────────
  const resKey = ["resources", projectId] as const;
  const { data: resources } = useQuery<ProjectResource[]>({
    queryKey: resKey,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/resources`);
      if (!res.ok) return [];
      return res.json();
    },
  });
  const resourceById = useMemo(() => new Map((resources ?? []).map(r => [r.id, r] as const)), [resources]);

  // ── Work calendar (weekends/holidays), leave, and multi-resource assignments ─
  const calKey = ["calendars", projectId] as const;
  const { data: calendars } = useQuery<ProjectCalendarRow[]>({
    queryKey: calKey,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/calendars`);
      if (!res.ok) return [];
      return res.json();
    },
  });
  const defaultCalRow = useMemo(() => (calendars ?? []).find(c => c.isDefault === 1) ?? (calendars ?? [])[0], [calendars]);
  const workCalendar = useMemo(() => parseCalendar(defaultCalRow), [defaultCalRow]);

  const leaveKey = ["leave", projectId] as const;
  const { data: leaveRows } = useQuery<ResourceLeaveRow[]>({
    queryKey: leaveKey,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/leave`);
      if (!res.ok) return [];
      return res.json();
    },
  });
  // resourceId → Set of ISO leave dates (for conflict checks + auto-extend).
  const leaveByResource = useMemo(() => {
    const m = new Map<number, Set<string>>();
    for (const r of leaveRows ?? []) {
      const cur = m.get(r.resourceId) ?? new Set<string>();
      for (const d of leaveDateSet([{ fromDate: r.fromDate, toDate: r.toDate }])) cur.add(d);
      m.set(r.resourceId, cur);
    }
    return m;
  }, [leaveRows]);
  const leaveListByResource = useMemo(() => {
    const m = new Map<number, ResourceLeaveRow[]>();
    for (const r of leaveRows ?? []) { const a = m.get(r.resourceId) ?? []; a.push(r); m.set(r.resourceId, a); }
    return m;
  }, [leaveRows]);

  const assignKey = ["assignments", projectId] as const;
  const { data: assignments } = useQuery<ActivityResourceRow[]>({
    queryKey: assignKey,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/schedule/assignments`);
      if (!res.ok) return [];
      return res.json();
    },
  });
  // activityId → its assignments (driving first).
  const assignmentsByActivity = useMemo(() => {
    const m = new Map<number, ActivityResourceRow[]>();
    for (const a of assignments ?? []) { const arr = m.get(a.activityId) ?? []; arr.push(a); m.set(a.activityId, arr); }
    for (const arr of m.values()) arr.sort((x, y) => (y.isDriving - x.isDriving) || (x.id - y.id));
    return m;
  }, [assignments]);
  // The driving resource id for an activity (assignment-based, else legacy mirror).
  const drivingResourceId = (act: ScheduleActivity): number | null => {
    const arr = assignmentsByActivity.get(act.id);
    if (arr && arr.length) return (arr.find(x => x.isDriving === 1) ?? arr[0]).resourceId;
    return act.resourceId;
  };

  // ── View controls: filter by assignee / critical-path, group by resource ─────
  const [filterResource, setFilterResource] = useState<"all" | "unassigned" | number>("all");
  const [criticalOnly, setCriticalOnly] = useState(false);
  const [showResourcePanel, setShowResourcePanel] = useState(false);

  // ── Expand / collapse of the Activity tree ──────────────────────────────────
  // Collapsed Sections hide all their activities (the section summary bar stays);
  // collapsed parent activities hide their sub-activities. Keyed by phase string
  // (phase ?? "—") and by activity id respectively.
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [collapsedParents, setCollapsedParents] = useState<Set<number>>(new Set());
  const toggleSection = (phase: string | null) =>
    setCollapsedSections(prev => { const n = new Set(prev); const k = phase ?? "—"; n.has(k) ? n.delete(k) : n.add(k); return n; });
  const toggleParent = (id: number) =>
    setCollapsedParents(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  // Which top-level activities have sub-activities (so they get a twisty).
  const parentsWithKids = useMemo(
    () => new Set((activities ?? []).filter(a => a.parentId != null).map(a => a.parentId!)),
    [activities],
  );

  // ── Resizable grid columns ──────────────────────────────────────────────────
  const [colWidths, setColWidths] = useState<Record<ColKey, number>>(COL_DEFAULT);
  // Drag a column divider: track the pointer and grow/shrink that column (min-clamped).
  const startColResize = (key: ColKey) => (e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = colWidths[key];
    const min = COL_MIN[key];
    const onMove = (ev: MouseEvent) => {
      const w = Math.max(min, Math.round(startW + (ev.clientX - startX)));
      setColWidths(prev => (prev[key] === w ? prev : { ...prev, [key]: w }));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  // ── Mutations ──────────────────────────────────────────────────────────────
  const refetch = () => queryClient.invalidateQueries({ queryKey: scheduleKey });
  const refetchResources = () => queryClient.invalidateQueries({ queryKey: resKey });
  const api = async (method: string, url: string, body?: object) => {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const msg = await res.json().catch(() => ({ error: `${method} failed` }));
      toast({ title: "Error", description: msg.error ?? `${method} failed`, variant: "destructive" });
      throw new Error(msg.error);
    }
    return res.json().catch(() => null);
  };
  const patchActivity = async (id: number, partial: Partial<ScheduleActivity>) => {
    await api("PUT", `/api/projects/${projectId}/schedule/activity/${id}`, partial);
    refetch();
  };
  const addActivity = async (body: Partial<ScheduleActivity>) => {
    await api("POST", `/api/projects/${projectId}/schedule/activity`, body);
    refetch();
  };
  const deleteActivity = async (id: number) => {
    await api("DELETE", `/api/projects/${projectId}/schedule/activity/${id}`);
    refetch();
  };
  const renameSection = async (from: string | null, to: string) => {
    await api("POST", `/api/projects/${projectId}/schedule/section/rename`, { from, to });
    refetch();
  };
  const deleteSection = async (phase: string | null) => {
    await api("POST", `/api/projects/${projectId}/schedule/section/delete`, { phase });
    refetch();
  };
  const setCommencement = async (date: string) => {
    await api("PUT", `/api/projects/${projectId}/commencement`, { commencementDate: date || null });
    queryClient.invalidateQueries({ queryKey: commKey });
  };
  const addResource = async (body: Partial<ProjectResource>) => {
    await api("POST", `/api/projects/${projectId}/resources`, body);
    refetchResources();
  };
  const patchResource = async (id: number, body: Partial<ProjectResource>) => {
    await api("PUT", `/api/projects/${projectId}/resources/${id}`, body);
    refetchResources();
  };
  const deleteResource = async (id: number) => {
    await api("DELETE", `/api/projects/${projectId}/resources/${id}`);
    refetchResources();
    refetch(); // activities that referenced it become unassigned
    queryClient.invalidateQueries({ queryKey: assignKey });
    queryClient.invalidateQueries({ queryKey: leaveKey });
  };
  // Calendar
  const saveCalendar = async (body: Partial<WorkCalendar> & { name?: string; preset?: string | null }) => {
    await api("PUT", `/api/projects/${projectId}/calendar`, body);
    queryClient.invalidateQueries({ queryKey: calKey });
  };
  // Leave
  const addLeave = async (resourceId: number, body: Partial<ResourceLeaveRow>) => {
    await api("POST", `/api/projects/${projectId}/resources/${resourceId}/leave`, body);
    queryClient.invalidateQueries({ queryKey: leaveKey });
  };
  const deleteLeave = async (resourceId: number, lid: number) => {
    await api("DELETE", `/api/projects/${projectId}/resources/${resourceId}/leave/${lid}`);
    queryClient.invalidateQueries({ queryKey: leaveKey });
  };
  // Assignments
  const refetchAssignments = () => queryClient.invalidateQueries({ queryKey: assignKey });
  const addAssignment = async (activityId: number, body: Partial<ActivityResourceRow>) => {
    await api("POST", `/api/projects/${projectId}/schedule/activity/${activityId}/resources`, body);
    refetchAssignments(); refetch();
  };
  const patchAssignment = async (activityId: number, assignId: number, body: Partial<ActivityResourceRow>) => {
    await api("PUT", `/api/projects/${projectId}/schedule/activity/${activityId}/resources/${assignId}`, body);
    refetchAssignments(); refetch();
  };
  const deleteAssignment = async (activityId: number, assignId: number) => {
    await api("DELETE", `/api/projects/${projectId}/schedule/activity/${activityId}/resources/${assignId}`);
    refetchAssignments(); refetch();
  };

  // ── Build the hierarchical display model ─────────────────────────────────────
  const model = useMemo(() => {
    const acts = activities ?? [];
    const actMap = new Map(acts.map(a => [a.id, a] as const));
    // ── Calendar mode: when a commencement date is set, treat durations as
    // WORKING-day effort and let the CPM skip weekends/holidays + the driving
    // resource's leave (so bars span non-working time and leave auto-extends). ──
    const calMode = !!commencementDate;
    let cpmOpts: Parameters<typeof computeCpm>[1];
    if (calMode) {
      const predCache = new Map<number | null, (off: number) => boolean>();
      const getPred = (rid: number | null) => {
        if (!predCache.has(rid)) {
          const leave = rid != null ? leaveByResource.get(rid) : undefined;
          predCache.set(rid, workingByOffset(workCalendar, commencementDate!, leave));
        }
        return predCache.get(rid)!;
      };
      cpmOpts = {
        isWorking: (id: number) => {
          const act = actMap.get(id);
          return getPred(act ? drivingResourceId(act) : null);
        },
        placeWork,
      };
    }
    // ── CPM pass: derive dates + critical path from the typed dependency links ──
    const cpm = computeCpm(acts.map(a => ({
      id: a.id,
      durationDays: a.durationDays,
      isMilestone: a.isMilestone === 1,
      startOffsetDays: a.startOffsetDays,
      dependencies: parseDependencies(a),
    })), cpmOpts);
    const tops = acts.filter(a => a.parentId == null);
    const childrenByParent = new Map<number, ScheduleActivity[]>();
    for (const a of acts) {
      if (a.parentId != null) {
        const arr = childrenByParent.get(a.parentId) ?? [];
        arr.push(a);
        childrenByParent.set(a.parentId, arr);
      }
    }
    const sectionOrder: { phase: string | null; minSeq: number }[] = [];
    const seen = new Map<string, number>();
    for (const a of tops) {
      const key = a.phase ?? " ";
      if (!seen.has(key)) { seen.set(key, sectionOrder.length); sectionOrder.push({ phase: a.phase ?? null, minSeq: a.seq }); }
      else { const i = seen.get(key)!; sectionOrder[i].minSeq = Math.min(sectionOrder[i].minSeq, a.seq); }
    }
    sectionOrder.sort((x, y) => x.minSeq - y.minSeq);

    type Row =
      | { kind: "section"; phase: string | null; span: { start: number; end: number } | null }
      | { kind: "activity" | "sub"; act: ScheduleActivity };
    const rows: Row[] = [];
    const geom = new Map<number, { rowIndex: number; start: number; dur: number; isMs: boolean; crit: boolean }>();

    // Bar length = the CPM-computed CALENDAR span (start→finish), which in
    // calendar mode already absorbed weekends/holidays/leave. Falls back to the
    // raw duration when the activity isn't in the CPM result.
    const dur = (a: ScheduleActivity) => {
      if (a.isMilestone === 1) return 0;
      const r = cpm.results.get(a.id);
      return r ? Math.max(1, r.finish - r.start) : Math.max(1, a.durationDays);
    };
    // CPM-computed (early) start — links drive the date; the stored offset is only
    // the anchor for activities with no predecessors.
    const start = (a: ScheduleActivity) => cpm.results.get(a.id)?.start ?? Math.max(0, a.startOffsetDays);
    const crit = (a: ScheduleActivity) => cpm.results.get(a.id)?.isCritical ?? false;

    for (const sec of sectionOrder) {
      const secTops = tops
        .filter(a => (a.phase ?? null) === sec.phase)
        .sort((a, b) => (a.seq - b.seq) || (a.startOffsetDays - b.startOffsetDays));
      let sMin = Infinity, sMax = -Infinity;
      for (const t of secTops) {
        sMin = Math.min(sMin, start(t)); sMax = Math.max(sMax, start(t) + dur(t));
        for (const c of (childrenByParent.get(t.id) ?? [])) { sMin = Math.min(sMin, start(c)); sMax = Math.max(sMax, start(c) + dur(c)); }
      }
      rows.push({ kind: "section", phase: sec.phase, span: isFinite(sMin) ? { start: sMin, end: sMax } : null });
      for (const t of secTops) {
        geom.set(t.id, { rowIndex: rows.length, start: start(t), dur: dur(t), isMs: t.isMilestone === 1, crit: crit(t) });
        rows.push({ kind: "activity", act: t });
        const kids = (childrenByParent.get(t.id) ?? []).sort((a, b) => (a.seq - b.seq) || (a.startOffsetDays - b.startOffsetDays));
        for (const c of kids) {
          geom.set(c.id, { rowIndex: rows.length, start: start(c), dur: dur(c), isMs: c.isMilestone === 1, crit: crit(c) });
          rows.push({ kind: "sub", act: c });
        }
      }
    }

    const totalDays = Math.max(28, acts.reduce((m, a) => Math.max(m, start(a) + Math.max(dur(a), 1)), 0) + 3);
    const weeks = Math.ceil(totalDays / 7);
    return { rows, geom, weeks, totalDays: weeks * 7, tops, cpm };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activities, commencementDate, workCalendar, leaveByResource, assignmentsByActivity]);

  // Width of the frozen left grid = the sum of its (resizable) columns.
  const labelW = COL_KEYS.reduce((s, k) => s + colWidths[k], 0);
  // Day-width that makes the whole programme fill the visible area EXACTLY, then
  // scaled by the zoom multiplier (1 = fit, the minimum). Kept fractional on
  // purpose so there's no leftover gap on the right at 1×.
  const avail = Math.max(0, viewportW - labelW - 2);
  const fitDayWidth = viewportW > 0 && model.totalDays > 0 ? avail / model.totalDays : 12;
  const dayWidth = Math.max(3, fitDayWidth * zoom);
  const timelineWidth = model.totalDays * dayWidth;

  // Stable colour per Section (assigned in first-seen order), so every bar is
  // tinted by the phase it belongs to.
  const phaseColor = useMemo(() => {
    const map = new Map<string, string>();
    let i = 0;
    for (const a of activities ?? []) {
      const key = a.phase ?? "—";
      if (!map.has(key)) { map.set(key, PHASE_COLORS[i % PHASE_COLORS.length]); i++; }
    }
    return map;
  }, [activities]);
  const colorOf = (phase: string | null) => phaseColor.get(phase ?? "—") ?? PHASE_COLORS[0];
  const projectCurrency = useMemo(() => (resources ?? []).find(r => r.currency)?.currency ?? "KWD", [resources]);

  // ── Progress roll-ups + resource workload (duration-weighted) ───────────────
  // Weighting uses LEAF activities (a parent with sub-activities defers to its
  // children) so a task isn't counted twice. Milestones carry weight 1.
  const { phasePct, overallPct, resourceStats, unassignedCount, activityCost, activityPower, phaseCost, projectCost, projectPowerKw } = useMemo(() => {
    const acts = activities ?? [];
    const hasKids = new Set(acts.filter(a => a.parentId != null).map(a => a.parentId!));
    const leaves = acts.filter(a => !hasKids.has(a.id));
    const wOf = (a: ScheduleActivity) => (a.isMilestone === 1 ? 1 : Math.max(1, a.durationDays));
    const pctOf = (a: ScheduleActivity) => Math.min(100, Math.max(0, a.percentComplete ?? 0));
    const weighted = (list: ScheduleActivity[]) => {
      let w = 0, wp = 0;
      for (const a of list) { const ww = wOf(a); w += ww; wp += ww * pctOf(a); }
      return w ? Math.round(wp / w) : 0;
    };
    const phasePct = new Map<string, number>();
    const byPhase = new Map<string, ScheduleActivity[]>();
    for (const a of leaves) { const k = a.phase ?? "—"; (byPhase.get(k) ?? byPhase.set(k, []).get(k)!).push(a); }
    for (const [k, list] of byPhase) phasePct.set(k, weighted(list));

    // ── Cost & power (P6 resource loading) ──────────────────────────────────────
    // Cost uses the calendar's hours/day; an activity's working-day effort is its
    // durationDays. An assignment that's both partly allocated and multi-unit
    // multiplies accordingly (see assignmentCost). Power is the connected load.
    const hpd = workCalendar.hoursPerDay || 8;
    const wdOf = (a: ScheduleActivity) => (a.isMilestone === 1 ? 0 : Math.max(0, a.durationDays));
    const activityCost = new Map<number, number>();
    const activityPower = new Map<number, number>();
    const resourceCost = new Map<number, number>();
    for (const a of acts) {
      const wd = wdOf(a);
      let asg = assignmentsByActivity.get(a.id) ?? [];
      // Legacy fallback: an activity with only the single resourceId mirror.
      if (asg.length === 0 && a.resourceId != null) asg = [{ id: 0, projectId, activityId: a.id, resourceId: a.resourceId, allocationPct: 100, unitsPerDay: "1", isDriving: 1 }];
      let cost = 0, power = 0;
      for (const x of asg) {
        const r = resourceById.get(x.resourceId);
        if (!r) continue;
        const units = Number(x.unitsPerDay) || 1;
        const c = assignmentCost({ rate: r.rate ? Number(r.rate) : 0, rateBasis: r.rateBasis }, wd, hpd, x.allocationPct, units);
        cost += c;
        resourceCost.set(r.id, (resourceCost.get(r.id) ?? 0) + c);
        if (r.kind === "equipment" && r.powerKw) power += Number(r.powerKw) * units;
      }
      if (cost) activityCost.set(a.id, cost);
      if (power) activityPower.set(a.id, power);
    }
    const phaseCost = new Map<string, number>();
    let projectCost = 0;
    for (const a of acts) {
      const c = activityCost.get(a.id) ?? 0;
      if (!c) continue;
      projectCost += c;
      const k = a.phase ?? "—";
      phaseCost.set(k, (phaseCost.get(k) ?? 0) + c);
    }
    // Total connected load = the equipment fleet's rated power × how many exist.
    let projectPowerKw = 0;
    for (const r of resources ?? []) if (r.kind === "equipment" && r.powerKw) projectPowerKw += Number(r.powerKw) * (r.capacity ?? 1);

    // Per-resource workload (driving-assignment based) + weighted progress + cost.
    const resourceStats = new Map<number, { count: number; days: number; pct: number; cost: number }>();
    const byRes = new Map<number, ScheduleActivity[]>();
    let unassignedCount = 0;
    for (const a of leaves) {
      if (a.resourceId == null) { unassignedCount++; continue; }
      (byRes.get(a.resourceId) ?? byRes.set(a.resourceId, []).get(a.resourceId)!).push(a);
    }
    for (const [rid, list] of byRes) {
      const days = list.reduce((m, a) => m + (a.isMilestone === 1 ? 0 : Math.max(1, a.durationDays)), 0);
      resourceStats.set(rid, { count: list.length, days, pct: weighted(list), cost: resourceCost.get(rid) ?? 0 });
    }
    // Ensure resources that only appear via non-driving assignments still show cost.
    for (const [rid, c] of resourceCost) if (!resourceStats.has(rid)) resourceStats.set(rid, { count: 0, days: 0, pct: 0, cost: c });

    return { phasePct, overallPct: weighted(leaves), resourceStats, unassignedCount, activityCost, activityPower, phaseCost, projectCost, projectPowerKw };
  }, [activities, assignmentsByActivity, resourceById, resources, workCalendar, projectId]);

  // ── Leave conflicts: a driving resource on leave during its activity window ──
  // (The CPM already auto-extended the bar to skip the leave; this surfaces it so
  // the user can reassign instead.) activityId → { resourceId, days }.
  const leaveConflicts = useMemo(() => {
    const m = new Map<number, { resourceId: number; days: number }>();
    if (!commencementDate) return m;
    for (const a of activities ?? []) {
      const rid = drivingResourceId(a);
      if (rid == null) continue;
      const leave = leaveByResource.get(rid);
      if (!leave || leave.size === 0) continue;
      const g = model.geom.get(a.id);
      if (!g) continue;
      let days = 0;
      for (let off = g.start; off < g.start + g.dur; off++) if (leave.has(offsetToIso(commencementDate, off))) days++;
      if (days > 0) m.set(a.id, { resourceId: rid, days });
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activities, commencementDate, leaveByResource, model, assignmentsByActivity]);

  // Filter predicate for the assignee / critical-path view controls.
  const matchesFilter = (a: ScheduleActivity): boolean => {
    if (criticalOnly && !(model.geom.get(a.id)?.crit ?? false)) return false;
    if (filterResource === "all") return true;
    if (filterResource === "unassigned") return a.resourceId == null;
    return a.resourceId === filterResource;
  };
  const filterActive = criticalOnly || filterResource !== "all";

  // Which rows render. Hidden rows still occupy an index (rendered 0-height) so
  // the label column, bars and arrows stay index-aligned. Visibility is the AND
  // of two independent gates:
  //   1. the assignee / critical-path filter, and
  //   2. the expand/collapse tree (collapsed Section → hide its activities;
  //      collapsed parent activity → hide its sub-activities).
  // A section shows only if at least one of its activities PASSES THE FILTER —
  // collapse never hides a section row, only its descendants.
  const passesFilter: boolean[] = model.rows.map(row =>
    row.kind === "section" ? true : (!filterActive || matchesFilter(row.act)));
  if (filterActive) {
    for (let i = 0; i < model.rows.length; i++) {
      if (model.rows[i].kind !== "section") continue;
      let any = false;
      for (let j = i + 1; j < model.rows.length && model.rows[j].kind !== "section"; j++) if (passesFilter[j]) { any = true; break; }
      passesFilter[i] = any;
    }
  }
  const rowVisible: boolean[] = model.rows.map(() => true);
  {
    let secCollapsed = false, parentCollapsed = false;
    for (let i = 0; i < model.rows.length; i++) {
      const row = model.rows[i];
      if (row.kind === "section") {
        secCollapsed = collapsedSections.has(row.phase ?? "—");
        parentCollapsed = false;
        rowVisible[i] = passesFilter[i];
      } else if (row.kind === "activity") {
        parentCollapsed = collapsedParents.has(row.act.id);
        rowVisible[i] = passesFilter[i] && !secCollapsed;
      } else {
        rowVisible[i] = passesFilter[i] && !secCollapsed && !parentCollapsed;
      }
    }
  }
  const visibleCount = model.rows.filter((r, i) => r.kind !== "section" && rowVisible[i]).length;

  // Month bands for the top header tier (only meaningful with a commencement date).
  const monthBands = useMemo(() => {
    if (!commencementDate) return [] as { label: string; start: number; days: number }[];
    const bands: { label: string; start: number; days: number }[] = [];
    let cur: { label: string; start: number; days: number; key: string } | null = null;
    for (let day = 0; day < model.totalDays; day++) {
      const dt = offsetToDate(commencementDate, day);
      const key = `${dt.getFullYear()}-${dt.getMonth()}`;
      if (!cur || cur.key !== key) {
        cur = { key, label: dt.toLocaleString(undefined, { month: "short", year: "2-digit" }), start: day, days: 1 };
        bands.push(cur);
      } else cur.days++;
    }
    return bands;
  }, [commencementDate, model.totalDays]);

  // Non-working day offsets (project weekend + holidays) for shading the Gantt —
  // the visual "working day / non-working day" the user asked for. Only with a
  // commencement date (otherwise offsets don't map to weekdays).
  const nonWorkingOffsets = useMemo(() => {
    if (!commencementDate) return [] as number[];
    const isW = workingByOffset(workCalendar, commencementDate);
    const out: number[] = [];
    for (let d = 0; d < model.totalDays; d++) if (!isW(d)) out.push(d);
    return out;
  }, [commencementDate, workCalendar, model.totalDays]);

  // "Today" marker — day offset from commencement, shown only when it falls
  // within the programme window.
  const todayOffset = useMemo(() => {
    if (!commencementDate) return null;
    const off = Math.round((Date.now() - new Date(`${commencementDate}T00:00:00`).getTime()) / MS_DAY);
    return off >= 0 && off <= model.totalDays ? off : null;
  }, [commencementDate, model.totalDays]);

  // Effective per-row heights (measured once rendered; ROW_H until then) and the
  // cumulative top offset of each row, shared by the label column, the bars and
  // the dependency arrows so everything stays vertically aligned.
  const heights = measuredHeights.length === model.rows.length ? measuredHeights : model.rows.map(() => ROW_H);
  const tops: number[] = [];
  let _acc = 0;
  for (const h of heights) { tops.push(_acc); _acc += h; }
  const barsHeight = _acc;

  useLayoutEffect(() => {
    const hs = model.rows.map((_, i) => rowRefs.current[i]?.offsetHeight ?? ROW_H);
    setMeasuredHeights(prev => (prev.length === hs.length && prev.every((p, i) => p === hs[i]) ? prev : hs));
  });

  const handleGenerate = async () => {
    setIsGenerating(true);
    setProgress([]);
    try {
      const res = await fetch(`/api/projects/${projectId}/generate-schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: pref.provider, model: pref.model, providerConfig }),
      });
      if (!res.body) throw new Error("No response body");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of decoder.decode(value).split("\n").filter(Boolean)) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "schedule") {
              setProgress(p => [...p, data.message]);
              if (data.stage === "complete") toast({ title: "Work Programme Ready", description: data.message });
            } else if (data.type === "error") {
              toast({ title: "Error", description: data.message, variant: "destructive" });
            }
          } catch {}
        }
      }
      queryClient.invalidateQueries({ queryKey: scheduleKey });
    } catch {
      toast({ title: "Error", description: "Schedule generation failed", variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  };

  const [isLinking, setIsLinking] = useState(false);
  const handleAutoLink = async () => {
    setIsLinking(true);
    try {
      const r = await api("POST", `/api/projects/${projectId}/schedule/auto-link`);
      refetch();
      toast({
        title: "Dependencies linked",
        description: r && typeof r.linked === "number"
          ? `Linked ${r.linked} activit${r.linked === 1 ? "y" : "ies"} into the network. The critical path is now highlighted in red.`
          : "Activities linked — the critical path is now highlighted in red.",
      });
    } finally {
      setIsLinking(false);
    }
  };

  const handleAddSection = () => addActivity({ phase: "New Section", activity: "New activity", startOffsetDays: 0, durationDays: 7 });

  const handleAddActivity = (phase: string | null) => {
    const ends = model.tops
      .filter(a => (a.phase ?? null) === phase)
      .map(a => Math.max(0, a.startOffsetDays) + (a.isMilestone === 1 ? 0 : Math.max(1, a.durationDays)));
    const startAt = ends.length ? Math.max(...ends) : 0;
    addActivity({ phase, activity: "New activity", startOffsetDays: startAt, durationDays: 7 });
  };

  const handleAddSub = (parent: ScheduleActivity) =>
    addActivity({ phase: parent.phase, parentId: parent.id, activity: "New sub-activity", startOffsetDays: Math.max(0, parent.startOffsetDays), durationDays: Math.max(1, Math.round(parent.durationDays / 2)) });

  const hasActivities = !!activities && activities.length > 0;

  // Track the scroll-container width so the timeline can auto-fit it.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setViewportW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasActivities]);

  // ── Build the typed relationship arrows. The endpoints depend on the link
  // type — FS/FF leave the predecessor's FINISH, SS/SF leave its START; FS/SS
  // enter the successor's START, FF/SF its FINISH. Links on the critical path
  // (predecessor and successor both critical) are drawn in red. ───────────────
  // Name lookup for arrow tooltips, and the set of activities directly connected
  // to the hovered one (its predecessors + successors) so we can spotlight them.
  const actById = new Map((activities ?? []).map(a => [a.id, a] as const));
  const connected = new Set<number>();
  if (hasActivities && hoverId != null) {
    for (const a of activities!) {
      for (const dep of parseDependencies(a)) {
        if (a.id === hoverId) connected.add(dep.id);
        if (dep.id === hoverId) connected.add(a.id);
      }
    }
  }
  // Is an activity spotlighted (hovered or directly linked to the hovered one)?
  const isLit = (id: number) => hoverId == null || id === hoverId || connected.has(id);

  const arrows: ReactNode[] = [];
  if (hasActivities) {
    for (const a of activities!) {
      const succ = model.geom.get(a.id);
      if (!succ) continue;
      for (const dep of parseDependencies(a)) {
        const pred = model.geom.get(dep.id);
        if (!pred) continue;
        const predStart = pred.start * dayWidth;
        const predFinish = (pred.start + pred.dur) * dayWidth;
        const succStart = succ.start * dayWidth;
        const succFinish = (succ.start + succ.dur) * dayWidth;
        const x1 = (dep.type === "SS" || dep.type === "SF") ? predStart : predFinish;
        const x2 = (dep.type === "FF" || dep.type === "SF") ? succFinish : succStart;
        const y1 = (tops[pred.rowIndex] ?? pred.rowIndex * ROW_H) + (heights[pred.rowIndex] ?? ROW_H) / 2;
        const y2 = (tops[succ.rowIndex] ?? succ.rowIndex * ROW_H) + (heights[succ.rowIndex] ?? ROW_H) / 2;
        const critLink = pred.crit && succ.crit;
        // Right-angle (elbow) connector, P6/MS-Project style: leave the
        // predecessor edge with a short horizontal stub, drop/rise in a single
        // vertical run, then enter the successor edge with a short stub. Far
        // clearer than a diagonal curve that cuts across other bars. The two
        // corners are softened with small quadratic curves.
        const STUB = 14;                                   // horizontal stub at each end
        const midX = Math.max(x1 + STUB, x2 - STUB);       // x of the vertical run
        const r = Math.min(5, Math.abs(y2 - y1) / 2, Math.abs(midX - x1), Math.abs(x2 - midX));
        let d: string;
        if (r < 1) {
          d = `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`;   // too tight for rounding — sharp elbow
        } else {
          const vDir = y2 >= y1 ? 1 : -1;                  // down vs up
          const inDir = midX >= x1 ? 1 : -1;               // first stub direction
          const outDir = x2 >= midX ? 1 : -1;              // last stub direction
          d =
            `M ${x1} ${y1}` +
            ` H ${midX - inDir * r}` +
            ` Q ${midX} ${y1} ${midX} ${y1 + vDir * r}` +   // top corner
            ` V ${y2 - vDir * r}` +
            ` Q ${midX} ${y2} ${midX + outDir * r} ${y2}` + // bottom corner
            ` H ${x2}`;
        }
        // Hover spotlight: when an activity is hovered, this link is "active" if
        // it touches it. Active links pop; the rest fade right back.
        const touchesHover = hoverId != null && (dep.id === hoverId || a.id === hoverId);
        const dimmed = hoverId != null && !touchesHover;
        const stroke = touchesHover ? "#2563eb" : (critLink ? "#dc2626" : "currentColor");
        const opacity = dimmed ? 0.1 : (touchesHover ? 1 : (critLink ? 1 : 0.5));
        const marker = touchesHover ? "url(#arrowhead-hover)" : (critLink ? "url(#arrowhead-crit)" : "url(#arrowhead)");
        const predName = actById.get(dep.id)?.activity ?? `#${dep.id}`;
        const succName = a.activity;
        const tip = `${predName}  →  ${succName}   (${relLabel(dep.type, dep.lag)})`;
        arrows.push(
          <g key={`${dep.id}-${a.id}`} style={{ pointerEvents: "stroke" }}>
            <title>{tip}</title>
            {/* Wide invisible hit-area so the thin line is easy to hover. */}
            <path d={d} fill="none" stroke="transparent" strokeWidth={12}
              onMouseEnter={() => setHoverId(a.id)} onMouseLeave={() => setHoverId(null)} style={{ cursor: "help" }} />
            <path
              d={d}
              fill="none"
              stroke={stroke}
              strokeWidth={touchesHover ? 2.5 : (critLink ? 2 : 1.25)}
              strokeOpacity={opacity}
              markerEnd={marker}
              style={{ pointerEvents: "none" }}
            />
          </g>,
        );
      }
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      {/* Header: title + Generate / Export */}
      <div className="flex items-center justify-between gap-4 flex-wrap border-b border-border px-4 py-3">
        <div>
          <h3 className="font-semibold">Work Programme</h3>
          <p className="text-xs text-muted-foreground">Editable schedule — sections, activities, sub-activities & dependencies.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" disabled={isGenerating} onClick={handleGenerate} title="(Re)build the programme from this project's documents + BOQ">
            {isGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CalendarClock className="mr-2 h-4 w-4" />}
            {isGenerating ? "Generating..." : "Generate Programme"}
          </Button>
          {hasActivities && (
            <Button variant="outline" size="sm" disabled={isLinking} onClick={handleAutoLink} title="Auto-link unconnected activities into a dependency network (Finish→Start, keeping current dates) so the critical path appears">
              {isLinking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Link2 className="mr-2 h-4 w-4" />}
              {isLinking ? "Linking..." : "Auto-link"}
            </Button>
          )}
          {hasActivities && (
            <Button
              size="sm"
              onClick={() => window.location.assign(`/api/projects/${projectId}/programme/export.xlsx?t=${Date.now()}`)}
              className="gap-2 bg-gradient-to-b from-emerald-500 to-emerald-600 text-white shadow-sm hover:from-emerald-500 hover:to-emerald-700"
            >
              <FileSpreadsheet className="h-4 w-4" /> Export Programme
            </Button>
          )}
        </div>
      </div>

      {/* Toolbar: commencement, zoom, +Section */}
      <div className="flex items-center justify-between gap-4 flex-wrap border-b border-border px-4 py-2">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Label htmlFor={`comm-${projectId}`} className="text-xs text-muted-foreground whitespace-nowrap">Commencement</Label>
            <Input
              id={`comm-${projectId}`}
              type="date"
              className="h-8 w-[150px]"
              value={commencementDate ?? ""}
              onChange={e => setCommencement(e.target.value)}
            />
          </div>
          {hasActivities && (
            <span className="text-xs text-muted-foreground">
              {activities!.length} activities · {model.totalDays} days (≈ {model.weeks} week{model.weeks === 1 ? "" : "s"})
            </span>
          )}
          {hasActivities && (
            <span className="flex items-center gap-1.5 text-xs" title="Overall programme progress (duration-weighted)">
              <span className="h-2 w-20 rounded-full bg-foreground/15 overflow-hidden"><span className="block h-full rounded-full bg-emerald-500" style={{ width: `${overallPct}%` }} /></span>
              <span className="font-semibold tabular-nums text-foreground">{overallPct}%</span>
              <span className="text-muted-foreground">complete</span>
            </span>
          )}
          {hasActivities && projectCost > 0 && (
            <span className="flex items-center gap-1 text-xs" title="Total resource cost across the programme">
              <Coins className="h-3.5 w-3.5 text-amber-600" />
              <span className="font-semibold tabular-nums text-foreground">{fmtMoney(projectCost, projectCurrency)}</span>
            </span>
          )}
          {hasActivities && projectPowerKw > 0 && (
            <span className="flex items-center gap-1 text-xs" title="Total connected equipment load (rated power × units)">
              <Zap className="h-3.5 w-3.5 text-amber-600" />
              <span className="font-semibold tabular-nums text-foreground">{projectPowerKw.toLocaleString()} kW</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {hasActivities && (
            <>
              {/* Assignee filter */}
              <div className="flex items-center gap-1">
                <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                <select
                  value={String(filterResource)}
                  onChange={e => setFilterResource(e.target.value === "all" || e.target.value === "unassigned" ? (e.target.value as "all" | "unassigned") : Number(e.target.value))}
                  className="h-8 rounded border border-input bg-background px-1.5 text-xs outline-none focus:ring-1 focus:ring-ring"
                  title="Filter activities by assignee"
                >
                  <option value="all">All assignees</option>
                  <option value="unassigned">Unassigned{unassignedCount ? ` (${unassignedCount})` : ""}</option>
                  {(resources ?? []).map(r => <option key={r.id} value={r.id}>{r.name}{resourceStats.get(r.id) ? ` (${resourceStats.get(r.id)!.count})` : ""}</option>)}
                </select>
              </div>
              <Button size="sm" variant={criticalOnly ? "default" : "outline"} className="h-8" onClick={() => setCriticalOnly(v => !v)} title="Show only the critical-path activities">
                <span className="inline-block h-2 w-2.5 rounded-sm bg-red-500 mr-1.5" /> Critical
              </Button>
              {filterActive && (
                <Button size="sm" variant="ghost" className="h-8 px-2 text-muted-foreground" onClick={() => { setFilterResource("all"); setCriticalOnly(false); }} title="Clear filters">
                  <X className="h-3.5 w-3.5 mr-1" />{visibleCount} shown
                </Button>
              )}
              <Button size="sm" variant={showResourcePanel ? "default" : "outline"} className="h-8" onClick={() => setShowResourcePanel(v => !v)} title="Manage the project team / resources">
                <Users className="h-3.5 w-3.5 mr-1.5" /> Team{(resources ?? []).length ? ` (${resources!.length})` : ""}
              </Button>
              <span className="mx-1 h-5 w-px bg-border" />
            </>
          )}
          <Badge variant="outline" className="gap-1"><Diamond className="h-3 w-3 fill-red-500 text-red-500" /> milestone</Badge>
          <Badge variant="outline" className="gap-1"><span className="inline-block h-2.5 w-3 rounded-sm bg-red-500" /> critical path</Badge>
          <Button size="icon" variant="ghost" className="h-7 w-7" disabled={zoom <= 1} onClick={() => setZoom(z => Math.max(1, +(z / 1.3).toFixed(3)))} title="Zoom out (1× = fit to width)"><ZoomOut className="h-4 w-4" /></Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" disabled={zoom >= 6} onClick={() => setZoom(z => Math.min(6, +(z * 1.3).toFixed(3)))} title="Zoom in"><ZoomIn className="h-4 w-4" /></Button>
          <Button size="sm" variant="outline" onClick={handleAddSection}><Plus className="mr-1 h-3.5 w-3.5" /> Section</Button>
        </div>
      </div>

      {/* Resource / Team manager + workload panel (toggled from the toolbar) */}
      {hasActivities && showResourcePanel && (
        <ResourcePanel
          resources={resources ?? []}
          stats={resourceStats}
          unassignedCount={unassignedCount}
          calendar={workCalendar}
          calRow={defaultCalRow}
          leaveByResource={leaveListByResource}
          projectCurrency={projectCurrency}
          projectCost={projectCost}
          projectPowerKw={projectPowerKw}
          onAdd={addResource}
          onPatch={patchResource}
          onDelete={deleteResource}
          onSaveCalendar={saveCalendar}
          onAddLeave={addLeave}
          onDeleteLeave={deleteLeave}
          onClose={() => setShowResourcePanel(false)}
          onFilter={rid => setFilterResource(rid)}
        />
      )}

      {progress.length > 0 && isGenerating && (
        <div className="border-b border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground max-h-28 overflow-y-auto">
          {progress.map((m, i) => <div key={i}>{m}</div>)}
        </div>
      )}

      {isLoading ? (
        <div className="py-16 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" /></div>
      ) : !hasActivities ? (
        <div className="py-16 text-center text-muted-foreground space-y-4">
          <p>No work programme yet.</p>
          <p className="text-sm">Generate one from the documents + BOQ, or build it by hand — start with a section, then add activities and sub-activities inside it.</p>
          <div className="flex items-center justify-center gap-3">
            <Button onClick={handleGenerate} disabled={isGenerating}>
              {isGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CalendarClock className="mr-2 h-4 w-4" />}
              Generate from documents + BOQ
            </Button>
            <Button variant="outline" onClick={handleAddSection}><Plus className="mr-1.5 h-4 w-4" /> Add first section</Button>
          </div>
        </div>
      ) : (
        <>
          {model.cpm.hasCycle && (
            <div className="px-4 py-2 text-[11px] border-b border-border bg-amber-500/10 text-amber-700 dark:text-amber-400">
              A contradictory dependency (a loop, e.g. two activities depending on each other) was detected and ignored so the critical path could still be calculated. Review the predecessors of the linked activities to remove it.
            </div>
          )}
          <div className="px-4 py-2 text-[11px] text-muted-foreground border-b border-border bg-muted/20 flex flex-wrap items-center gap-x-4 gap-y-1">
            <span><span className="font-medium text-foreground">Click a name</span> to rename</span>
            <span><Pencil className="inline h-3 w-3" /> edit dates / duration / dependencies</span>
            <span><Plus className="inline h-3 w-3" /> add activity or sub-activity</span>
            <span><Trash2 className="inline h-3 w-3" /> delete</span>
            <span>Set a <span className="font-medium text-foreground">Commencement</span> date above for real calendar dates</span>
          </div>
          <div className="overflow-auto" ref={scrollRef}>
            <div className="flex min-w-fit">
              {/* ── Left: labels + inline controls (frozen — stays put while the
                   timeline scrolls horizontally so activity names are always visible) ── */}
              <div className="shrink-0 sticky left-0 z-30 border-r border-border bg-card shadow-[2px_0_4px_-1px_rgba(0,0,0,0.1)]" style={{ width: labelW }}>
                {/* Column headers — each carries a draggable divider to resize it. */}
                <div className="flex items-stretch border-b border-border bg-card sticky top-0 z-10 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground" style={{ height: HEADER_H }}>
                  {COL_KEYS.map(key => (
                    <div key={key} className="relative flex items-center px-2 border-r border-border/50 overflow-hidden" style={{ width: colWidths[key] }}>
                      <span className="truncate">{COL_LABELS[key]}</span>
                      <div
                        onMouseDown={startColResize(key)}
                        className="group absolute inset-y-0 right-0 z-10 flex w-2 cursor-col-resize touch-none items-center justify-center"
                        title={`Drag to resize the ${COL_LABELS[key]} column`}
                      >
                        <span className="h-1/2 w-px bg-border transition-colors group-hover:w-0.5 group-hover:bg-primary" />
                      </div>
                    </div>
                  ))}
                </div>
                {model.rows.map((row, i) => {
                  // Hidden under the active filter — keep the index but collapse to
                  // 0 height so bars/arrows stay aligned by row index.
                  if (!rowVisible[i]) return <div key={`hidden-${i}`} ref={el => { rowRefs.current[i] = el; }} className="overflow-hidden" style={{ height: 0 }} />;
                  if (row.kind === "section") {
                    const c = colorOf(row.phase);
                    const pp = phasePct.get(row.phase ?? "—") ?? 0;
                    const secCollapsed = collapsedSections.has(row.phase ?? "—");
                    const span = row.span;
                    const secStart = span ? (fmtDate(commencementDate, span.start) ?? `day ${span.start}`) : "—";
                    const secFinish = span ? (fmtDate(commencementDate, span.end) ?? `day ${span.end}`) : "—";
                    const secDur = span ? `${span.end - span.start}d` : "—";
                    return (
                      <div key={`sec-${i}`} ref={el => { rowRefs.current[i] = el; }} className="flex items-stretch bg-muted/60 border-b border-border" style={{ height: ROW_H, borderLeft: `3px solid ${c}` }}>
                        {/* Activity */}
                        <div className="flex items-center gap-0.5 pl-1 pr-1 border-r border-border/40" style={{ width: colWidths.activity }}>
                          <button
                            type="button"
                            onClick={() => toggleSection(row.phase)}
                            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                            title={secCollapsed ? "Expand section" : "Collapse section"}
                            aria-expanded={!secCollapsed}
                          >
                            {secCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                          </button>
                          <EditableText
                            value={row.phase ?? "General"}
                            onSave={to => renameSection(row.phase, to)}
                            className="flex-1 min-w-0 text-xs font-semibold uppercase tracking-wide text-foreground/80 truncate"
                          />
                          <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground" title="Add an activity to this section" onClick={() => handleAddActivity(row.phase)}><Plus className="h-3.5 w-3.5" /></Button>
                          <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0 text-destructive hover:bg-destructive/10" title="Delete section" onClick={() => { if (confirm(`Delete section "${row.phase ?? "General"}" and all its activities?`)) deleteSection(row.phase); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </div>
                        {/* Assignee (n/a for a section) */}
                        <div className="border-r border-border/40" style={{ width: colWidths.assignee }} />
                        {/* Start / Finish / Dur — rolled up from the section span */}
                        <div className="flex items-center px-2 border-r border-border/40 overflow-hidden text-[10px] tabular-nums text-muted-foreground" style={{ width: colWidths.start }}><span className="truncate">{secStart}</span></div>
                        <div className="flex items-center px-2 border-r border-border/40 overflow-hidden text-[10px] tabular-nums text-muted-foreground" style={{ width: colWidths.finish }}><span className="truncate">{secFinish}</span></div>
                        <div className="flex items-center px-2 border-r border-border/40 overflow-hidden text-[10px] tabular-nums text-muted-foreground" style={{ width: colWidths.dur }}><span className="truncate">{secDur}</span></div>
                        {/* % roll-up (duration-weighted) */}
                        <div className="flex items-center gap-1 px-2 border-r border-border/40" style={{ width: colWidths.pct }} title={`Section ${pp}% complete (duration-weighted)`}>
                          <span className="h-1.5 flex-1 min-w-0 rounded-full bg-foreground/15 overflow-hidden"><span className="block h-full rounded-full" style={{ width: `${pp}%`, backgroundColor: c }} /></span>
                          <span className="text-[9px] tabular-nums text-muted-foreground w-7 text-right">{pp}%</span>
                        </div>
                        {/* Cost roll-up for the section */}
                        <div className="flex items-center px-2 overflow-hidden text-[10px] tabular-nums font-medium text-foreground/70" style={{ width: colWidths.cost }} title="Section cost (sum of assigned resource costs)">
                          <span className="truncate">{fmtMoney(phaseCost.get(row.phase ?? "—") ?? 0, projectCurrency)}</span>
                        </div>
                      </div>
                    );
                  }
                  const a = row.act;
                  const isSub = row.kind === "sub";
                  const isMs = a.isMilestone === 1;
                  // CPM-computed start drives the displayed dates (links → dates).
                  const s0 = model.geom.get(a.id)?.start ?? Math.max(0, a.startOffsetDays);
                  const durDays = isMs ? 0 : Math.max(1, a.durationDays);          // working-day effort (what the user edits)
                  const spanDays = isMs ? 0 : (model.geom.get(a.id)?.dur ?? durDays); // calendar span (incl. weekends/holidays/leave)
                  const startTxt = commencementDate ? (fmtDate(commencementDate, s0) ?? "—") : `day ${s0}`;
                  const finishTxt = isMs ? "—" : (commencementDate ? (fmtDate(commencementDate, s0 + spanDays) ?? "—") : `day ${s0 + spanDays}`);
                  const preds = parseDependencies(a);
                  const isCrit = model.geom.get(a.id)?.crit ?? false;
                  return (
                    <div
                      key={a.id}
                      ref={el => { rowRefs.current[i] = el; }}
                      className={`flex items-stretch border-b border-border/50 transition-colors ${hoverId === a.id ? "bg-blue-500/15" : connected.has(a.id) ? "bg-blue-500/[0.07]" : "hover:bg-muted/30"}`}
                      style={{ minHeight: ROW_H }}
                      onMouseEnter={() => setHoverId(a.id)}
                      onMouseLeave={() => setHoverId(null)}
                    >
                      {/* Activity column: tree twisty + icon + (wrapping) name + badges + actions */}
                      <div className={`flex items-start gap-1 py-1.5 pr-1 border-r border-border/40 ${isSub ? "pl-5" : "pl-1"}`} style={{ width: colWidths.activity }}>
                        {!isSub && (
                          parentsWithKids.has(a.id) ? (
                            <button
                              type="button"
                              onClick={() => toggleParent(a.id)}
                              className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                              title={collapsedParents.has(a.id) ? "Expand sub-activities" : "Collapse sub-activities"}
                              aria-expanded={!collapsedParents.has(a.id)}
                            >
                              {collapsedParents.has(a.id) ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                            </button>
                          ) : (
                            <span className="mt-0.5 h-4 w-4 shrink-0" />
                          )
                        )}
                        {isSub && <CornerDownRight className="h-3 w-3 mt-1 text-muted-foreground shrink-0" />}
                        {isMs && <Diamond className="h-3 w-3 mt-1 fill-red-500 text-red-500 shrink-0" />}
                        <div className="flex-1 min-w-0">
                          <EditableText
                            value={a.activity}
                            onSave={to => patchActivity(a.id, { activity: to })}
                            title={a.activity}
                            className={`block whitespace-normal break-words leading-snug ${isSub ? "text-xs" : "text-sm"}`}
                          />
                          {((isCrit && !isMs) || preds.length > 0) && (
                            <div className="mt-0.5 flex items-center flex-wrap gap-1">
                              {isCrit && !isMs && <Badge variant="outline" className="h-4 px-1 text-[9px] border-red-500/50 text-red-600">critical</Badge>}
                              {preds.length > 0 && <Badge variant="outline" className="h-4 px-1 text-[9px] gap-0.5"><Link2 className="h-2.5 w-2.5" />{preds.length}</Badge>}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <ActivityEditor act={a} all={activities!} commencementDate={commencementDate} computedStart={s0} onPatch={patchActivity} />
                          {!isSub && (
                            <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-foreground" title="Add sub-activity" onClick={() => handleAddSub(a)}><Plus className="h-3.5 w-3.5" /></Button>
                          )}
                          <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive hover:bg-destructive/10" title="Delete" onClick={() => { if (confirm(`Delete "${a.activity}"${!isSub ? " and its sub-activities" : ""}?`)) deleteActivity(a.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </div>
                      </div>
                      {/* Resources column (multi-assignee + leave conflict) */}
                      <div className="flex items-start px-1.5 py-1.5 border-r border-border/40 overflow-hidden" style={{ width: colWidths.assignee }}>
                        <MultiAssignee
                          assigns={assignmentsByActivity.get(a.id) ?? []}
                          resources={resources ?? []}
                          conflict={leaveConflicts.get(a.id) ?? null}
                          leaveByResource={leaveByResource}
                          isMilestone={isMs}
                          activityCost={activityCost.get(a.id) ?? 0}
                          currency={projectCurrency}
                          onAdd={body => addAssignment(a.id, body)}
                          onPatch={(assignId, body) => patchAssignment(a.id, assignId, body)}
                          onDelete={assignId => deleteAssignment(a.id, assignId)}
                          onManage={() => setShowResourcePanel(true)}
                        />
                      </div>
                      {/* Start / Finish / Dur columns */}
                      <div className="flex items-start px-2 py-1.5 border-r border-border/40 overflow-hidden text-[10px] tabular-nums text-muted-foreground" style={{ width: colWidths.start }}><span className="truncate" title={startTxt}>{startTxt}</span></div>
                      <div className="flex items-start px-2 py-1.5 border-r border-border/40 overflow-hidden text-[10px] tabular-nums text-muted-foreground" style={{ width: colWidths.finish }}><span className="truncate" title={finishTxt}>{finishTxt}</span></div>
                      <div className="flex items-start px-2 py-1.5 border-r border-border/40 overflow-hidden text-[10px] tabular-nums text-muted-foreground" style={{ width: colWidths.dur }}>
                        {isMs ? <Diamond className="h-3 w-3 mt-0.5 fill-red-500 text-red-500" /> : <span className="truncate">{durDays}d</span>}
                      </div>
                      {/* % Done column */}
                      <div className="flex items-start px-1.5 py-1.5 border-r border-border/40 overflow-hidden" style={{ width: colWidths.pct }}>
                        {isMs ? (
                          <span className="text-[10px] text-muted-foreground">—</span>
                        ) : (
                          <PercentInline
                            value={a.percentComplete ?? 0}
                            color={isCrit ? "#dc2626" : colorOf(a.phase)}
                            onChange={pct => patchActivity(a.id, { percentComplete: pct })}
                          />
                        )}
                      </div>
                      {/* Cost column (+ equipment power badge) */}
                      <div className="flex flex-col items-start px-2 py-1.5 overflow-hidden text-[10px] tabular-nums" style={{ width: colWidths.cost }}>
                        <span className="truncate font-medium text-foreground/80" title="Activity cost (assigned resources × duration)">{fmtMoney(activityCost.get(a.id) ?? 0, projectCurrency)}</span>
                        {(activityPower.get(a.id) ?? 0) > 0 && (
                          <span className="flex items-center gap-0.5 text-[9px] text-amber-600" title="Connected equipment load"><Zap className="h-2.5 w-2.5" />{(activityPower.get(a.id) ?? 0).toLocaleString()} kW</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* ── Right: timeline ── */}
              <div className="relative" style={{ width: timelineWidth }}>
                <div className="border-b border-border bg-muted sticky top-0 z-20 flex flex-col" style={{ height: HEADER_H }}>
                  {/* Top tier: month bands (only with a commencement date) */}
                  {monthBands.length > 0 && (
                    <div className="relative border-b border-border/60" style={{ height: 22 }}>
                      {monthBands.map((m, mi) => (
                        <div
                          key={mi}
                          className="absolute flex items-center px-2 text-[10px] font-semibold uppercase tracking-wide text-foreground/70 border-l border-border/50 overflow-hidden whitespace-nowrap"
                          style={{ left: m.start * dayWidth, width: m.days * dayWidth, top: 0, bottom: 0 }}
                        >
                          {m.label}
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Bottom tier: week number + (optional) week-start date.
                      Adaptive to the column width so the header never wraps or
                      collides: at a fit-to-width zoom each week can be only
                      ~30px, far too narrow for a full date. We therefore widen
                      the detail as space allows — day-month with the year, then
                      just day-month (the year lives in the month band above),
                      then the day-of-month number, then nothing — and we thin
                      out the "Wn" labels when even those would overlap. */}
                  {(() => {
                    const weekW = 7 * dayWidth;
                    // How many weeks to skip between visible "Wn" labels so they
                    // don't crowd (each needs ~26px). 1 = every week.
                    const labelStep = Math.max(1, Math.ceil(26 / weekW));
                    const dateMode: "none" | "day" | "md" | "full" =
                      weekW >= 76 ? "full" : weekW >= 52 ? "md" : weekW >= 26 ? "day" : "none";
                    return (
                      <div className="flex flex-1">
                        {Array.from({ length: model.weeks }, (_, w) => {
                          const showLabel = w % labelStep === 0;
                          let dateTxt: string | null = null;
                          if (commencementDate && dateMode !== "none") {
                            const d = offsetToDate(commencementDate, w * 7);
                            dateTxt =
                              dateMode === "full"
                                ? d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "2-digit" })
                                : dateMode === "md"
                                  ? d.toLocaleDateString(undefined, { day: "2-digit", month: "short" })
                                  : String(d.getDate());
                          }
                          return (
                            <div
                              key={w}
                              className="flex flex-col items-center justify-center border-l border-border/40 text-[10px] text-muted-foreground overflow-hidden"
                              style={{ width: weekW }}
                            >
                              <span className="font-medium text-foreground/80 leading-tight whitespace-nowrap">
                                {showLabel ? `W${w + 1}` : " "}
                              </span>
                              {dateTxt && <span className="opacity-60 leading-tight whitespace-nowrap">{dateTxt}</span>}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>

                <div
                  className="relative"
                  style={{
                    height: barsHeight,
                    backgroundImage: `repeating-linear-gradient(to right, transparent, transparent ${7 * dayWidth - 1}px, hsl(var(--border) / 0.4) ${7 * dayWidth - 1}px, hsl(var(--border) / 0.4) ${7 * dayWidth}px)`,
                  }}
                >
                  {/* Row backgrounds + separators, aligned to the measured rows so the
                      eye can track a name straight across to its bar. */}
                  {model.rows.map((row, i) => {
                    if (!rowVisible[i]) return null;
                    const top = tops[i] ?? i * ROW_H;
                    const rh = heights[i] ?? ROW_H;
                    return (
                      <div
                        key={`bg-${i}`}
                        className={`absolute left-0 border-b border-border/25 ${row.kind === "section" ? "bg-muted/40" : (i % 2 ? "bg-foreground/[0.015]" : "")}`}
                        style={{ top, width: timelineWidth, height: rh }}
                      />
                    );
                  })}

                  {/* Non-working day shading (weekends + holidays) */}
                  {dayWidth >= 2 && nonWorkingOffsets.map(d => (
                    <div
                      key={`nw-${d}`}
                      className="absolute top-0 pointer-events-none bg-foreground/[0.05]"
                      style={{ left: d * dayWidth, width: dayWidth, height: barsHeight }}
                    />
                  ))}

                  {/* Today marker */}
                  {todayOffset != null && (
                    <div className="absolute top-0 z-10 pointer-events-none" style={{ left: todayOffset * dayWidth, height: barsHeight }}>
                      <div className="absolute inset-y-0 -translate-x-1/2 w-px bg-amber-500/80" />
                      <div className="absolute top-0 -translate-x-1/2 rounded-b bg-amber-500 px-1 text-[8px] font-bold leading-tight text-white shadow-sm">TODAY</div>
                    </div>
                  )}

                  <svg className="absolute inset-0 pointer-events-none text-slate-400" width={timelineWidth} height={barsHeight} style={{ overflow: "visible" }}>
                    <defs>
                      <marker id="arrowhead" markerWidth="7" markerHeight="7" refX="5.5" refY="3" orient="auto">
                        <path d="M0,0 L6,3 L0,6 Z" fill="currentColor" />
                      </marker>
                      <marker id="arrowhead-crit" markerWidth="7" markerHeight="7" refX="5.5" refY="3" orient="auto">
                        <path d="M0,0 L6,3 L0,6 Z" fill="#dc2626" />
                      </marker>
                      <marker id="arrowhead-hover" markerWidth="8" markerHeight="8" refX="5.5" refY="3" orient="auto">
                        <path d="M0,0 L6,3 L0,6 Z" fill="#2563eb" />
                      </marker>
                    </defs>
                    {arrows}
                  </svg>

                  {model.rows.map((row, i) => {
                    if (!rowVisible[i]) return null;
                    const top = tops[i] ?? i * ROW_H;
                    const rh = heights[i] ?? ROW_H;
                    const mid = top + rh / 2;
                    if (row.kind === "section") {
                      if (!row.span) return null;
                      // Summary roll-up bar (phase colour) with downward end caps.
                      const c = colorOf(row.phase);
                      const left = row.span.start * dayWidth;
                      const width = Math.max(3, (row.span.end - row.span.start) * dayWidth);
                      return (
                        <div key={`sb-${i}`} className="absolute pointer-events-none" style={{ top, left: 0, width: timelineWidth, height: rh }}>
                          <div className="absolute rounded-sm" style={{ left, width, top: rh / 2 - 3, height: 6, backgroundColor: c, opacity: 0.5 }} />
                          <div className="absolute rounded-sm" style={{ left, width: 3, top: rh / 2 - 3, height: 12, backgroundColor: c }} />
                          <div className="absolute rounded-sm" style={{ left: left + width - 3, width: 3, top: rh / 2 - 3, height: 12, backgroundColor: c }} />
                        </div>
                      );
                    }
                    const a = row.act;
                    const g = model.geom.get(a.id);
                    const s = g?.start ?? Math.max(0, a.startOffsetDays);  // CPM-computed start
                    const isMs = a.isMilestone === 1;
                    // Bar length = CPM calendar span (spans weekends/holidays/leave).
                    const d = isMs ? 0 : (g?.dur ?? Math.max(1, a.durationDays));
                    const isSub = row.kind === "sub";
                    const isCrit = g?.crit ?? false;
                    const lit = isLit(a.id);
                    if (isMs) {
                      // Keep the diamond fully inside the timeline — a day-0 milestone
                      // would otherwise be centred on x=0 and hide its left half under
                      // the frozen activity column.
                      const msLeft = Math.max(0, Math.min(s * dayWidth - 9, timelineWidth - 18));
                      return (
                        <div
                          key={a.id}
                          className="absolute flex items-center justify-center drop-shadow transition-opacity"
                          style={{ top: mid - 9, left: msLeft, width: 18, height: 18, opacity: lit ? 1 : 0.25 }}
                          title={`${a.activity} — milestone${isCrit ? " (critical)" : ""}`}
                          onMouseEnter={() => setHoverId(a.id)}
                          onMouseLeave={() => setHoverId(null)}
                        >
                          <Diamond className={`h-4 w-4 fill-red-500 text-red-600 ${isCrit || hoverId === a.id ? "drop-shadow-[0_0_3px_rgba(220,38,38,0.6)]" : ""}`} />
                        </div>
                      );
                    }
                    // Non-critical bars take their Section's colour; the critical path is red.
                    const c = isCrit ? "#dc2626" : colorOf(a.phase);
                    const barH = isSub ? 12 : 18;
                    const width = Math.max(3, d * dayWidth);
                    const isHovered = hoverId === a.id;
                    const pct = Math.min(100, Math.max(0, a.percentComplete ?? 0));
                    const res = a.resourceId != null ? resourceById.get(a.resourceId) : undefined;
                    return (
                      <div
                        key={a.id}
                        className="absolute rounded-full flex items-center overflow-hidden cursor-default transition-opacity"
                        style={{
                          top: mid - barH / 2,
                          left: s * dayWidth,
                          width,
                          height: barH,
                          // Light track; the DONE portion is the solid colour (P6 progress bar).
                          background: `linear-gradient(180deg, ${c}40, ${c}33)`,
                          boxShadow: isHovered
                            ? `0 0 0 2px #2563eb, 0 1px 4px rgba(0,0,0,0.28)`
                            : (isCrit ? `0 0 0 1.5px ${c}59, 0 1px 3px rgba(0,0,0,0.22)` : "0 1px 2px rgba(0,0,0,0.16)"),
                          opacity: lit ? (isSub ? 0.92 : 1) : 0.2,
                        }}
                        title={`${a.activity} (${d}d)${isCrit ? " — critical path" : ""}${res ? ` · ${res.name}` : ""} · ${pct}% complete`}
                        onMouseEnter={() => setHoverId(a.id)}
                        onMouseLeave={() => setHoverId(null)}
                      >
                        {/* Completed-progress fill */}
                        {pct > 0 && (
                          <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct}%`, background: `linear-gradient(180deg, ${c}, ${c}cc)` }} />
                        )}
                        {/* Assignee avatar chip on the bar */}
                        {res && width >= 26 && (
                          <span
                            className="relative z-10 ml-0.5 flex items-center justify-center rounded-full text-[8px] font-bold shrink-0 ring-1 ring-white/60"
                            style={{ width: barH - 4, height: barH - 4, backgroundColor: res.color ?? c, color: contrastText(res.color ?? c) }}
                            title={`${res.name}${res.role ? ` — ${res.role}` : ""}`}
                          >
                            {initials(res.name)}
                          </span>
                        )}
                        {width >= 46 && (
                          <span className="relative z-10 px-1 text-[9px] font-semibold leading-none text-white/95 whitespace-nowrap truncate mix-blend-luminosity">{pct ? `${pct}%` : `${d}d`}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Inline click-to-edit text ────────────────────────────────────────────────
function EditableText({ value, onSave, className, title }: { value: string; onSave: (v: string) => void; className?: string; title?: string }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  if (!editing) {
    return (
      <span className={`cursor-text hover:underline decoration-dotted underline-offset-2 ${className ?? ""}`} title={title ?? "Click to edit"} onClick={() => setEditing(true)}>
        {value || "Untitled"}
      </span>
    );
  }
  return (
    <input
      autoFocus
      value={v}
      onChange={e => setV(e.target.value)}
      onBlur={() => { setEditing(false); if (v.trim() && v !== value) onSave(v.trim()); else setV(value); }}
      onKeyDown={e => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") { setV(value); setEditing(false); }
      }}
      className={`bg-background border border-input rounded px-1 py-0.5 outline-none focus:ring-1 focus:ring-ring ${className ?? ""}`}
    />
  );
}

// ── Per-activity popover editor (dates, duration, milestone, typed deps) ─────
function ActivityEditor({ act, all, commencementDate, computedStart, onPatch }: {
  act: ScheduleActivity;
  all: ScheduleActivity[];
  commencementDate: string | null;
  /** CPM-computed (early) start of this activity — shown when links drive the date. */
  computedStart: number;
  onPatch: (id: number, partial: Partial<ScheduleActivity>) => void;
}) {
  const deps = parseDependencies(act);
  const depMap = new Map<number, Dependency>(deps.map(d => [d.id, d]));
  const hasDeps = deps.length > 0;
  const start = Math.max(0, act.startOffsetDays);
  const startDateStr = commencementDate ? toInputDate(offsetToDate(commencementDate, start)) : "";

  // Persist the whole typed link set (server keeps the legacy id mirror in sync).
  const saveDeps = (next: Map<number, Dependency>) =>
    onPatch(act.id, { dependencies: serializeDependencies([...next.values()]) });
  const togglePred = (id: number) => {
    const next = new Map(depMap);
    if (next.has(id)) next.delete(id); else next.set(id, { id, type: "FS", lag: 0 });
    saveDeps(next);
  };
  const setType = (id: number, type: RelType) => {
    const cur = depMap.get(id); if (!cur) return;
    const next = new Map(depMap); next.set(id, { ...cur, type }); saveDeps(next);
  };
  const setLag = (id: number, lag: number) => {
    const cur = depMap.get(id); if (!cur) return;
    const next = new Map(depMap); next.set(id, { ...cur, lag: Math.round(lag) || 0 }); saveDeps(next);
  };

  const candidates = all.filter(a => a.id !== act.id);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-foreground" title="Edit dates, duration, dependencies"><Pencil className="h-3.5 w-3.5" /></Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 max-h-[80vh] overflow-y-auto space-y-3" align="end" collisionPadding={12}>
        <div className="space-y-1">
          <Label className="text-xs">Activity name</Label>
          <Input defaultValue={act.activity} className="h-8" onBlur={e => { const v = e.target.value.trim(); if (v && v !== act.activity) onPatch(act.id, { activity: v }); }} />
        </div>

        <div className="flex items-center justify-between">
          <Label className="text-xs">Milestone (zero duration)</Label>
          <Switch checked={act.isMilestone === 1} onCheckedChange={c => onPatch(act.id, { isMilestone: c ? 1 : 0 })} />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Start{commencementDate ? " date" : " (day offset)"}</Label>
            {hasDeps ? (
              <div
                className="h-8 flex items-center gap-1 rounded border border-dashed border-border px-2 text-xs text-muted-foreground"
                title="Start is driven by this activity's predecessors (CPM). Change the links or their lag to move it."
              >
                {commencementDate ? fmtDate(commencementDate, computedStart) : `day ${computedStart}`}
                <span className="text-[10px] opacity-70">· auto</span>
              </div>
            ) : commencementDate ? (
              <Input type="date" className="h-8" defaultValue={startDateStr} onChange={e => { if (e.target.value) onPatch(act.id, { startOffsetDays: dateToOffset(commencementDate, e.target.value) }); }} />
            ) : (
              <Input type="number" min={0} className="h-8" defaultValue={start} onBlur={e => onPatch(act.id, { startOffsetDays: Math.max(0, parseInt(e.target.value) || 0) })} />
            )}
          </div>
          {act.isMilestone !== 1 && (
            <div className="space-y-1">
              <Label className="text-xs">Duration (days)</Label>
              <Input type="number" min={1} className="h-8" defaultValue={act.durationDays} onBlur={e => onPatch(act.id, { durationDays: Math.max(1, parseInt(e.target.value) || 1) })} />
            </div>
          )}
        </div>

        <div className="space-y-1">
          <Label className="text-xs flex items-center gap-1"><Link2 className="h-3 w-3" /> Predecessors (depends on)</Label>
          <p className="text-[10px] text-muted-foreground">Tick a predecessor, then pick the link type (FS/SS/FF/SF) and an optional lag in days. Dates and the critical path recalculate automatically.</p>
          <div className="max-h-56 overflow-y-auto rounded border border-border divide-y divide-border/50">
            {candidates.length === 0 && <div className="px-2 py-2 text-xs text-muted-foreground">No other activities yet.</div>}
            {candidates.map(c => {
              const dep = depMap.get(c.id);
              return (
                <div key={c.id} className="px-2 py-1.5 text-xs hover:bg-muted/40">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <Checkbox className="mt-0.5 shrink-0" checked={!!dep} onCheckedChange={() => togglePred(c.id)} />
                    <span className="flex-1 break-words leading-snug">
                      {c.phase && <span className="text-muted-foreground">{c.phase} · </span>}{c.activity}
                    </span>
                    {dep && <span className="shrink-0 text-[10px] font-medium text-primary mt-0.5">{relLabel(dep.type, dep.lag)}</span>}
                  </label>
                  {dep && (
                    <div className="mt-1 flex items-center gap-2 pl-6">
                      <select
                        value={dep.type}
                        onChange={e => setType(c.id, e.target.value as RelType)}
                        className="h-6 rounded border border-input bg-background px-1 text-[11px] outline-none focus:ring-1 focus:ring-ring"
                        title={REL_LABELS[dep.type]}
                      >
                        {REL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <span className="text-[10px] text-muted-foreground truncate">{REL_LABELS[dep.type]}</span>
                      <div className="ml-auto flex items-center gap-1">
                        <span className="text-[10px] text-muted-foreground">lag</span>
                        <Input type="number" defaultValue={dep.lag} className="h-6 w-14 text-[11px]" onBlur={e => setLag(c.id, parseInt(e.target.value) || 0)} />
                        <span className="text-[10px] text-muted-foreground">d</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Notes</Label>
          <Textarea defaultValue={act.notes ?? ""} className="min-h-[56px] text-xs" onBlur={e => onPatch(act.id, { notes: e.target.value })} />
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── Per-activity multi-resource assignment (P6) + leave-conflict resolver ─────
function MultiAssignee({ assigns, resources, conflict, leaveByResource, isMilestone, activityCost, currency, onAdd, onPatch, onDelete, onManage }: {
  assigns: ActivityResourceRow[];
  resources: ProjectResource[];
  conflict: { resourceId: number; days: number } | null;
  leaveByResource: Map<number, Set<string>>;
  isMilestone: boolean;
  activityCost: number;
  currency: string;
  onAdd: (body: Partial<ActivityResourceRow>) => void;
  onPatch: (assignId: number, body: Partial<ActivityResourceRow>) => void;
  onDelete: (assignId: number) => void;
  onManage: () => void;
}) {
  const byId = new Map(resources.map(r => [r.id, r] as const));
  const assignedIds = new Set(assigns.map(a => a.resourceId));
  const free = resources.filter(r => !assignedIds.has(r.id) && (leaveByResource.get(r.id)?.size ?? 0) === 0);
  const unassignedRes = resources.filter(r => !assignedIds.has(r.id));
  const conflictRes = conflict ? byId.get(conflict.resourceId) : undefined;
  const [open, setOpen] = useState(false);

  // Reassign the conflicted driving resource to a leave-free one (and drop it).
  const reassignTo = (newRid: number) => {
    onAdd({ resourceId: newRid, isDriving: 1, allocationPct: 100, unitsPerDay: "1" });
    const old = assigns.find(a => a.resourceId === conflict?.resourceId);
    if (old) onDelete(old.id);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex items-center gap-0.5 rounded-full border border-border bg-background px-1 h-5 hover:bg-muted/50" title="Manage assigned resources">
          {assigns.length === 0 ? (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground px-0.5"><UserPlus className="h-3 w-3" /> Assign</span>
          ) : (
            <span className="flex items-center -space-x-1">
              {assigns.slice(0, 3).map(a => {
                const r = byId.get(a.resourceId);
                const c = r?.color ?? "#64748b";
                return (
                  <span key={a.id} className="flex items-center justify-center rounded-full text-[7px] font-bold ring-1 ring-card" style={{ width: 14, height: 14, backgroundColor: c, color: contrastText(c) }} title={r?.name}>
                    {r ? initials(r.name) : "?"}
                  </span>
                );
              })}
              {assigns.length > 3 && <span className="pl-1.5 text-[9px] text-muted-foreground">+{assigns.length - 3}</span>}
            </span>
          )}
          {conflict && <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 max-h-[75vh] overflow-y-auto space-y-2.5" align="start" collisionPadding={12}>
        <div className="flex items-center justify-between">
          <Label className="text-xs font-semibold">Assigned resources</Label>
          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px] text-muted-foreground" onClick={onManage}>Manage team…</Button>
        </div>

        {/* Live cost feedback — why the COST column shows what it does. A milestone
            has zero duration, so any resources on it carry NO cost (assign to real
            work activities to see cost). */}
        {isMilestone ? (
          <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-700 dark:text-amber-400">
            This is a <span className="font-semibold">milestone</span> (zero duration) — resources here carry <span className="font-semibold">no cost</span>. Assign them to work activities instead.
          </div>
        ) : assigns.length > 0 ? (
          <div className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5 text-[11px] flex items-center justify-between">
            <span className="text-muted-foreground">Activity cost</span>
            <span className="font-semibold tabular-nums">{fmtMoney(activityCost, currency)}</span>
          </div>
        ) : null}

        {conflict && conflictRes && (
          <div className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] space-y-1.5">
            <div className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" />
              <span><span className="font-semibold">{conflictRes.name}</span> is on leave for {conflict.days} day{conflict.days === 1 ? "" : "s"} during this activity. The bar was <span className="font-medium">auto-extended</span> to skip the leave.</span>
            </div>
            {free.length > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground">Reassign to:</span>
                <select className="h-6 flex-1 rounded border border-input bg-background px-1 text-[11px] outline-none" defaultValue="" onChange={e => { if (e.target.value) reassignTo(Number(e.target.value)); }}>
                  <option value="">a free resource…</option>
                  {free.map(r => <option key={r.id} value={r.id}>{r.name}{r.role ? ` (${r.role})` : ""}</option>)}
                </select>
              </div>
            )}
          </div>
        )}

        {assigns.length === 0 && <p className="text-[11px] text-muted-foreground">No resources assigned yet.</p>}
        <div className="space-y-1.5">
          {assigns.map(a => {
            const r = byId.get(a.resourceId);
            const c = r?.color ?? "#64748b";
            const onLeave = (leaveByResource.get(a.resourceId)?.size ?? 0) > 0 && conflict?.resourceId === a.resourceId;
            return (
              <div key={a.id} className="flex items-center gap-1.5 rounded border border-border px-1.5 py-1">
                <span className="flex items-center justify-center rounded-full text-[8px] font-bold shrink-0" style={{ width: 18, height: 18, backgroundColor: c, color: contrastText(c) }}>{r ? initials(r.name) : "?"}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1 text-[11px] font-medium truncate">{r?.name ?? "?"}{onLeave && <AlertTriangle className="h-2.5 w-2.5 text-amber-500" />}</div>
                  <div className="flex items-center gap-1 mt-0.5">
                    <input type="number" min={1} max={1000} defaultValue={a.allocationPct} className="h-5 w-11 rounded border border-input bg-background px-1 text-[10px] outline-none" title="Allocation %" onBlur={e => { const v = Math.max(1, Math.round(Number(e.target.value) || 100)); if (v !== a.allocationPct) onPatch(a.id, { allocationPct: v }); }} />
                    <span className="text-[9px] text-muted-foreground">%</span>
                    <input type="number" min={1} step={0.5} defaultValue={Number(a.unitsPerDay)} className="h-5 w-11 rounded border border-input bg-background px-1 text-[10px] outline-none" title="Units (e.g. 2 machines)" onBlur={e => { const v = Math.max(0.5, Number(e.target.value) || 1); if (v !== Number(a.unitsPerDay)) onPatch(a.id, { unitsPerDay: String(v) }); }} />
                    <span className="text-[9px] text-muted-foreground">×</span>
                  </div>
                </div>
                <button type="button" className={`text-[9px] px-1 py-0.5 rounded ${a.isDriving === 1 ? "bg-primary/15 text-primary font-semibold" : "text-muted-foreground hover:bg-muted"}`} title="The driving resource governs the activity's calendar & dates" onClick={() => { if (a.isDriving !== 1) onPatch(a.id, { isDriving: 1 }); }}>
                  {a.isDriving === 1 ? "★ driving" : "set driving"}
                </button>
                <Button size="icon" variant="ghost" className="h-5 w-5 text-destructive hover:bg-destructive/10 shrink-0" title="Remove" onClick={() => onDelete(a.id)}><X className="h-3 w-3" /></Button>
              </div>
            );
          })}
        </div>

        {unassignedRes.length > 0 && (
          <div className="flex items-center gap-1.5 pt-0.5">
            <UserPlus className="h-3.5 w-3.5 text-muted-foreground" />
            <select className="h-7 flex-1 rounded border border-input bg-background px-1 text-[11px] outline-none" defaultValue="" onChange={e => { if (e.target.value) { onAdd({ resourceId: Number(e.target.value), allocationPct: 100, unitsPerDay: "1" }); e.currentTarget.value = ""; } }}>
              <option value="">Add a resource…</option>
              {unassignedRes.map(r => <option key={r.id} value={r.id}>{r.name}{r.role ? ` (${r.role})` : ""}</option>)}
            </select>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ── Per-activity % complete: a clickable mini progress bar (click to edit) ────
function PercentInline({ value, color, onChange }: { value: number; color: string; onChange: (pct: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(String(value));
  useEffect(() => { setV(String(value)); }, [value]);
  if (editing) {
    return (
      <input
        autoFocus type="number" min={0} max={100} value={v}
        onChange={e => setV(e.target.value)}
        onBlur={() => { setEditing(false); const n = Math.min(100, Math.max(0, Math.round(Number(v) || 0))); if (n !== value) onChange(n); }}
        onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setV(String(value)); setEditing(false); } }}
        className="h-5 w-12 rounded border border-input bg-background px-1 text-[10px] outline-none focus:ring-1 focus:ring-ring"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="group inline-flex items-center gap-1 h-5 rounded px-1 hover:bg-muted/60"
      title="Click to set % complete"
    >
      <span className="h-1.5 w-12 rounded-full bg-foreground/15 overflow-hidden">
        <span className="block h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, value))}%`, backgroundColor: color }} />
      </span>
      <span className="text-[10px] tabular-nums text-muted-foreground group-hover:text-foreground w-7">{value}%</span>
    </button>
  );
}

// ── Project Resources / Calendar manager (tabbed: Team · Calendar · Costs) ────
function ResourcePanel({ resources, stats, unassignedCount, calendar, calRow, leaveByResource, projectCurrency, projectCost, projectPowerKw, onAdd, onPatch, onDelete, onSaveCalendar, onAddLeave, onDeleteLeave, onClose, onFilter }: {
  resources: ProjectResource[];
  stats: Map<number, { count: number; days: number; pct: number; cost: number }>;
  unassignedCount: number;
  calendar: WorkCalendar;
  calRow: ProjectCalendarRow | undefined;
  leaveByResource: Map<number, ResourceLeaveRow[]>;
  projectCurrency: string;
  projectCost: number;
  projectPowerKw: number;
  onAdd: (body: Partial<ProjectResource>) => void;
  onPatch: (id: number, body: Partial<ProjectResource>) => void;
  onDelete: (id: number) => void;
  onSaveCalendar: (body: Partial<WorkCalendar> & { name?: string; preset?: string | null }) => void;
  onAddLeave: (resourceId: number, body: Partial<ResourceLeaveRow>) => void;
  onDeleteLeave: (resourceId: number, lid: number) => void;
  onClose: () => void;
  onFilter: (rid: "all" | "unassigned" | number) => void;
}) {
  const [tab, setTab] = useState<"team" | "calendar" | "costs">("team");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const add = () => { if (!name.trim()) return; onAdd({ name: name.trim(), role: role.trim() || undefined }); setName(""); setRole(""); };
  const TabBtn = ({ id, icon, label }: { id: typeof tab; icon: ReactNode; label: string }) => (
    <button type="button" onClick={() => setTab(id)} className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium ${tab === id ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}>{icon}{label}</button>
  );
  return (
    <div className="border-b border-border bg-muted/20 px-4 py-3">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-1 rounded-md bg-muted/60 p-0.5">
          <TabBtn id="team" icon={<Users className="h-3.5 w-3.5" />} label={`Team${resources.length ? ` (${resources.length})` : ""}`} />
          <TabBtn id="calendar" icon={<CalendarDays className="h-3.5 w-3.5" />} label="Calendar" />
          <TabBtn id="costs" icon={<Coins className="h-3.5 w-3.5" />} label="Costs" />
        </div>
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onClose} title="Close"><X className="h-4 w-4" /></Button>
      </div>

      {tab === "team" && (
        <>
          <div className="flex items-end gap-2 flex-wrap mb-3">
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">Name</Label>
              <Input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") add(); }} placeholder="e.g. Ahmed Khan / Tower Crane" className="h-8 w-44" />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">Role / trade</Label>
              <Input value={role} onChange={e => setRole(e.target.value)} onKeyDown={e => { if (e.key === "Enter") add(); }} placeholder="e.g. Site Engineer" className="h-8 w-44" />
            </div>
            <Button size="sm" className="h-8" onClick={add} disabled={!name.trim()}><UserPlus className="h-3.5 w-3.5 mr-1.5" /> Add</Button>
          </div>
          {resources.length === 0 ? (
            <p className="text-xs text-muted-foreground">No resources yet. Add people or equipment above, then assign them to activities.</p>
          ) : (
            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {resources.map(r => {
                const st = stats.get(r.id) ?? { count: 0, days: 0, pct: 0, cost: 0 };
                return (
                  <div key={r.id} className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5">
                    <input type="color" value={r.color ?? "#2563eb"} onChange={e => onPatch(r.id, { color: e.target.value })} className="h-7 w-7 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0" title="Resource colour" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <EditableText value={r.name} onSave={v => onPatch(r.id, { name: v })} className="text-xs font-medium truncate" />
                        {r.kind === "equipment" && <Zap className="h-2.5 w-2.5 text-amber-500 shrink-0" />}
                      </div>
                      <EditableText value={r.role ?? "—"} onSave={v => onPatch(r.id, { role: v })} className="text-[10px] text-muted-foreground truncate" />
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <span className="h-1.5 w-12 rounded-full bg-foreground/15 overflow-hidden"><span className="block h-full rounded-full" style={{ width: `${st.pct}%`, backgroundColor: r.color ?? "#2563eb" }} /></span>
                        <span className="text-[9px] tabular-nums text-muted-foreground whitespace-nowrap">
                          {r.rate ? `${fmtMoney(Number(r.rate), r.currency ?? projectCurrency)}/${r.rateBasis === "hourly" ? "h" : "d"} · ` : ""}{st.count} act · {st.days}d
                        </span>
                      </div>
                    </div>
                    <ResourceEditor r={r} leave={leaveByResource.get(r.id) ?? []} projectCurrency={projectCurrency} onPatch={b => onPatch(r.id, b)} onAddLeave={b => onAddLeave(r.id, b)} onDeleteLeave={lid => onDeleteLeave(r.id, lid)} />
                    <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" title="Show only this resource's activities" onClick={() => onFilter(r.id)}><Filter className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0 text-destructive hover:bg-destructive/10" title="Remove (its activities become unassigned)" onClick={() => { if (confirm(`Remove ${r.name}? Their activities will become unassigned.`)) onDelete(r.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                );
              })}
              {unassignedCount > 0 && (
                <button type="button" onClick={() => onFilter("unassigned")} className="flex items-center gap-2 rounded-md border border-dashed border-border bg-card px-2 py-1.5 text-left hover:bg-muted/40" title="Show unassigned activities">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-dashed border-muted-foreground text-[10px] text-muted-foreground">?</span>
                  <div className="text-xs"><div className="font-medium">Unassigned</div><div className="text-[10px] text-muted-foreground">{unassignedCount} activit{unassignedCount === 1 ? "y" : "ies"}</div></div>
                </button>
              )}
            </div>
          )}
        </>
      )}

      {tab === "calendar" && <CalendarEditor calendar={calendar} calRow={calRow} onSave={onSaveCalendar} />}

      {tab === "costs" && (
        <div className="space-y-2.5">
          <div className="flex flex-wrap gap-3">
            <div className="rounded-md border border-border bg-card px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Total resource cost</div>
              <div className="text-lg font-semibold tabular-nums">{fmtMoney(projectCost, projectCurrency)}</div>
            </div>
            {projectPowerKw > 0 && (
              <div className="rounded-md border border-border bg-card px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Connected load</div>
                <div className="text-lg font-semibold tabular-nums flex items-center gap-1"><Zap className="h-4 w-4 text-amber-500" />{projectPowerKw.toLocaleString()} kW</div>
              </div>
            )}
          </div>
          <div className="rounded-md border border-border bg-card divide-y divide-border/50">
            {resources.filter(r => (stats.get(r.id)?.cost ?? 0) > 0).sort((a, b) => (stats.get(b.id)?.cost ?? 0) - (stats.get(a.id)?.cost ?? 0)).map(r => {
              const st = stats.get(r.id)!;
              const pct = projectCost > 0 ? Math.round((st.cost / projectCost) * 100) : 0;
              return (
                <div key={r.id} className="flex items-center gap-2 px-2.5 py-1.5 text-xs">
                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: r.color ?? "#2563eb" }} />
                  <span className="flex-1 truncate">{r.name}<span className="text-muted-foreground"> · {r.rateBasis === "hourly" ? `${fmtMoney(Number(r.rate), r.currency ?? projectCurrency)}/h` : `${fmtMoney(Number(r.rate), r.currency ?? projectCurrency)}/d`}</span></span>
                  <span className="w-10 text-right text-muted-foreground tabular-nums">{pct}%</span>
                  <span className="w-24 text-right font-medium tabular-nums">{fmtMoney(st.cost, r.currency ?? projectCurrency)}</span>
                </div>
              );
            })}
            {resources.filter(r => (stats.get(r.id)?.cost ?? 0) > 0).length === 0 && (
              <div className="px-2.5 py-3 text-xs text-muted-foreground">No costs yet. Give resources a rate (in the Team tab) and assign them to activities.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Per-resource attribute + leave editor (popover from a resource card) ─────
function ResourceEditor({ r, leave, projectCurrency, onPatch, onAddLeave, onDeleteLeave }: {
  r: ProjectResource;
  leave: ResourceLeaveRow[];
  projectCurrency: string;
  onPatch: (body: Partial<ProjectResource>) => void;
  onAddLeave: (body: Partial<ResourceLeaveRow>) => void;
  onDeleteLeave: (lid: number) => void;
}) {
  const [lf, setLf] = useState("");
  const [lt, setLt] = useState("");
  const addLeave = () => { if (!lf) return; onAddLeave({ fromDate: lf, toDate: lt || lf, type: "vacation" }); setLf(""); setLt(""); };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground" title="Edit cost, type, power, capacity & leave"><Pencil className="h-3.5 w-3.5" /></Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 max-h-[75vh] overflow-y-auto space-y-2.5" align="end" collisionPadding={12}>
        <Label className="text-xs font-semibold">{r.name}</Label>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Type</Label>
            <select value={r.kind ?? "labour"} onChange={e => onPatch({ kind: e.target.value })} className="h-7 w-full rounded border border-input bg-background px-1 text-[11px] outline-none">
              <option value="labour">Labour</option>
              <option value="equipment">Equipment</option>
              <option value="material">Material</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Status</Label>
            <select value={r.status ?? "active"} onChange={e => onPatch({ status: e.target.value })} className="h-7 w-full rounded border border-input bg-background px-1 text-[11px] outline-none">
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1 col-span-2">
            <Label className="text-[10px] text-muted-foreground">Rate</Label>
            <Input type="number" min={0} step="0.001" defaultValue={r.rate ?? ""} className="h-7 text-[11px]" placeholder="0.000" onBlur={e => onPatch({ rate: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Per</Label>
            <select value={r.rateBasis ?? "daily"} onChange={e => onPatch({ rateBasis: e.target.value })} className="h-7 w-full rounded border border-input bg-background px-1 text-[11px] outline-none">
              <option value="daily">day</option>
              <option value="hourly">hour</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Currency</Label>
            <Input defaultValue={r.currency ?? projectCurrency} className="h-7 text-[11px]" onBlur={e => onPatch({ currency: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Capacity</Label>
            <Input type="number" min={1} defaultValue={r.capacity ?? 1} className="h-7 text-[11px]" onBlur={e => onPatch({ capacity: Math.max(1, Math.round(Number(e.target.value) || 1)) })} />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Power kW</Label>
            <Input type="number" min={0} step="0.001" defaultValue={r.powerKw ?? ""} className="h-7 text-[11px]" placeholder="—" onBlur={e => onPatch({ powerKw: e.target.value })} />
          </div>
        </div>

        <div className="space-y-1.5 pt-1 border-t border-border/60">
          <Label className="text-[10px] font-semibold flex items-center gap-1"><CalendarDays className="h-3 w-3" /> Leave / vacation</Label>
          {leave.length > 0 && (
            <div className="space-y-1">
              {leave.map(l => (
                <div key={l.id} className="flex items-center gap-1.5 text-[10px] rounded bg-muted/50 px-1.5 py-1">
                  <span className="flex-1 tabular-nums">{l.fromDate} → {l.toDate}</span>
                  <span className="text-muted-foreground">{l.type}</span>
                  <button type="button" className="text-destructive hover:bg-destructive/10 rounded p-0.5" onClick={() => onDeleteLeave(l.id)}><X className="h-3 w-3" /></button>
                </div>
              ))}
            </div>
          )}
          {/* Stacked so two native date pickers never cram/overflow a narrow popover. */}
          <div className="grid grid-cols-2 gap-1.5">
            <div className="space-y-0.5">
              <Label className="text-[9px] text-muted-foreground">From</Label>
              <Input type="date" value={lf} onChange={e => setLf(e.target.value)} className="h-7 w-full text-[10px]" />
            </div>
            <div className="space-y-0.5">
              <Label className="text-[9px] text-muted-foreground">To</Label>
              <Input type="date" value={lt} onChange={e => setLt(e.target.value)} className="h-7 w-full text-[10px]" />
            </div>
          </div>
          <Button size="sm" variant="outline" className="h-7 w-full" disabled={!lf} onClick={addLeave}><Plus className="h-3 w-3 mr-1" /> Add leave</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── Project work-calendar editor (weekends, hours/day, holidays, presets) ─────
function CalendarEditor({ calendar, calRow, onSave }: {
  calendar: WorkCalendar;
  calRow: ProjectCalendarRow | undefined;
  onSave: (body: Partial<WorkCalendar> & { name?: string; preset?: string | null }) => void;
}) {
  const weekend = new Set(calendar.weekendDays);
  const toggleDay = (d: number) => {
    const next = new Set(weekend); next.has(d) ? next.delete(d) : next.add(d);
    onSave({ weekendDays: [...next] });
  };
  const applyPreset = (key: string) => {
    const p = CALENDAR_PRESETS.find(x => x.key === key);
    if (!p) return;
    onSave({ weekendDays: p.weekendDays, hoursPerDay: p.hoursPerDay, holidays: p.holidays, preset: p.key });
  };
  const holidays = calendar.holidays ?? [];
  const [hd, setHd] = useState("");
  const [hn, setHn] = useState("");
  const addHoliday = () => {
    if (!hd) return;
    onSave({ holidays: [...holidays, { date: hd, name: hn || undefined }] });
    setHd(""); setHn("");
  };
  const removeHoliday = (idx: number) => onSave({ holidays: holidays.filter((_, i) => i !== idx) });
  return (
    <div className="space-y-3 max-w-xl">
      <div className="flex items-end gap-2 flex-wrap">
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">Region preset</Label>
          <select defaultValue={calRow?.preset ?? ""} onChange={e => { if (e.target.value) applyPreset(e.target.value); }} className="h-8 rounded border border-input bg-background px-2 text-xs outline-none">
            <option value="">Choose a preset…</option>
            {CALENDAR_PRESETS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">Working hours / day</Label>
          <Input type="number" min={1} max={24} step="0.5" defaultValue={calendar.hoursPerDay} className="h-8 w-28" onBlur={e => onSave({ hoursPerDay: Math.min(24, Math.max(1, Number(e.target.value) || 8)) })} />
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">Weekend (non-working) days</Label>
        <div className="flex gap-1">
          {WEEKDAY_LABELS.map((lbl, d) => (
            <button key={d} type="button" onClick={() => toggleDay(d)} className={`h-8 w-11 rounded border text-xs font-medium ${weekend.has(d) ? "border-amber-500/60 bg-amber-500/15 text-amber-700 dark:text-amber-400" : "border-border bg-background text-muted-foreground hover:bg-muted/50"}`} title={weekend.has(d) ? "Non-working — click to make working" : "Working — click to make weekend"}>
              {lbl}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground">GCC default is Fri + Sat. Highlighted days are non-working and are shaded on the Gantt.</p>
      </div>

      <div className="space-y-1.5">
        <Label className="text-[10px] text-muted-foreground">Public holidays</Label>
        {holidays.length > 0 && (
          <div className="grid gap-1 sm:grid-cols-2">
            {holidays.map((h, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[11px] rounded border border-border bg-card px-2 py-1">
                <span className="tabular-nums">{h.date ?? `${h.from}→${h.to}`}</span>
                <span className="flex-1 truncate text-muted-foreground">{h.name ?? ""}</span>
                <button type="button" className="text-destructive hover:bg-destructive/10 rounded p-0.5" onClick={() => removeHoliday(i)}><X className="h-3 w-3" /></button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <Input type="date" value={hd} onChange={e => setHd(e.target.value)} className="h-8 w-40 text-xs" />
          <Input value={hn} onChange={e => setHn(e.target.value)} placeholder="Holiday name (optional)" className="h-8 flex-1 text-xs" onKeyDown={e => { if (e.key === "Enter") addHoliday(); }} />
          <Button size="sm" variant="outline" className="h-8" disabled={!hd} onClick={addHoliday}><Plus className="h-3.5 w-3.5 mr-1" /> Add</Button>
        </div>
        <p className="text-[10px] text-muted-foreground">Tip: movable Islamic dates (Eid, etc.) shift each year — add them here for the project year. Presets seed fixed national days only.</p>
      </div>
    </div>
  );
}
