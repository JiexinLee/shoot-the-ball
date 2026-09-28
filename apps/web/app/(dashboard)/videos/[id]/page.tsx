import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Settings, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, EmptyState } from "@/components/shared";
import { VideoPlayer } from "@/components/video";

interface VideoDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function VideoDetailPage({
  params,
}: VideoDetailPageProps) {
  const { id } = await params;
  if (!id) notFound();

  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2">
        <Link href="/videos">
          <ChevronLeft className="h-4 w-4" /> Back to Videos
        </Link>
      </Button>

      <PageHeader
        title={`Video: ${id}`}
        description="Source video overview, processing status, and entry to calibration / review."
      >
        <Button asChild variant="outline" size="sm">
          <Link href={`/videos/${id}/calibration`}>
            <Settings className="h-4 w-4" /> Calibrate
          </Link>
        </Button>
        <Button asChild size="sm">
          <Link href={`/videos/${id}/review`}>
            <Pencil className="h-4 w-4" /> Review Highlights
          </Link>
        </Button>
      </PageHeader>

      <div className="mt-8 grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <VideoPlayer />
        </div>
        <div className="space-y-4">
          <EmptyState
            icon="video"
            title="Video metadata"
            description="Duration, resolution, fps, status, linked ProcessingJob progress. Source: GET /v1/videos/:id + GET /v1/jobs/:id."
          />
        </div>
      </div>
    </div>
  );
}
