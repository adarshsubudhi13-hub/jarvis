import { useMemo, useState } from "react";
import { FileDown, FileText, MessageSquare, MessageSquarePlus, Search, Trash2, X } from "lucide-react";
import type { ChatTurn } from "@/lib/jarvis-types";
import { exportConversation, type ExportFormat } from "@/lib/export-conversation";
import { PdfExportDialog } from "@/components/jarvis/PdfExportDialog";
import { cn } from "@/lib/utils";

export type SessionMeta = {
  id: string;
  title: string;
  updatedAt: number;
  turns: ChatTurn[];
};

const DAY_MS = 86_400_000;

function agoLabel(at: number) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  const span = Math.round((today.getTime() - d.getTime()) / DAY_MS);
  if (span === 0)
    return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (span === 1) return "Yesterday";
  return d.toLocaleDateString([], {
    day: "numeric",
    month: "short",
    year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

/**
 * ChatGPT-style list of previous conversations: search, reopen, continue, delete.
 */
export function SessionSidebar({
  sessions,
  activeId,
  hasUnsavedChat,
  onOpen,
  onNew,
  onDelete,
  onClose,
}: {
  sessions: SessionMeta[];
  activeId: string | null;
  hasUnsavedChat: boolean;
  onOpen: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onClose?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [pdfTarget, setPdfTarget] = useState<{ id: string; title?: string; turns: ChatTurn[] } | null>(null);
  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      sessions
        .filter(
          (s) =>
            q === "" ||
            s.title.toLowerCase().includes(q) ||
            s.turns.some((t) => t.text.toLowerCase().includes(q)),
        )
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [sessions, q],
  );

  return (
    <section className="panel flex h-full min-h-0 flex-col p-3">
      <header className="mb-2 flex items-center gap-2">
        <span className="text-primary">
          <MessageSquare size={14} />
        </span>
        <h2 className="panel-title">Conversations</h2>
        <span className="scan-line ml-auto h-px w-10" />
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close conversations list"
            className="text-muted-foreground transition-colors hover:text-destructive"
          >
            <X size={14} />
          </button>
        )}
      </header>

      <button
        type="button"
        onClick={onNew}
        className={cn(
          "mb-2 flex w-full items-center justify-center gap-2 rounded border px-3 py-2 font-mono text-[0.65rem] uppercase tracking-widest transition-colors",
          hasUnsavedChat
            ? "border-primary bg-primary/15 text-primary"
            : "border-border text-muted-foreground hover:border-primary/60 hover:text-primary",
        )}
      >
        <MessageSquarePlus size={13} />
        New chat
      </button>

      <label className="mb-2 flex items-center gap-1.5 rounded border border-border/60 bg-background/60 px-2 py-1">
        <Search size={12} className="shrink-0 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search chats..."
          className="w-full bg-transparent text-[0.75rem] outline-none placeholder:text-muted-foreground/70"
        />
      </label>

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
        {sessions.length === 0 && (
          <p className="font-mono text-[0.7rem] uppercase tracking-widest text-muted-foreground">
            No previous chats yet
          </p>
        )}
        {sessions.length > 0 && filtered.length === 0 && (
          <p className="font-mono text-[0.7rem] uppercase tracking-widest text-muted-foreground">
            Nothing matches
          </p>
        )}
        {filtered.map((session) => {
          const active = session.id === activeId || (hasUnsavedChat && false);
          return (
            <div
              key={session.id}
              className={cn(
                "group flex items-center gap-1.5 rounded border px-2 py-1.5 transition-colors",
                active
                  ? "border-primary bg-primary/15"
                  : "border-border/60 hover:border-primary/60",
              )}
            >
              <button
                type="button"
                onClick={() => onOpen(session.id)}
                className="min-w-0 flex-1 text-left"
                title={session.title}
              >
                <p
                  className={cn(
                    "truncate text-[0.8rem] leading-snug",
                    active ? "text-primary" : "text-foreground/90",
                  )}
                >
                  {session.title}
                </p>
                <p className="font-mono text-[0.6rem] uppercase tracking-widest text-muted-foreground">
                  {agoLabel(session.updatedAt)} · {session.turns.length} msgs
                </p>
              </button>
              <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                {(["txt", "pdf"] as ExportFormat[]).map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() =>
                      fmt === "pdf"
                        ? setPdfTarget({ id: session.id, title: session.title, turns: session.turns })
                        : exportConversation(session.turns, fmt, session.title)
                    }
                    disabled={!session.turns.length}
                    aria-label={`Export conversation ${session.title} as ${fmt.toUpperCase()}`}
                    title={fmt === "pdf" ? `Export as PDF (choose size & orientation)` : `Export as TXT`}
                    className="text-muted-foreground transition-colors hover:text-primary disabled:opacity-30"
                  >
                    {fmt === "txt" ? <FileText size={12} /> : <FileDown size={12} />}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => onDelete(session.id)}
                  aria-label={`Delete conversation ${session.title}`}
                  className="text-muted-foreground transition-colors hover:text-destructive"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          );
        })}
        {q && filtered.length > 0 && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="rounded border border-border/60 px-2 py-1 font-mono text-[0.6rem] uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary/60 hover:text-primary"
          >
            Clear search
          </button>
        )}
      </div>

      <PdfExportDialog
        open={!!pdfTarget}
        onOpenChange={(o) => {
          if (!o) setPdfTarget(null);
        }}
        turns={pdfTarget?.turns ?? []}
        title={pdfTarget?.title}
      />
    </section>
  );
}
