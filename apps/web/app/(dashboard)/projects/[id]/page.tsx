import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, EmptyState } from "@/components/shared";

interface ProjectDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function ProjectDetailPage({
  params,
}: ProjectDetailPageProps) {
  const { id } = await params;
  if (!id) notFound();

  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2">
        <Link href="/projects">
          <ChevronLeft className="h-4 w-4" /> Back to Projects
        </Link>
      </Button>

      <PageHeader
        title={`Project: ${id}`}
        description="Videos belonging to this project. Phase 3 will fetch from /v1/projects/:id."
      />

      <div className="mt-8">
        <EmptyState
          icon="video"
          title="No videos loaded"
          description="Per-project video list. Wire up with GET /v1/projects/:id in Phase 3."
        />
      </div>
    </div>
  );
}
