"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Upload,
  FolderKanban,
  Clapperboard,
  ScissorsLineDashed,
  BarChart3,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Upload", icon: Upload },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/videos", label: "Videos", icon: Clapperboard },
  { href: "/exports", label: "Exports", icon: ScissorsLineDashed },
  { href: "/jobs", label: "Pipeline", icon: BarChart3 },
];

export function DashboardSidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-64 shrink-0 border-r border-[var(--border)] bg-[var(--card)]/30 lg:block">
      <nav className="sticky top-20 flex flex-col gap-1 p-4">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-[var(--primary)]/10 text-[var(--primary)]"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)]",
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
