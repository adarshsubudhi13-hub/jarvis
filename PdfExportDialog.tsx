import { FileDown, RotateCcw, RectangleHorizontal, RectangleVertical } from "lucide-react";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ChatTurn } from "@/lib/jarvis-types";
import {
  exportConversationPdf,
  type PdfOrientation,
  type PdfPageSize,
} from "@/lib/export-conversation";
import { cn } from "@/lib/utils";

const SIZES: Array<{ id: PdfPageSize; label: string }> = [
  { id: "a4", label: "A4" },
  { id: "letter", label: "Letter" },
  { id: "legal", label: "Legal" },
];

/**
 * Shared page-size / orientation picker shown before any PDF export
 * (sidebar rows, History dialog, AI-triggered exports).
 */
export function PdfExportDialog({
  open,
  onOpenChange,
  turns,
  title,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  turns: ChatTurn[];
  title?: string | undefined;
}) {
  const [pageSize, setPageSize] = useState<PdfPageSize>("a4");
  const [orientation, setOrientation] = useState<PdfOrientation>("portrait");

  const download = async () => {
    onOpenChange(false);
    await exportConversationPdf(turns, title, { pageSize, orientation });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-display tracking-[0.2em] text-primary">
            PDF options
          </DialogTitle>
          <DialogDescription className="font-mono text-[0.65rem] uppercase tracking-widest text-muted-foreground">
            Choose page size &amp; orientation
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <p className="mb-1.5 font-mono text-[0.6rem] uppercase tracking-widest text-muted-foreground">
              Page size
            </p>
            <div className="grid grid-cols-3 gap-1.5">
              {SIZES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setPageSize(s.id)}
                  aria-pressed={pageSize === s.id}
                  className={cn(
                    "rounded border px-2 py-1.5 font-mono text-[0.65rem] uppercase tracking-widest transition-colors",
                    pageSize === s.id
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/60 hover:text-primary",
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 font-mono text-[0.6rem] uppercase tracking-widest text-muted-foreground">
              Orientation
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => setOrientation("portrait")}
                aria-pressed={orientation === "portrait"}
                className={cn(
                  "flex items-center justify-center gap-2 rounded border px-2 py-1.5 font-mono text-[0.65rem] uppercase tracking-widest transition-colors",
                  orientation === "portrait"
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/60 hover:text-primary",
                )}
              >
                <RectangleVertical size={12} />
                Portrait
              </button>
              <button
                type="button"
                onClick={() => setOrientation("landscape")}
                aria-pressed={orientation === "landscape"}
                className={cn(
                  "flex items-center justify-center gap-2 rounded border px-2 py-1.5 font-mono text-[0.65rem] uppercase tracking-widest transition-colors",
                  orientation === "landscape"
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/60 hover:text-primary",
                )}
              >
                <RotateCcw size={12} className="hidden" />
                <RectangleHorizontal size={12} />
                Landscape
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={download}
            disabled={!turns.length}
            className="flex w-full items-center justify-center gap-2 rounded border border-primary/60 px-3 py-2 font-mono text-[0.65rem] uppercase tracking-widest text-primary transition-colors hover:bg-primary/15 disabled:opacity-40"
          >
            <FileDown size={13} />
            Download PDF
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
