import { PageHeader, EmptyState } from "@/components/shared";

export default function ExportsPage() {
  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        title="Exports"
        description="Individual clip downloads and merged highlight montages. Phase 5 will call POST /v1/exports."
      />

      <div className="mt-8">
        <EmptyState
          icon="folder"
          title="Exports (Phase 5+)"
          description="Export history with status chips and download buttons. Pull from GET /v1/exports."
        />
      </div>
    </div>
  );
}
