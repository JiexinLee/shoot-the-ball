import { Card, CardContent } from "@/components/ui/card";

interface HighlightListPlaceholderProps {
  videoId?: string;
}

export function HighlightListPlaceholder({
  videoId,
}: HighlightListPlaceholderProps) {
  return (
    <Card>
      <CardContent className="p-12 text-center space-y-2">
        <p className="text-sm font-semibold">
          {videoId ? "No highlights yet" : "Select a video first"}
        </p>
        <p className="text-xs text-[var(--muted-foreground)]">
          Component placeholder — highlight gallery with confidence filtering,
          soft delete, and start/end adjustment.
        </p>
      </CardContent>
    </Card>
  );
}
