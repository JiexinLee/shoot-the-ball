import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Worker Tester · YOLO Detection Lab",
  description:
    "Local test bed for validating AI Worker YOLO detection accuracy and performance on basketball videos.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-[var(--background)] text-[var(--foreground)]">
        {children}
      </body>
    </html>
  );
}
