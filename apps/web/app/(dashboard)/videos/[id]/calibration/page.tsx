import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, EmptyState } from "@/components/shared";

interface CalibrationPageProps {
  params: Promise<{ id: string }>;
}

export default async function CalibrationPage({
  params,
}: CalibrationPageProps) {
  const { id } = await params;
  if (!id) notFound();

  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2">
        <Link href={`/videos/${id}`}>
          <ChevronLeft className="h-4 w-4" /> Back to Video
        </Link>
      </Button>

      <PageHeader
        title={`Calibrate Hoop ROI · Video ${id}`}
        description="Draw the hoop bounding box and optionally the court polygon. Phase 6 will save to POST /v1/videos/:id/calibration."
      >
        <Button size="sm" disabled>
          <Save className="h-4 w-4" /> Save ROI
        </Button>
      </PageHeader>

      <div className="mt-8">
        <EmptyState
          icon="video"
          title="ROI Editor (Phase 6)"
          description="Canvas overlay for drawing hoop/court polygons. Enables Coarse Sampling speedups in the AI pipeline."
        />
      </div>
    </div>
  );
}
