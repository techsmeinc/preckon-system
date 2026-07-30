import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useGetProjectStats, getGetProjectStatsQueryKey } from "@workspace/api-client-react";
import { FileText, Folder, ListChecks, CheckCircle2, Clock } from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function Dashboard() {
  const { data: stats, isLoading } = useGetProjectStats({
    query: { queryKey: getGetProjectStatsQueryKey() }
  });

  if (isLoading || !stats) {
    return (
      <div className="p-8 space-y-6">
        <div className="h-8 w-48 bg-muted rounded animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 bg-muted rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Overview</h1>
        <p className="text-muted-foreground mt-1">Platform performance and active project metrics.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Projects</CardTitle>
            <Folder className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalProjects}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Documents Processed</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalDocuments}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">BOQ Items Generated</CardTitle>
            <ListChecks className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalBoqItems}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active Processing</CardTitle>
            <Clock className="h-4 w-4 text-accent" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.processingProjects}</div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Recent Projects</h2>
          <Button variant="outline" asChild>
            <Link href="/projects">View All</Link>
          </Button>
        </div>
        
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {stats.recentProjects?.map((project) => (
            <Card key={project.id} className="hover:border-accent transition-colors">
              <CardHeader className="pb-3">
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle>
                      <Link href={`/projects/${project.id}`} className="hover:text-accent transition-colors">
                        {project.name}
                      </Link>
                    </CardTitle>
                    <CardDescription className="line-clamp-1 mt-1">{project.description || 'No description'}</CardDescription>
                  </div>
                  <Badge variant={project.status === 'completed' ? 'default' : project.status === 'processing' ? 'secondary' : 'outline'}>
                    {project.status === 'completed' && <CheckCircle2 className="w-3 h-3 mr-1" />}
                    {project.status === 'processing' && <Clock className="w-3 h-3 mr-1" />}
                    {project.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <FileText className="h-4 w-4" />
                    <span>{project.documentCount} docs</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <ListChecks className="h-4 w-4" />
                    <span>{project.boqItemCount} items</span>
                  </div>
                  {project.totalCost != null && project.totalCost > 0 && (
                    <div className="flex items-center gap-1 font-medium text-foreground ml-auto">
                      <span>${project.totalCost.toLocaleString()}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
          {(!stats.recentProjects || stats.recentProjects.length === 0) && (
            <div className="col-span-full py-12 text-center text-muted-foreground border rounded-lg border-dashed">
              No recent projects found.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
