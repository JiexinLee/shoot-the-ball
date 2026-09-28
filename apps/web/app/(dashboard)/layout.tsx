import { SiteHeader, SiteFooter, DashboardSidebar } from "@/components/layout";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <div className="flex flex-1">
        <DashboardSidebar />
        <main className="flex-1 min-w-0">{children}</main>
      </div>
      <SiteFooter />
    </div>
  );
}
