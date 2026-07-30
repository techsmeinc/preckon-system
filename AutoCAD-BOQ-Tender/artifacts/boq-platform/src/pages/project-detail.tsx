import { useState, useRef, useMemo } from "react";
import { useParams } from "wouter";
import {
  useGetProject,
  getGetProjectQueryKey,
} from "@workspace/api-client-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TechnicalNarrativeTab } from "@/components/tabs/technical-narrative-tab";
import { WorkProgramme } from "@/components/work-programme";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, Upload, MessageSquare, Loader2, Sparkles, Plus, Search, X, FileSpreadsheet, CalendarClock, Diamond, Pencil, Trash2, CheckCircle2, Eye, PencilRuler, Shapes, RefreshCw } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const DOCUMENT_TYPES = [
  { value: "drawing", label: "Drawing" },
  { value: "tender", label: "Tender" },
  { value: "rfp", label: "RFP" },
  { value: "sow", label: "SOW" },
  { value: "addendum", label: "Addendum" },
  { value: "specification", label: "Specification" },
  { value: "other", label: "Other" },
] as const;
import { format } from "date-fns";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { ModelSelector } from "@/components/model-selector";
import { useModelPreference } from "@/hooks/use-model-preference";
import {
  MultiAgentPipeline,
  VerificationBadge,
  EMPTY_PIPELINE,
  type PipelineState,
  type AgentState,
  type AgentDescriptor,
  type VerificationSummary,
} from "@/components/multi-agent-pipeline";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PdfViewer } from "@/components/pdf-viewer";
import { DocxViewer } from "@/components/docx-viewer";
import { CadViewer } from "@/components/cad-viewer";
import { CadGlViewer } from "@/components/cad-gl-viewer";
import { CadGeometryEditor } from "@/components/cad-geometry-editor";
import { CadEditor } from "@/components/cad-editor";

const IDLE: AgentState = { status: "idle", message: "" };
const INITIAL_PIPELINE: PipelineState = EMPTY_PIPELINE;

interface ScheduleActivity {
  id: number;
  projectId: number;
  seq: number;
  phase: string | null;
  sowRef: string | null;
  activity: string;
  durationDays: number;
  startOffsetDays: number;
  predecessor: string | null;
  isMilestone: number;
  notes: string | null;
}

const DAYS_PER_WEEK = 7;

export function ProjectDetail() {
  const { id } = useParams();
  const projectId = Number(id);
  const [activeTab, setActiveTab] = useState("documents");
  const [isUploading, setIsUploading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isScheduling, setIsScheduling] = useState(false);
  const [scheduleProgress, setScheduleProgress] = useState<string[]>([]);
  const [isMultiAgent, setIsMultiAgent] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<string[]>([]);
  const [pipeline, setPipeline] = useState<PipelineState>(INITIAL_PIPELINE);
  const [verificationSummary, setVerificationSummary] = useState<VerificationSummary | null>(null);
  const [showPipeline, setShowPipeline] = useState(false);
  const [boqSearch, setBoqSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  // BOQ export details (Project Location / Submitted to / Quotation Ref /
  // Submission Date) — saved on the project and stamped onto the export header.
  const [exportDetailsOpen, setExportDetailsOpen] = useState(false);
  const [isSavingDetails, setIsSavingDetails] = useState(false);
  const [exportDetails, setExportDetails] = useState({
    location: "",
    client: "",
    quotationRef: "",
    submissionDate: "",
  });
  const emptyDraft = {
    category: "",
    itemCode: "",
    description: "",
    unit: "",
    quantity: "",
    unitPrice: "",
    notes: "",
  };
  const [newItem, setNewItem] = useState(emptyDraft);
  // Human-in-the-loop edit/delete state.
  const [editId, setEditId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState(emptyDraft);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [approvingId, setApprovingId] = useState<number | null>(null);
  const [isBulkApproving, setIsBulkApproving] = useState(false);
  const [isApprovingReviewed, setIsApprovingReviewed] = useState(false);
  const [deleteDocId, setDeleteDocId] = useState<number | null>(null);
  const [isDeletingDoc, setIsDeletingDoc] = useState(false);
  // Document currently open in the in-portal preview dialog.
  const [viewDoc, setViewDoc] = useState<{ id: number; originalName: string; mimeType?: string | null } | null>(null);
  const [editDoc, setEditDoc] = useState<{ id: number; originalName: string } | null>(null);
  const [geomEditDoc, setGeomEditDoc] = useState<{ id: number; originalName: string } | null>(null);
  // When the WebGL CAD viewer can't render a drawing, fall back to the server SVG.
  const [cadSvgFallback, setCadSvgFallback] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { pref, providerConfig } = useModelPreference();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: project, isLoading } = useGetProject(projectId, {
    query: { enabled: !!projectId, queryKey: getGetProjectQueryKey(projectId) }
  });

  // Work-programme (schedule) activities for this project — same source the
  // standalone /schedule page reads, surfaced here as an in-project tab.
  const scheduleKey = ["schedule", projectId] as const;
  const { data: scheduleActivities, isLoading: scheduleLoading } = useQuery<ScheduleActivity[]>({
    queryKey: scheduleKey,
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/schedule`);
      if (!res.ok) throw new Error("Failed to load schedule");
      return res.json();
    },
  });

  const scheduleWeeks = useMemo(() => {
    if (!scheduleActivities || scheduleActivities.length === 0) return 0;
    const maxWeekIdx = scheduleActivities.reduce((m, a) => {
      const start = Math.max(0, a.startOffsetDays);
      const isMs = a.isMilestone === 1;
      const dur = Math.max(isMs ? 0 : 1, a.durationDays);
      const wIdx = isMs
        ? Math.floor(start / DAYS_PER_WEEK)
        : Math.floor((start + Math.max(dur - 1, 0)) / DAYS_PER_WEEK);
      return Math.max(m, wIdx);
    }, 0);
    return Math.min(104, maxWeekIdx + 1);
  }, [scheduleActivities]);

  const scheduleTotalDays = useMemo(
    () => (scheduleActivities ?? []).reduce((m, a) => Math.max(m, a.startOffsetDays + a.durationDays), 0),
    [scheduleActivities],
  );

  // Prefill the export-details form from the project's saved values, then open it.
  const openExportDetails = () => {
    setExportDetails({
      location: project?.location ?? "",
      client: project?.client ?? "",
      quotationRef: project?.quotationRef ?? "",
      submissionDate: project?.submissionDate ?? "",
    });
    setExportDetailsOpen(true);
  };

  const handleSaveExportDetails = async () => {
    setIsSavingDetails(true);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(exportDetails),
      });
      if (!res.ok) throw new Error("Update failed");
      await queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
      toast({ title: "Saved", description: "Export details updated. They'll appear on your next export." });
      setExportDetailsOpen(false);
    } catch {
      toast({ title: "Error", description: "Failed to save export details", variant: "destructive" });
    } finally {
      setIsSavingDetails(false);
    }
  };

  const handleUpdateDocumentType = async (documentId: number, documentType: string) => {
    try {
      const res = await fetch(`/api/documents/${documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentType }),
      });
      if (!res.ok) throw new Error("Update failed");
      queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
    } catch {
      toast({ title: "Error", description: "Failed to update document type", variant: "destructive" });
    }
  };

  const handleDeleteDocument = async () => {
    if (deleteDocId == null) return;
    setIsDeletingDoc(true);
    try {
      const res = await fetch(`/api/documents/${deleteDocId}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) throw new Error("Delete failed");
      toast({ title: "Deleted", description: "Document removed." });
      setDeleteDocId(null);
      queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
    } catch {
      toast({ title: "Error", description: "Failed to delete document", variant: "destructive" });
    } finally {
      setIsDeletingDoc(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length === 0) return;
    setIsUploading(true);
    let ok = 0;
    const failed: string[] = [];
    try {
      // Upload each selected file (the endpoint takes one file per request).
      for (const file of files) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("documentType", "drawing");
        try {
          const res = await fetch(`/api/projects/${projectId}/upload`, { method: "POST", body: formData });
          if (!res.ok) throw new Error("Upload failed");
          ok++;
        } catch {
          failed.push(file.name);
        }
      }
      queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
      if (failed.length === 0) {
        toast({ title: "Success", description: `${ok} document${ok === 1 ? "" : "s"} uploaded successfully` });
      } else {
        toast({
          title: ok > 0 ? "Partial upload" : "Error",
          description: `${ok} uploaded, ${failed.length} failed: ${failed.join(", ")}`,
          variant: ok > 0 ? "default" : "destructive",
        });
      }
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // ── Single-agent BOQ ─────────────────────────────────────────────────────
  // ── Multi-agent BOQ ──────────────────────────────────────────────────────
  const handleMultiAgentBoq = async (force = false) => {
    setIsGenerating(true);
    setIsMultiAgent(true);
    setShowPipeline(true);
    setGenerationProgress([]);
    setVerificationSummary(null);
    setPipeline(INITIAL_PIPELINE);
    setActiveTab("boq");

    const updateAgent = (agentKey: string, update: Partial<AgentState>) =>
      setPipeline(p => ({
        ...p,
        states: { ...p.states, [agentKey]: { ...IDLE, ...(p.states[agentKey] ?? {}), ...update } },
      }));
    const registerAgents = (agents: AgentDescriptor[]) =>
      setPipeline(p => ({
        agents,
        // Pre-seed states so cards render immediately as idle/queued.
        states: agents.reduce<Record<string, AgentState>>((acc, a) => {
          acc[a.key] = p.states[a.key] ?? IDLE;
          return acc;
        }, { ...p.states }),
      }));

    try {
      const res = await fetch(`/api/projects/${projectId}/generate-boq-multi`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: pref.provider, model: pref.model, providerConfig, force }),
      });
      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of decoder.decode(value).split('\n').filter(Boolean)) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));

            if (data.type === "pipeline-init") {
              registerAgents(data.agents as AgentDescriptor[]);
              setGenerationProgress(p => [...p, `[PIPELINE] Registered ${data.agents.length} agent(s) from SOW outline`]);
            } else if (data.type === "agent") {
              updateAgent(String(data.agent), { status: data.status, message: data.message });
              setGenerationProgress(p => [...p, `[${String(data.agent).toUpperCase()}] ${data.message}`]);
              if (data.summary) setVerificationSummary(data.summary);
            } else if (data.type === "pipeline") {
              setGenerationProgress(p => [...p, data.message]);
            } else if (data.type === "error") {
              toast({ title: "Error", description: data.message, variant: "destructive" });
            } else if (data.done) {
              toast({ title: "Multi-Agent BOQ Complete", description: "SOW-driven section agents and completeness verifier are done." });
              queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
            }
          } catch {}
        }
      }
    } catch {
      toast({ title: "Error", description: "Multi-agent pipeline failed", variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateSchedule = async () => {
    setIsScheduling(true);
    setScheduleProgress([]);
    setActiveTab("schedule");
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
        for (const line of decoder.decode(value).split('\n').filter(Boolean)) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "schedule") {
              setScheduleProgress(p => [...p, data.message]);
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
      setIsScheduling(false);
    }
  };

  const handleUpdateItem = async (itemId: number, field: string, value: string | number) => {
    const item = (project?.boqItems ?? []).find(i => i.id === itemId) as any;
    const body: Record<string, unknown> = { [field]: value };
    // Entering a real quantity on a flagged/TBD line resolves it — clear the flag
    // so it stops rendering "TBD" and the badge turns to Reviewed.
    if (field === "quantity" && Number(value) > 0 && item?.verificationStatus === "needs_review") {
      body.verificationStatus = "reviewed";
    }
    try {
      await patchBoqItem(itemId, body);
      queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
    } catch {
      toast({ title: "Error", description: "Failed to update item", variant: "destructive" });
    }
  };

  const handleAddItem = async () => {
    const category = newItem.category.trim();
    const description = newItem.description.trim();
    const unit = newItem.unit.trim();
    const quantity = Number(newItem.quantity);
    if (!category || !description || !unit || !Number.isFinite(quantity)) {
      toast({ title: "Missing fields", description: "Category, description, unit, and quantity are required.", variant: "destructive" });
      return;
    }
    const unitPrice = newItem.unitPrice.trim() === "" ? null : Number(newItem.unitPrice);
    if (unitPrice !== null && !Number.isFinite(unitPrice)) {
      toast({ title: "Invalid unit price", description: "Unit price must be a number.", variant: "destructive" });
      return;
    }
    setIsAdding(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/boq`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          itemCode: newItem.itemCode.trim() || null,
          description,
          unit,
          quantity,
          unitPrice,
          notes: newItem.notes.trim() || null,
        }),
      });
      if (!res.ok) throw new Error("Create failed");
      toast({ title: "Added", description: "BOQ item added." });
      setAddOpen(false);
      setNewItem(emptyDraft);
      queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
    } catch {
      toast({ title: "Error", description: "Failed to add BOQ item", variant: "destructive" });
    } finally {
      setIsAdding(false);
    }
  };

  const patchBoqItem = async (itemId: number, body: Record<string, unknown>) => {
    const res = await fetch(`/api/boq/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("Update failed");
  };

  // Toggle a single item's human-review approval. Optimistic-ish: we await the
  // PATCH then refetch the project so totals/export-eligibility stay correct.
  const handleToggleApproval = async (itemId: number, currentlyApproved: boolean) => {
    setApprovingId(itemId);
    try {
      await patchBoqItem(itemId, { approvalStatus: currentlyApproved ? "pending" : "approved" });
      queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
    } catch {
      toast({ title: "Error", description: "Failed to update approval", variant: "destructive" });
    } finally {
      setApprovingId(null);
    }
  };

  // Approve / un-approve every currently-filtered item in one pass.
  const handleBulkApproval = async (approve: boolean) => {
    const targets = filteredBoqItems.filter(i => (((i as any).approvalStatus ?? "pending") === "approved") !== approve);
    if (targets.length === 0) return;
    setIsBulkApproving(true);
    try {
      await Promise.all(targets.map(i => patchBoqItem(i.id, { approvalStatus: approve ? "approved" : "pending" })));
      queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
      toast({ title: approve ? "Approved" : "Approval cleared", description: `${targets.length} item${targets.length === 1 ? "" : "s"} updated.` });
    } catch {
      toast({ title: "Error", description: "Bulk approval failed", variant: "destructive" });
    } finally {
      setIsBulkApproving(false);
    }
  };

  // Approve every line the Quantity Validator flagged (needs_review), clear the
  // flag, then download the refreshed AIGCC Excel. One click for the QS to sign
  // off the flagged items and get the updated workbook.
  const handleApproveReviewedAndExport = async () => {
    // Optional footprint so area/volume TBDs resolve even when the CAD doesn't
    // supply a clean footprint (e.g. PDF-only drawings). Blank = auto-detect.
    // IMPORTANT: never abort if the prompt is dismissed or unavailable — embedded
    // webviews (VS Code Simple Browser, etc.) block window.prompt and return null,
    // which used to make this button silently do nothing. A null/blank answer just
    // means "auto-detect from the CAD", so the action always runs.
    let footprint: number | undefined;
    try {
      const fpInput = window.prompt?.(
        "Optional: building footprint area in m² to resolve TBD floor / ceiling / slab / roof quantities.\n" +
        "Leave blank to auto-detect from the CAD drawings.\n(e.g. 840 for a 15 × 56 m building)",
        "",
      );
      if (fpInput && fpInput.trim() && Number(fpInput) > 0) footprint = Number(fpInput);
    } catch {
      /* window.prompt blocked in this webview — proceed with auto-detect */
    }
    setIsApprovingReviewed(true);
    try {
      // Resolve footprint-based TBD quantities, then approve every flagged line.
      const res = await fetch(`/api/projects/${projectId}/boq/approve-reviewed`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(footprint ? { footprint } : {}),
      });
      if (!res.ok) throw new Error("approve failed");
      const r = await res.json();
      await queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
      // Honest reporting: when nothing resolved, say WHY (no footprint / MEP runs)
      // and that those lines need a manually-entered quantity, instead of a bare
      // "0 resolved" that reads like a failure.
      const parts = [`${r.approved} approved`];
      if (r.resolved) parts.push(`${r.resolved} quantit${r.resolved === 1 ? "y" : "ies"} resolved from the footprint`);
      if (r.stillTbd) {
        parts.push(
          r.footprint == null
            ? `${r.stillTbd} still TBD — no CAD footprint found, enter these quantities manually (MEP run-lengths can't be auto-derived)`
            : `${r.stillTbd} still TBD — need manual takeoff from the drawings`,
        );
      }
      toast({
        title: r.resolved ? "Flagged items approved" : r.stillTbd ? "Approved — manual quantities still needed" : "Flagged items approved",
        description: parts.join(" · ") + ".",
      });
      window.location.assign(`/api/projects/${projectId}/boq/export-aigcc.xlsx?t=${Date.now()}`);
    } catch {
      toast({ title: "Error", description: "Failed to approve flagged items", variant: "destructive" });
    } finally {
      setIsApprovingReviewed(false);
    }
  };

  const openEdit = (item: any) => {
    setEditId(item.id);
    setEditDraft({
      category: item.category ?? "",
      itemCode: item.itemCode ?? "",
      description: item.description ?? "",
      unit: item.unit ?? "",
      quantity: item.quantity != null ? String(item.quantity) : "",
      unitPrice: item.unitPrice != null ? String(item.unitPrice) : "",
      notes: (item as any).notes ?? "",
    });
  };

  const handleSaveEdit = async () => {
    if (editId == null) return;
    const category = editDraft.category.trim();
    const description = editDraft.description.trim();
    const unit = editDraft.unit.trim();
    const quantity = Number(editDraft.quantity);
    if (!category || !description || !unit || !Number.isFinite(quantity)) {
      toast({ title: "Missing fields", description: "Category, description, unit, and quantity are required.", variant: "destructive" });
      return;
    }
    const unitPrice = editDraft.unitPrice.trim() === "" ? undefined : Number(editDraft.unitPrice);
    if (unitPrice !== undefined && !Number.isFinite(unitPrice)) {
      toast({ title: "Invalid unit price", description: "Unit price must be a number.", variant: "destructive" });
      return;
    }
    setIsSavingEdit(true);
    try {
      await patchBoqItem(editId, {
        category,
        itemCode: editDraft.itemCode.trim(),
        description,
        unit,
        quantity,
        ...(unitPrice !== undefined ? { unitPrice } : {}),
        notes: editDraft.notes.trim(),
      });
      toast({ title: "Saved", description: "BOQ item updated." });
      setEditId(null);
      queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
    } catch {
      toast({ title: "Error", description: "Failed to update BOQ item", variant: "destructive" });
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleDelete = async () => {
    if (deleteId == null) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/boq/${deleteId}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) throw new Error("Delete failed");
      toast({ title: "Deleted", description: "BOQ item removed." });
      setDeleteId(null);
      queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
    } catch {
      toast({ title: "Error", description: "Failed to delete BOQ item", variant: "destructive" });
    } finally {
      setIsDeleting(false);
    }
  };

  const approvedCount = useMemo(
    () => (project?.boqItems ?? []).filter(i => ((i as any).approvalStatus ?? "pending") === "approved").length,
    [project],
  );

  // Lines the Quantity Validator flagged for human review (verificationStatus).
  const needsReviewCount = useMemo(
    () => (project?.boqItems ?? []).filter(i => (i as any).verificationStatus === "needs_review").length,
    [project],
  );

  const boqCategories = useMemo(() => {
    if (!project) return [] as string[];
    return Array.from(new Set(project.boqItems.map(i => i.category).filter(Boolean))).sort();
  }, [project]);

  // TBD is computed LIVE by the server (item.isTbd) — same engine the export
  // uses — so the table never disagrees with the export or shows a stale flag.
  const itemIsTbd = (item: any) => item?.isTbd === true;
  const itemNeedsAttention = (item: any) => item?.verificationStatus === "needs_review" || itemIsTbd(item);

  const filteredBoqItems = useMemo(() => {
    if (!project) return [];
    const q = boqSearch.trim().toLowerCase();
    return project.boqItems.filter(item => {
      if (categoryFilter !== "all" && item.category !== categoryFilter) return false;
      if (flaggedOnly && !itemNeedsAttention(item)) return false;
      if (!q) return true;
      const haystack = [
        item.itemCode ?? "",
        item.description ?? "",
        item.category ?? "",
        item.unit ?? "",
        (item as any).notes ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [project, boqSearch, categoryFilter, flaggedOnly]);

  if (isLoading || !project) {
    return <div className="p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold">{project.name}</h1>
            <Badge variant={project.status === 'completed' ? 'default' : project.status === 'processing' ? 'secondary' : 'outline'}>
              {project.status}
            </Badge>
          </div>
          <p className="text-muted-foreground mt-2">{project.description}</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end">
          <ModelSelector />

          <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
            {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            Upload
          </Button>
          <input type="file" multiple ref={fileInputRef} className="hidden" onChange={handleFileUpload} accept=".dwg,.dxf,.pdf,.docx,.doc,.txt" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onClick={() => handleMultiAgentBoq(false)}
                disabled={isGenerating}
                className="bg-accent text-accent-foreground hover:bg-accent/90"
              >
                {isGenerating && isMultiAgent ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                Multi-Agent BOQ
              </Button>
            </TooltipTrigger>
            <TooltipContent>9 agents — 7 domain specialists + verifier. Returns the cached BOQ if nothing changed.</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                onClick={() => { if (confirm("Regenerate a FRESH BOQ from scratch? The multi-agent pipeline is non-deterministic, so the result may differ from the current one. This replaces the current BOQ.")) handleMultiAgentBoq(true); }}
                disabled={isGenerating}
                title="Force a fresh regenerate (ignore the cache)"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Force a fresh regenerate — ignores the cache (result may differ)</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-[720px] grid-cols-5">
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="boq">BOQ Data</TabsTrigger>
          <TabsTrigger value="schedule">Work Programme</TabsTrigger>
          <TabsTrigger value="narrative">Technical Narrative</TabsTrigger>
          <TabsTrigger value="assistant">AI Assistant</TabsTrigger>
        </TabsList>

        {/* Documents tab */}
        <TabsContent value="documents" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Source Documents</CardTitle>
              <CardDescription>CAD drawings, specifications, and tender documents.</CardDescription>
            </CardHeader>
            <CardContent>
              {project.documents.length === 0 ? (
                <div className="text-center py-12 border border-dashed rounded-lg">
                  <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-medium">No documents yet</h3>
                  <p className="text-sm text-muted-foreground mt-1 mb-4">Upload DWG, PDF, or Word documents to begin extraction.</p>
                  <Button variant="outline" onClick={() => fileInputRef.current?.click()}>Upload Files</Button>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Filename</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Size</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Uploaded</TableHead>
                      <TableHead className="w-[96px] text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {project.documents.map(doc => (
                      <TableRow key={doc.id}>
                        <TableCell className="font-medium flex items-center gap-2">
                          <FileText className="h-4 w-4 text-primary" />
                          {doc.originalName}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={doc.documentType}
                            onValueChange={(value) => handleUpdateDocumentType(doc.id, value)}
                          >
                            <SelectTrigger className="h-8 w-[150px] capitalize" data-testid={`doc-type-${doc.id}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {DOCUMENT_TYPES.map((t) => (
                                <SelectItem key={t.value} value={t.value}>
                                  {t.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>{(doc.fileSize / 1024 / 1024).toFixed(2)} MB</TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <Badge variant="outline">{doc.status}</Badge>
                            {(() => {
                              const cad = (doc as { cadExtractionStatus?: string | null }).cadExtractionStatus;
                              if (!cad || cad === "skipped") return null;
                              const tone =
                                cad === "succeeded" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" :
                                cad === "failed"    ? "bg-red-500/15 text-red-400 border-red-500/30" :
                                cad === "running"   ? "bg-blue-500/15 text-blue-400 border-blue-500/30" :
                                                       "bg-muted text-muted-foreground border-border";
                              const label =
                                cad === "succeeded" ? "CAD parsed" :
                                cad === "failed"    ? "CAD failed" :
                                cad === "running"   ? "Parsing CAD…" :
                                                       "CAD pending";
                              return (
                                <span className={`text-[10px] px-1.5 py-0.5 rounded border ${tone} font-medium w-fit`}>
                                  {label}
                                </span>
                              );
                            })()}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{format(new Date(doc.createdAt), 'MMM d, yyyy')}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7"
                                  onClick={() => { setCadSvgFallback(false); setViewDoc({ id: doc.id, originalName: doc.originalName, mimeType: doc.mimeType }); }}
                                  aria-label={`View ${doc.originalName}`}
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Preview in portal</TooltipContent>
                            </Tooltip>
                            {/\.(dwg|dxf)$/i.test(doc.originalName) && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-7 w-7"
                                    onClick={() => setEditDoc({ id: doc.id, originalName: doc.originalName })}
                                    aria-label={`Markup ${doc.originalName}`}
                                  >
                                    <PencilRuler className="h-3.5 w-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Markup &amp; measure</TooltipContent>
                              </Tooltip>
                            )}
                            {/\.(dwg|dxf)$/i.test(doc.originalName) && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-7 w-7"
                                    onClick={() => setGeomEditDoc({ id: doc.id, originalName: doc.originalName })}
                                    aria-label={`Edit geometry of ${doc.originalName}`}
                                  >
                                    <Shapes className="h-3.5 w-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Edit geometry (saves a new revision)</TooltipContent>
                              </Tooltip>
                            )}
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => setDeleteDocId(doc.id)}
                              aria-label={`Delete ${doc.originalName}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* BOQ tab */}
        <TabsContent value="boq" className="mt-6 space-y-6">

          {/* Live pipeline panel */}
          {(isGenerating && isMultiAgent) || showPipeline ? (
            <Card className="border-accent/30 bg-accent/5">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sparkles className="h-4 w-4 text-accent" />
                  Multi-Agent Verification Pipeline
                  {isGenerating && <Loader2 className="h-4 w-4 animate-spin text-accent ml-auto" />}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <MultiAgentPipeline
                  pipeline={pipeline}
                  summary={verificationSummary}
                  progressLog={generationProgress}
                />
              </CardContent>
            </Card>
          ) : isGenerating && !isMultiAgent ? (
            <Card className="border-accent/30 bg-accent/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Loader2 className="h-5 w-5 animate-spin text-accent" />
                  Generating BOQ · {pref.model}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-32 overflow-y-auto space-y-1 font-mono text-sm text-muted-foreground p-4 bg-background rounded border">
                  {generationProgress.map((msg, i) => <div key={i}>&gt; {msg}</div>)}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {/* BOQ table */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <CardTitle>Bill of Quantities</CardTitle>
                  <CardDescription>
                    Review each line and tick <strong>Approve</strong> — only approved items are written to the exported Excel.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {verificationSummary && (
                    <div className="flex gap-2 text-xs">
                      <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30">{verificationSummary.agreedCount} agreed</Badge>
                      <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30">{verificationSummary.discrepancyCount} discrepancies</Badge>
                    </div>
                  )}
                  {project.boqItems.length > 0 && (
                    <Badge variant="outline" className="gap-1 whitespace-nowrap">
                      <CheckCircle2 className={`h-3 w-3 ${approvedCount > 0 ? "text-emerald-500" : "text-muted-foreground"}`} />
                      {approvedCount} / {project.boqItems.length} approved
                    </Badge>
                  )}
                  {filteredBoqItems.length > 0 && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isBulkApproving}
                        onClick={() => handleBulkApproval(true)}
                      >
                        {isBulkApproving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                        Approve all
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isBulkApproving || approvedCount === 0}
                        onClick={() => handleBulkApproval(false)}
                      >
                        Clear
                      </Button>
                    </>
                  )}
                  {project.boqItems.length > 0 && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="sm"
                          disabled={isApprovingReviewed}
                          onClick={handleApproveReviewedAndExport}
                          className="gap-2 bg-gradient-to-b from-amber-500 to-amber-600 text-white shadow-sm shadow-amber-600/20 hover:from-amber-500 hover:to-amber-700"
                        >
                          {isApprovingReviewed ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                          Resolve TBD, approve &amp; export
                          {needsReviewCount > 0 && (
                            <span className="ml-0.5 rounded-full bg-white/20 px-1.5 py-0.5 text-[11px] font-semibold leading-none">
                              {needsReviewCount}
                            </span>
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        Fills TBD floor / ceiling / slab / roof quantities from the building footprint, approves the flagged lines, then downloads the refreshed AIGCC Excel. MEP lengths with no drawing stay TBD.
                      </TooltipContent>
                    </Tooltip>
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button size="sm" variant="outline" onClick={openExportDetails} className="gap-2">
                        <Pencil className="h-4 w-4" />
                        Export details
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      Set Project Location, Submitted to, Quotation Ref &amp; Submission Date for the BOQ header
                    </TooltipContent>
                  </Tooltip>
                  {project.boqItems.length > 0 && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex">
                          <Button
                            size="sm"
                            disabled={approvedCount === 0}
                            onClick={() => {
                              // cache-buster — guarantees a fresh export, never a stale cached download
                              window.location.assign(`/api/projects/${projectId}/boq/export-aigcc.xlsx?t=${Date.now()}`);
                            }}
                            className="gap-2 bg-gradient-to-b from-emerald-500 to-emerald-600 text-white shadow-sm shadow-emerald-600/20 hover:from-emerald-500 hover:to-emerald-700 disabled:opacity-50 disabled:shadow-none"
                          >
                            <FileSpreadsheet className="h-4 w-4" />
                            Export Excel
                            {approvedCount > 0 && (
                              <span className="ml-0.5 rounded-full bg-white/20 px-1.5 py-0.5 text-[11px] font-semibold leading-none">
                                {approvedCount}
                              </span>
                            )}
                          </Button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        {approvedCount === 0
                          ? "Approve at least one item to export"
                          : `Exports the priced AIGCC BOQ workbook with the ${approvedCount} approved item${approvedCount === 1 ? "" : "s"}. The work programme is a separate download on the Work Programme tab.`}
                      </TooltipContent>
                    </Tooltip>
                  )}
                  <Button size="sm" onClick={() => setAddOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Add Item
                  </Button>
                </div>
              </div>
              {project.boqItems.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap pt-2">
                  <div className="relative flex-1 min-w-[220px]">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      value={boqSearch}
                      onChange={e => setBoqSearch(e.target.value)}
                      placeholder="Search code, description, category, unit, notes..."
                      className="pl-8 pr-8 h-9"
                    />
                    {boqSearch && (
                      <button
                        type="button"
                        onClick={() => setBoqSearch("")}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        aria-label="Clear search"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                    <SelectTrigger className="h-9 w-[200px]">
                      <SelectValue placeholder="All categories" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All categories</SelectItem>
                      {boqCategories.map(cat => (
                        <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant={flaggedOnly ? "default" : "outline"}
                    onClick={() => setFlaggedOnly(v => !v)}
                    className={`h-9 gap-1.5 ${flaggedOnly ? "bg-red-500 hover:bg-red-600 text-white" : ""}`}
                    title="Show only TBD / Needs-review lines that still need a quantity"
                  >
                    <Search className="h-3.5 w-3.5" />
                    Needs review / TBD
                    {needsReviewCount > 0 && (
                      <span className="ml-0.5 rounded-full bg-white/20 px-1.5 py-0.5 text-[11px] font-semibold leading-none">
                        {needsReviewCount}
                      </span>
                    )}
                  </Button>
                  <div className="text-xs text-muted-foreground whitespace-nowrap">
                    {filteredBoqItems.length} of {project.boqItems.length}
                  </div>
                </div>
              )}
            </CardHeader>
            <CardContent>
              {project.boqItems.length === 0 && !isGenerating ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Sparkles className="h-10 w-10 mx-auto mb-3 text-accent/40" />
                  <p className="mb-4">
                    No BOQ items yet. Use <strong>Generate BOQ</strong> (single agent) or <strong>Multi-Agent BOQ</strong> (verified) above,
                    or add items manually.
                  </p>
                  <Button onClick={() => setAddOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Add Item Manually
                  </Button>
                </div>
              ) : filteredBoqItems.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground text-sm">
                  No items match your search.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[72px] text-center">Approve</TableHead>
                        <TableHead className="w-[26%]">Description</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Unit</TableHead>
                        <TableHead className="w-[90px]">Qty</TableHead>
                        <TableHead className="w-[110px]">Unit Price</TableHead>
                        <TableHead>Total</TableHead>
                        <TableHead>Confidence</TableHead>
                        <TableHead>Verification</TableHead>
                        <TableHead className="w-[88px] text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredBoqItems.map(item => {
                        const anyItem = item as any;
                        const isApproved = (anyItem.approvalStatus ?? "pending") === "approved";
                        return (
                          <TableRow
                            key={item.id}
                            className={
                              anyItem.verificationStatus === "discrepancy"
                                ? "bg-amber-400/5"
                                : isApproved
                                  ? "bg-emerald-500/5"
                                  : ""
                            }
                          >
                            <TableCell className="text-center">
                              {approvingId === item.id ? (
                                <Loader2 className="h-4 w-4 animate-spin mx-auto text-muted-foreground" />
                              ) : (
                                <Checkbox
                                  checked={isApproved}
                                  onCheckedChange={() => handleToggleApproval(item.id, isApproved)}
                                  aria-label={isApproved ? "Approved — click to unapprove" : "Approve this item"}
                                />
                              )}
                            </TableCell>
                            <TableCell className="font-medium">
                              <div>{item.description}</div>
                              {anyItem.verificationNotes && (
                                <div className="text-xs text-amber-400/80 mt-0.5">{anyItem.verificationNotes}</div>
                              )}
                              {Array.isArray(anyItem.drawingReferences) && anyItem.drawingReferences.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {anyItem.drawingReferences.slice(0, 4).map((ref: any, refIdx: number) => {
                                    const label =
                                      ref.blockName ? `🔲 ${ref.blockName}` :
                                      ref.type === "schedule" ? `📋 schedule` :
                                      ref.type === "title_block" ? `🏷️ title` :
                                      ref.type === "sheet" || ref.type === "sheet_text" ? `📄 ${ref.sheet ?? `page ${(ref.page ?? 0) + 1}`}` :
                                      ref.layer ? `📐 ${ref.layer}` :
                                      ref.refId || ref.type;
                                    return (
                                      <span
                                        key={refIdx}
                                        title={ref.refId ?? ""}
                                        className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary/90 font-mono leading-tight"
                                      >
                                        {label}
                                      </span>
                                    );
                                  })}
                                  {anyItem.drawingReferences.length > 4 && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono leading-tight">
                                      +{anyItem.drawingReferences.length - 4}
                                    </span>
                                  )}
                                </div>
                              )}
                            </TableCell>
                            <TableCell><Badge variant="secondary">{item.category}</Badge></TableCell>
                            <TableCell>{item.unit}</TableCell>
                            <TableCell>
                              {itemIsTbd(item) && (
                                <div className="text-[10px] font-semibold text-red-400 mb-0.5">TBD — verify / enter qty</div>
                              )}
                              <Input
                                type="number"
                                defaultValue={item.quantity}
                                className={`h-8 ${itemIsTbd(item) ? "border-red-400/60" : ""}`}
                                onBlur={e => {
                                  const val = Number(e.target.value);
                                  if (e.target.value !== "" && val !== Number(item.quantity)) handleUpdateItem(item.id, 'quantity', val);
                                }}
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                defaultValue={item.unitPrice || ''}
                                className="h-8"
                                placeholder="0.00"
                                onBlur={e => {
                                  const val = Number(e.target.value);
                                  if (val !== Number(item.unitPrice)) handleUpdateItem(item.id, 'unitPrice', val);
                                }}
                              />
                            </TableCell>
                            <TableCell className="font-semibold text-accent">
                              ${Number(item.totalPrice || 0).toLocaleString()}
                            </TableCell>
                            <TableCell>
                              {item.aiConfidence && (
                                <div className="flex items-center gap-1.5">
                                  <div className="h-1.5 w-12 bg-secondary rounded-full overflow-hidden">
                                    <div className="h-full bg-primary" style={{ width: `${Number(item.aiConfidence) * 100}%` }} />
                                  </div>
                                  <span className="text-xs text-muted-foreground">{Math.round(Number(item.aiConfidence) * 100)}%</span>
                                </div>
                              )}
                            </TableCell>
                            <TableCell>
                              <VerificationBadge status={anyItem.verificationStatus} />
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7"
                                  onClick={() => openEdit(item)}
                                  aria-label="Edit item"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7 text-destructive hover:text-destructive"
                                  onClick={() => setDeleteId(item.id)}
                                  aria-label="Delete item"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Work Programme (schedule) tab — editable Gantt (sections, activities,
            sub-activities, dependency arrows, real dates). Shared component. */}
        <TabsContent value="schedule" className="mt-6 space-y-6">
          <WorkProgramme projectId={projectId} />
        </TabsContent>

        {/* Technical Narrative tab — bid-writer sections grounded in the
            project's documents, priced BOQ and work programme. */}
        <TabsContent value="narrative" className="mt-6">
          <TechnicalNarrativeTab projectId={projectId} />
        </TabsContent>

        {/* Assistant tab */}
        <TabsContent value="assistant" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Project Assistant</CardTitle>
              <CardDescription>Ask questions about documents, quantities, or discrepancies.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[400px] flex items-center justify-center flex-col text-center border-dashed border-2 rounded-lg text-muted-foreground p-8">
                <MessageSquare className="h-12 w-12 mb-4 text-primary" />
                <h3 className="text-lg font-medium text-foreground">AI Assistant</h3>
                <p className="mt-2 mb-6 max-w-md">The assistant can cross-reference drawings against the generated BOQ and highlight missing elements.</p>
                <Button asChild><a href={`/assistant?projectId=${projectId}`}>Open Chat</a></Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Add BOQ Item dialog */}
      {/* BOQ export details — saved on the project, stamped onto the export header */}
      <Dialog open={exportDetailsOpen} onOpenChange={setExportDetailsOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>BOQ Export Details</DialogTitle>
            <DialogDescription>
              These fill the Bill of Quantities header. Saved on the project and reused on every export
              (BOQ and Work Programme). Leave blank to omit.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="ed-client">Submitted to</Label>
              <Input
                id="ed-client"
                value={exportDetails.client}
                onChange={e => setExportDetails(s => ({ ...s, client: e.target.value }))}
                placeholder="e.g. Kuwait Finance House"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ed-location">Project Location</Label>
              <Input
                id="ed-location"
                value={exportDetails.location}
                onChange={e => setExportDetails(s => ({ ...s, location: e.target.value }))}
                placeholder="e.g. Salwa, Kuwait"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ed-ref">Quotation Ref</Label>
              <Input
                id="ed-ref"
                value={exportDetails.quotationRef}
                onChange={e => setExportDetails(s => ({ ...s, quotationRef: e.target.value }))}
                placeholder="Leave blank to auto-generate (AIGCC/QO/…)"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ed-date">Submission Date</Label>
              <Input
                id="ed-date"
                value={exportDetails.submissionDate}
                onChange={e => setExportDetails(s => ({ ...s, submissionDate: e.target.value }))}
                placeholder="Leave blank to use today's date"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExportDetailsOpen(false)} disabled={isSavingDetails}>
              Cancel
            </Button>
            <Button onClick={handleSaveExportDetails} disabled={isSavingDetails}>
              {isSavingDetails ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={addOpen} onOpenChange={(open) => { setAddOpen(open); if (!open) setNewItem(emptyDraft); }}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Add BOQ Item</DialogTitle>
            <DialogDescription>Manually add a single item to the Bill of Quantities.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="boq-description">Description *</Label>
              <Input
                id="boq-description"
                value={newItem.description}
                onChange={e => setNewItem(s => ({ ...s, description: e.target.value }))}
                placeholder="e.g. Excavation for structural works"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="boq-category">Category *</Label>
              <Input
                id="boq-category"
                value={newItem.category}
                onChange={e => setNewItem(s => ({ ...s, category: e.target.value }))}
                placeholder="e.g. SUBSTRUCTURE"
                list="boq-category-suggestions"
              />
              <datalist id="boq-category-suggestions">
                {boqCategories.map(cat => <option key={cat} value={cat} />)}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="boq-code">Item Code</Label>
              <Input
                id="boq-code"
                value={newItem.itemCode}
                onChange={e => setNewItem(s => ({ ...s, itemCode: e.target.value }))}
                placeholder="optional"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="boq-unit">Unit *</Label>
              <Input
                id="boq-unit"
                value={newItem.unit}
                onChange={e => setNewItem(s => ({ ...s, unit: e.target.value }))}
                placeholder="e.g. m2, m3, piece, LS"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="boq-qty">Quantity *</Label>
              <Input
                id="boq-qty"
                type="number"
                value={newItem.quantity}
                onChange={e => setNewItem(s => ({ ...s, quantity: e.target.value }))}
                placeholder="0"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="boq-price">Unit Price</Label>
              <Input
                id="boq-price"
                type="number"
                value={newItem.unitPrice}
                onChange={e => setNewItem(s => ({ ...s, unitPrice: e.target.value }))}
                placeholder="0.00"
              />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="boq-notes">Notes</Label>
              <Input
                id="boq-notes"
                value={newItem.notes}
                onChange={e => setNewItem(s => ({ ...s, notes: e.target.value }))}
                placeholder="optional"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={isAdding}>Cancel</Button>
            <Button onClick={handleAddItem} disabled={isAdding}>
              {isAdding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Add Item
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit BOQ Item dialog */}
      <Dialog open={editId != null} onOpenChange={(open) => { if (!open) setEditId(null); }}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Edit BOQ Item</DialogTitle>
            <DialogDescription>Update this line item. Changes apply immediately after saving.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="edit-description">Description *</Label>
              <Input
                id="edit-description"
                value={editDraft.description}
                onChange={e => setEditDraft(s => ({ ...s, description: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-category">Category *</Label>
              <Input
                id="edit-category"
                value={editDraft.category}
                onChange={e => setEditDraft(s => ({ ...s, category: e.target.value }))}
                list="boq-category-suggestions"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-code">Item Code</Label>
              <Input
                id="edit-code"
                value={editDraft.itemCode}
                onChange={e => setEditDraft(s => ({ ...s, itemCode: e.target.value }))}
                placeholder="optional"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-unit">Unit *</Label>
              <Input
                id="edit-unit"
                value={editDraft.unit}
                onChange={e => setEditDraft(s => ({ ...s, unit: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-qty">Quantity *</Label>
              <Input
                id="edit-qty"
                type="number"
                value={editDraft.quantity}
                onChange={e => setEditDraft(s => ({ ...s, quantity: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-price">Unit Price</Label>
              <Input
                id="edit-price"
                type="number"
                value={editDraft.unitPrice}
                onChange={e => setEditDraft(s => ({ ...s, unitPrice: e.target.value }))}
                placeholder="0.00"
              />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="edit-notes">Notes</Label>
              <Input
                id="edit-notes"
                value={editDraft.notes}
                onChange={e => setEditDraft(s => ({ ...s, notes: e.target.value }))}
                placeholder="optional"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditId(null)} disabled={isSavingEdit}>Cancel</Button>
            <Button onClick={handleSaveEdit} disabled={isSavingEdit}>
              {isSavingEdit ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Pencil className="mr-2 h-4 w-4" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Full-screen CAD markup + measure editor */}
      {editDoc && (
        <CadEditor
          key={editDoc.id}
          documentId={editDoc.id}
          originalName={editDoc.originalName}
          svgUrl={`/api/documents/${editDoc.id}/svg`}
          onClose={() => setEditDoc(null)}
        />
      )}

      {/* Full-screen CAD geometry editor — edits real DWG/DXF geometry and saves
          a new versioned drawing (the original is preserved). */}
      {geomEditDoc && (
        <CadGeometryEditor
          key={geomEditDoc.id}
          documentId={geomEditDoc.id}
          originalName={geomEditDoc.originalName}
          onClose={() => setGeomEditDoc(null)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) })}
        />
      )}

      {/* In-portal document preview */}
      <Dialog open={viewDoc != null} onOpenChange={(open) => { if (!open) setViewDoc(null); }}>
        <DialogContent className="max-w-5xl w-[92vw] h-[88vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 pt-6 pb-3 border-b">
            <DialogTitle className="flex items-center gap-2 pr-8">
              <FileText className="h-4 w-4 text-primary shrink-0" />
              <span className="truncate">{viewDoc?.originalName}</span>
            </DialogTitle>
            <DialogDescription>Previewing inside the portal — no download needed.</DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0 p-4">
            {viewDoc && (() => {
              const url = `/api/documents/${viewDoc.id}/raw`;
              const name = viewDoc.originalName.toLowerCase();
              const mime = viewDoc.mimeType ?? "";
              const isImage = mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg|bmp)$/.test(name);
              const isPdf = mime === "application/pdf" || name.endsWith(".pdf");
              const isDocx = name.endsWith(".docx");
              if (isImage) {
                return (
                  <div className="h-full w-full overflow-auto rounded border bg-muted/30 flex items-center justify-center">
                    <img src={url} alt={viewDoc.originalName} className="max-w-full max-h-full object-contain" />
                  </div>
                );
              }
              if (isPdf) {
                return <PdfViewer url={url} />;
              }
              if (isDocx) {
                return <DocxViewer url={url} />;
              }
              const isCad = /\.(dwg|dxf)$/.test(name);
              if (isCad) {
                // Exact-geometry WebGL viewer (native layers/colors/linetypes).
                // On render failure the user can fall back to the server SVG.
                if (cadSvgFallback) {
                  return <CadViewer url={`/api/documents/${viewDoc.id}/svg`} downloadUrl={url} />;
                }
                return (
                  <CadGlViewer
                    url={`/api/documents/${viewDoc.id}/dxf`}
                    boundsUrl={`/api/documents/${viewDoc.id}/dxf-bounds`}
                    downloadUrl={url}
                    onFallback={() => setCadSvgFallback(true)}
                  />
                );
              }
              return (
                <div className="h-full w-full flex flex-col items-center justify-center text-center gap-3 rounded border border-dashed text-muted-foreground">
                  <FileText className="h-12 w-12 text-muted-foreground/40" />
                  <p className="max-w-sm text-sm">
                    This file type can’t be previewed in the browser.
                  </p>
                  <Button variant="outline" onClick={() => window.open(url, "_blank", "noopener,noreferrer")}>
                    <Eye className="mr-2 h-4 w-4" />
                    Open / download externally
                  </Button>
                </div>
              );
            })()}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Document confirmation */}
      <AlertDialog open={deleteDocId != null} onOpenChange={(open) => { if (!open) setDeleteDocId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this document?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the uploaded file and its extracted CAD data. Already-generated BOQ items are kept.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingDoc}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDeleteDocument(); }}
              disabled={isDeletingDoc}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeletingDoc ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete BOQ Item confirmation */}
      <AlertDialog open={deleteId != null} onOpenChange={(open) => { if (!open) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this BOQ item?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the line item from the Bill of Quantities. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDelete(); }}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
