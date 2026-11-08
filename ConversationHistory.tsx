import { Download, FileDown, History, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { ChatTurn } from "@/lib/jarvis-types";
import { exportConversation } from "@/lib/export-conversation";
import { PdfExportDialog } from "@/components/jarvis/PdfExportDialog";

export function ConversationHistory({
  conversation,
  onClear,
}: {
  conversation: ChatTurn[];
  onClear: () => void;
}) {
  const [query, setQuery] = useState("");
  const [pdfOpen, setPdfOpen] = useState(false);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? conversation.filter((t) => t.text.toLowerCase().includes(q)) : conversation;
  }, [conversation, query]);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          title="Conversation history"
          className="flex items-center gap-2 rounded border border-border px-3 py-1.5 font-mono text-[0.65rem] uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary/60 hover:text-primary"
        >
          <History size={13} />
          History
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display tracking-[0.2em] text-primary">
            Conversation history
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conversations…"
            className="min-w-40 flex-1 rounded border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <button
            onClick={() => exportConversation(conversation, "txt")}
            disabled={!conversation.length}
            className="flex items-center gap-2 rounded border border-primary/60 px-3 py-2 font-mono text-[0.65rem] uppercase tracking-widest text-primary transition-colors hover:bg-primary/15 disabled:opacity-40"
          >
            <Download size={13} />
            Text
          </button>
          <button
            onClick={() => setPdfOpen(true)}
            disabled={!conversation.length}
            className="flex items-center gap-2 rounded border border-primary/60 px-3 py-2 font-mono text-[0.65rem] uppercase tracking-widest text-primary transition-colors hover:bg-primary/15 disabled:opacity-40"
          >
            <FileDown size={13} />
            PDF
          </button>
          <button
            onClick={onClear}
            disabled={!conversation.length}
            className="flex items-center gap-2 rounded border border-border px-3 py-2 font-mono text-[0.65rem] uppercase tracking-widest text-muted-foreground transition-colors hover:border-destructive/60 hover:text-destructive disabled:opacity-40"
          >
            <Trash2 size={13} />
            Clear
          </button>
        </div>

        <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
          {filtered.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {conversation.length ? "No matching messages." : "No saved conversations yet."}
            </p>
          )}
          {filtered.map((turn) => (
            <div key={turn.id} className="rounded border border-border p-3">
              <p className="font-mono text-[0.6rem] uppercase tracking-widest text-muted-foreground">
                {turn.role === "user" ? "You" : "JARVIS"} · {new Date(turn.at).toLocaleString()}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm">{turn.text}</p>
            </div>
          ))}
        </div>
      </DialogContent>

      <PdfExportDialog
        open={pdfOpen}
        onOpenChange={setPdfOpen}
        turns={conversation}
        title={undefined}
      />
    </Dialog>
  );
}
