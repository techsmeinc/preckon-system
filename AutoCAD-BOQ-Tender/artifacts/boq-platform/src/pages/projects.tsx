import { useListProjects, getListProjectsQueryKey, useCreateProject } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Search, FileText, ListChecks, ArrowRight, Archive, ArchiveRestore, ChevronDown, ChevronRight, Loader2, MoreVertical, Pencil, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useForm } from "react-hook-form";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";

type CreateProjectFormValues = {
  name: string;
  description: string;
  client: string;
  location: string;
  quotationRef: string;
  submissionDate: string;
};

// Subset of project fields editable from the list (matches the PATCH route).
interface EditableProject {
  id: number;
  name: string;
  description?: string | null;
  client?: string | null;
  location?: string | null;
  quotationRef?: string | null;
  submissionDate?: string | null;
}

export function Projects() {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [editing, setEditing] = useState<EditableProject | null>(null);
  const [deleting, setDeleting] = useState<EditableProject | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const { data: projects, isLoading } = useListProjects({
    query: { queryKey: getListProjectsQueryKey() }
  });

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createProject = useCreateProject();

  const form = useForm<CreateProjectFormValues>({
    defaultValues: {
      name: "",
      description: "",
      client: "",
      location: "",
      quotationRef: "",
      submissionDate: "",
    },
  });

  function onSubmit(values: CreateProjectFormValues) {
    createProject.mutate(
      { data: values },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
          setOpen(false);
          form.reset();
          toast({
            title: "Project created",
            description: "Your new project has been created successfully.",
          });
        },
        onError: () => {
          toast({
            title: "Error",
            description: "Failed to create project. Please try again.",
            variant: "destructive",
          });
        }
      }
    );
  }

  const filteredProjects = Array.isArray(projects)
    ? projects.filter(p =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        (p.description && p.description.toLowerCase().includes(search.toLowerCase()))
      )
    : [];

  // Split into active vs archived/inactive. `archived` isn't in the generated
  // client type yet, so read it defensively.
  const isArchived = (p: typeof filteredProjects[number]) => Number((p as { archived?: number }).archived) === 1;
  const activeProjects = filteredProjects.filter(p => !isArchived(p));
  const inactiveProjects = filteredProjects.filter(p => isArchived(p));

  // Hide (archive) or restore a project, then refresh the list.
  const setArchived = async (id: number, archived: boolean) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived }),
      });
      if (!res.ok) throw new Error("request failed");
      await queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
      toast({
        title: archived ? "Project hidden" : "Project restored",
        description: archived ? "Moved to Inactive projects." : "Moved back to active projects.",
      });
    } catch {
      toast({ title: "Error", description: "Could not update the project. Please try again.", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  // Delete a project (cascades documents/BOQ/schedule/etc. at the DB level).
  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      const res = await fetch(`/api/projects/${deleting.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("request failed");
      await queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
      toast({ title: "Project deleted", description: `"${deleting.name}" and all its data were removed.` });
      setDeleting(null);
    } catch {
      toast({ title: "Error", description: "Could not delete the project. Please try again.", variant: "destructive" });
    } finally {
      setDeleteBusy(false);
    }
  };

  const renderRow = (project: typeof filteredProjects[number]) => {
    const archived = isArchived(project);
    return (
      <TableRow key={project.id} className="group">
        <TableCell className="font-medium">
          <Link href={`/projects/${project.id}`} className="hover:underline text-foreground">
            {project.name}
          </Link>
        </TableCell>
        <TableCell>
          <Badge variant={project.status === 'completed' ? 'default' : project.status === 'processing' ? 'secondary' : 'outline'}>
            {project.status}
          </Badge>
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-2 text-muted-foreground">
            <FileText className="h-4 w-4" />
            {project.documentCount}
          </div>
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-2 text-muted-foreground">
            <ListChecks className="h-4 w-4" />
            {project.boqItemCount}
          </div>
        </TableCell>
        <TableCell className="font-medium">
          {project.totalCost ? `$${project.totalCost.toLocaleString()}` : '-'}
        </TableCell>
        <TableCell className="text-muted-foreground">
          {format(new Date(project.createdAt), 'MMM d, yyyy')}
        </TableCell>
        <TableCell className="text-right">
          <div className="flex items-center justify-end gap-1">
            <Button variant="ghost" size="sm" asChild className="opacity-0 group-hover:opacity-100 transition-opacity">
              <Link href={`/projects/${project.id}`}>
                Open <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  title="More actions"
                  disabled={busyId === project.id}
                >
                  {busyId === project.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreVertical className="h-4 w-4" />}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onClick={() => setEditing(project as unknown as EditableProject)}>
                  <Pencil className="mr-2 h-4 w-4" /> Edit details
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setArchived(project.id, !archived)}>
                  {archived
                    ? <><ArchiveRestore className="mr-2 h-4 w-4" /> Restore to active</>
                    : <><Archive className="mr-2 h-4 w-4" /> Hide (make inactive)</>}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => setDeleting(project as unknown as EditableProject)}
                >
                  <Trash2 className="mr-2 h-4 w-4" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </TableCell>
      </TableRow>
    );
  };

  const tableHead = (
    <TableHeader>
      <TableRow>
        <TableHead>Name</TableHead>
        <TableHead>Status</TableHead>
        <TableHead>Documents</TableHead>
        <TableHead>BOQ Items</TableHead>
        <TableHead>Total Cost</TableHead>
        <TableHead>Created</TableHead>
        <TableHead className="text-right">Action</TableHead>
      </TableRow>
    </TableHeader>
  );

  return (
    <div className="p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Projects</h1>
          <p className="text-muted-foreground mt-1">Manage and monitor all estimation projects.</p>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search projects..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 w-[250px]"
            />
          </div>

          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                New Project
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Project</DialogTitle>
                <DialogDescription>
                  Start a new estimation project. You can upload documents later.
                </DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="name"
                    rules={{ required: "Project name is required" }}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Project Name</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. Downtown Office Complex" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description</FormLabel>
                        <FormControl>
                          <Textarea placeholder="Optional details about this project" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* BOQ export details — stamped onto the exported BOQ header.
                      Optional; can also be edited later from the project's "Export details". */}
                  <div className="pt-2 border-t">
                    <p className="text-sm font-medium text-foreground">BOQ export details <span className="font-normal text-muted-foreground">(optional)</span></p>
                    <p className="text-xs text-muted-foreground mb-2">These fill the Bill of Quantities header. You can change them later.</p>
                    <div className="grid grid-cols-2 gap-3">
                      <FormField
                        control={form.control}
                        name="client"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Submitted to</FormLabel>
                            <FormControl>
                              <Input placeholder="e.g. Kuwait Finance House" {...field} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="location"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Project Location</FormLabel>
                            <FormControl>
                              <Input placeholder="e.g. Salwa, Kuwait" {...field} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="quotationRef"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Quotation Ref</FormLabel>
                            <FormControl>
                              <Input placeholder="Blank = auto-generate" {...field} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="submissionDate"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Submission Date</FormLabel>
                            <FormControl>
                              <Input placeholder="Blank = today" {...field} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={createProject.isPending}>
                      {createProject.isPending ? "Creating..." : "Create Project"}
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Active projects */}
      <div className="border rounded-lg bg-card">
        <Table>
          {tableHead}
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8">
                  <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin mx-auto" />
                </TableCell>
              </TableRow>
            ) : activeProjects.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                  No active projects found. Create one to get started.
                </TableCell>
              </TableRow>
            ) : (
              activeProjects.map(renderRow)
            )}
          </TableBody>
        </Table>
      </div>

      {/* Inactive / archived projects — tucked away at the bottom, collapsed by
          default so they don't clutter the main list. */}
      {inactiveProjects.length > 0 && (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setShowInactive(v => !v)}
            className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            {showInactive ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <Archive className="h-4 w-4" />
            Inactive projects
            <Badge variant="secondary" className="ml-1">{inactiveProjects.length}</Badge>
          </button>
          {showInactive && (
            <div className="border rounded-lg bg-muted/30">
              <Table>
                {tableHead}
                <TableBody>
                  {inactiveProjects.map(renderRow)}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}

      {/* Edit details dialog (remounts per project via key so fields re-init) */}
      {editing && (
        <EditProjectDialog
          key={editing.id}
          project={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
            setEditing(null);
            toast({ title: "Project updated", description: "Your changes have been saved." });
          }}
        />
      )}

      {/* Delete confirmation */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this project?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes <span className="font-medium text-foreground">{deleting?.name}</span> and all of its
              data — documents, BOQ items, work programme and narrative. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); confirmDelete(); }}
              disabled={deleteBusy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteBusy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Deleting...</> : "Delete project"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Edit-details dialog ───────────────────────────────────────────────────────
function EditProjectDialog({ project, onClose, onSaved }: {
  project: EditableProject;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [values, setValues] = useState({
    name: project.name ?? "",
    description: project.description ?? "",
    client: project.client ?? "",
    location: project.location ?? "",
    quotationRef: project.quotationRef ?? "",
    submissionDate: project.submissionDate ?? "",
  });
  const set = (k: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setValues(v => ({ ...v, [k]: e.target.value }));

  const save = async () => {
    if (!values.name.trim()) {
      toast({ title: "Name required", description: "Project name can't be empty.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) throw new Error("request failed");
      onSaved();
    } catch {
      toast({ title: "Error", description: "Could not save changes. Please try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit project</DialogTitle>
          <DialogDescription>Update the project name, description and BOQ export details.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Project Name</Label>
            <Input value={values.name} onChange={set("name")} />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea value={values.description} onChange={set("description")} placeholder="Optional details about this project" />
          </div>
          <div className="pt-2 border-t">
            <p className="text-sm font-medium text-foreground">BOQ export details</p>
            <p className="text-xs text-muted-foreground mb-2">These fill the Bill of Quantities header.</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Submitted to</Label><Input value={values.client} onChange={set("client")} /></div>
              <div className="space-y-1.5"><Label>Project Location</Label><Input value={values.location} onChange={set("location")} /></div>
              <div className="space-y-1.5"><Label>Quotation Ref</Label><Input value={values.quotationRef} onChange={set("quotationRef")} placeholder="Blank = auto-generate" /></div>
              <div className="space-y-1.5"><Label>Submission Date</Label><Input value={values.submissionDate} onChange={set("submissionDate")} placeholder="Blank = today" /></div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="button" onClick={save} disabled={saving}>
            {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</> : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
