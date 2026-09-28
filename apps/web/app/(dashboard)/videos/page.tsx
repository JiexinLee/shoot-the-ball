import Link from "next/link";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, EmptyState } from "@/components/shared";

export default function VideosPage() {
  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        title="Videos"
        description="All uploaded videos across projects. MVP uses the default dev project only."
      >
        <Button asChild size="sm">
          <Link href="/">
            <Upload className="h-4 w-4" /> Upload New
          </Link>
        </Button>
      </PageHeader>

      <div className="mt-8">
        <EmptyState
          icon="video"
          title="Video gallery (Phase 3+)"
          description="Paginated list of Video rows with status chips. Pull from GET /v1/projects/:id or a dedicated /v1/videos endpoint."
        />
      </div>
    </div>
  );
}
