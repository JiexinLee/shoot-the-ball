import { PageHeader, EmptyState } from "@/components/shared";
import { JobProgressTracker } from "@/components/jobs";

export default function JobsPage() {
  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        title="AI Pipeline"
        description="Live view of ProcessingJob statuses: Preparing → Detecting → Verifying → Generating Clips → Ready."
      />

      <div className="mt-8 space-y-4">
        <JobProgressTracker
          progress={0}
          stage="Idle — upload a video to start"
          status="idle"
        />
        <EmptyState
          icon="video"
          title="Active jobs (Phase 3+)"
          description="Paginated list of ProcessingJob rows. Statuses update via SSE /v1/jobs/:id/events or polling GET /v1/jobs/:id."
          className="mt-6"
        />
      </div>
    </div>
  );
}
