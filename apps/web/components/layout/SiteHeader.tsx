"use client";

import Link from "next/link";
import { ExternalLink, Sparkles, Cpu } from "lucide-react";
import { Logo } from "./Logo";
import { Button } from "@/components/ui/button";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--background)]/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <Link href="/" aria-label="Home">
          <Logo />
        </Link>
        <nav className="hidden items-center gap-4 sm:flex">
          <Button asChild variant="ghost" size="sm">
            <Link href="/jobs">
              <Sparkles className="h-4 w-4 text-[var(--primary)]" /> AI Pipeline
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/projects">
              <Cpu className="h-4 w-4 text-[var(--primary)]" /> Projects
            </Link>
          </Button>
          <Button
            asChild
            variant="outline"
            size="sm"
            className="text-[var(--muted-foreground)]"
          >
            <a
              href="https://github.com/"
              target="_blank"
              rel="noreferrer noopener"
              aria-label="GitHub"
            >
              <ExternalLink className="h-4 w-4" /> Repository
            </a>
          </Button>
        </nav>
      </div>
    </header>
  );
}
