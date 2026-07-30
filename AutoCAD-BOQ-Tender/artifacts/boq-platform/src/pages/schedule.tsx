import { useState } from "react";
import { useListProjects, getListProjectsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { WorkProgramme } from "@/components/work-programme";

export function Schedule() {
  const { data: projects } = useListProjects({ query: { queryKey: getListProjectsQueryKey() } });
  const [projectId, setProjectId] = useState<number | null>(null);

  return (
    <div className="p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Work Programme</h1>
          <p className="text-muted-foreground mt-1">Editable project time schedule (Gantt) — sections, activities, sub-activities & dependencies.</p>
        </div>
        <Select value={projectId != null ? String(projectId) : undefined} onValueChange={v => setProjectId(Number(v))}>
          <SelectTrigger className="w-[260px]">
            <SelectValue placeholder="Select a project..." />
          </SelectTrigger>
          <SelectContent>
            {(projects ?? []).map(p => (
              <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {projectId == null ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">Select a project to view, generate or edit its work programme.</CardContent></Card>
      ) : (
        <WorkProgramme projectId={projectId} />
      )}
    </div>
  );
}
