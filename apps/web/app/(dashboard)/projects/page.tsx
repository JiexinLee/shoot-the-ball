import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, EmptyState } from "@/components/shared";

export default function ProjectsPage() {
  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        title="Projects"
        description="Organize your videos by project. MVP defaults to a single dev project."
      >
        <Button size="sm" disabled>
          <Plus className="h-4 w-4" /> New Project
        </Button>
      </PageHeader>

      <div className="mt-8">
        <EmptyState
          icon="folder"
          title="Projects (MVP Phase 3+)"
          description="Project list view. Phase 3 will list projects from /v1/projects and link to their video collections."
        />
        <p className="mt-4 text-xs text-[var(--muted-foreground)] text-center">
          Tip: Use{" "}
          <Link
            href="/"
            className="text-[var(--primary)] underline underline-offset-2 hover:no-underline"
          >
            the Upload page
          </Link>{" "}
          to add videos to the default dev project.
        </p>
      </div>
    </div>
  );
}
