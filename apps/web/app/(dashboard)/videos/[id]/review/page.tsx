import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ScissorsLineDashed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared";
import { HighlightListPlaceholder } from "@/components/highlights";

interface ReviewPageProps {
  params: Promise<{ id: string }>;
}

export default async function ReviewPage({ params }: ReviewPageProps) {
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
        title={`Review Highlights · Video ${id}`}
        description="Play, trim, soft-delete highlights and export individual clips or a merged montage."
      >
        <Button asChild size="sm" disabled>
          <Link href="#">
            <ScissorsLineDashed className="h-4 w-4" /> Export Selected
          </Link>
        </Button>
      </PageHeader>

      <div className="mt-8">
        <HighlightListPlaceholder videoId={id} />
      </div>
    </div>
  );
}
