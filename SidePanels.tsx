import { useState } from "react";
import {
  BellRing,
  Brain,
  CalendarDays,
  CheckCircle2,
  Circle,
  ListTodo,
  Search,
  StickyNote,
  Timer,
  Trash2,
} from "lucide-react";
import type { JarvisStore } from "@/lib/jarvis-storage";
import { cn } from "@/lib/utils";

function Panel({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="panel flex min-h-[9rem] flex-1 flex-col p-3">
      <header className="mb-2 flex items-center gap-2">
        <span className="text-primary">{icon}</span>
        <h2 className="panel-title">{title}</h2>
        <span className="scan-line ml-auto h-px w-10" />
      </header>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1 text-sm">{children}</div>
    </section>
  );
}

const Empty = ({ label }: { label: string }) => (
  <p className="font-mono text-[0.7rem] uppercase tracking-widest text-muted-foreground">{label}</p>
);

export const LEAD_OPTIONS = [5, 10, 15, 30, 60, 120, 1440];

const when = (at: number) =>
  new Date(at).toLocaleString([], {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

const DATE_RANGES = [
  { value: "all", label: "All dates" },
  { value: "today", label: "Today" },
  { value: "week", label: "Next 7 days" },
  { value: "upcoming", label: "Upcoming" },
  { value: "past", label: "Past" },
] as const;

function inRange(at: number, range: string) {
  const now = Date.now();
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  switch (range) {
    case "today":
      return at >= dayStart.getTime() && at < dayStart.getTime() + 86_400_000;
    case "week":
      return at >= now && at < now + 7 * 86_400_000;
    case "upcoming":
      return at >= now;
    case "past":
      return at < now;
    default:
      return true;
  }
}

function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <label className="mb-1.5 flex items-center gap-1.5 rounded border border-border/60 bg-background/60 px-2 py-1">
      <Search size={12} className="shrink-0 text-muted-foreground" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-transparent text-[0.75rem] outline-none placeholder:text-muted-foreground/70"
      />
    </label>
  );
}

export function SidePanels({ store }: { store: JarvisStore }) {
  const pending = store.reminders.filter((r) => !r.fired);
  const [eventQuery, setEventQuery] = useState("");
  const [eventRange, setEventRange] = useState<string>("all");
  const [noteQuery, setNoteQuery] = useState("");
  const [noteTag, setNoteTag] = useState<string | null>(null);

  const eq = eventQuery.trim().toLowerCase();
  const upcoming = [...store.events]
    .sort((a, b) => a.at - b.at)
    .filter(
      (e) =>
        inRange(e.at, eventRange) &&
        (eq === "" ||
          e.title.toLowerCase().includes(eq) ||
          (e.location ?? "").toLowerCase().includes(eq)),
    );

  const nq = noteQuery.trim().toLowerCase();
  const allTags = Array.from(new Set(store.notes.flatMap((n) => n.tags ?? []))).sort();
  const notes = store.notes.filter(
    (n) =>
      (noteTag === null || (n.tags ?? []).includes(noteTag)) &&
      (nq === "" ||
        n.text.toLowerCase().includes(nq) ||
        (n.title ?? "").toLowerCase().includes(nq) ||
        (n.tags ?? []).some((t) => t.includes(nq))),
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
      <Panel title="Calendar" icon={<CalendarDays size={14} />}>
        <div className="mb-1.5 flex items-center gap-1.5">
          <div className="flex-1">
            <SearchInput
              value={eventQuery}
              onChange={setEventQuery}
              placeholder="Search appointments..."
            />
          </div>
          <select
            value={eventRange}
            onChange={(e) => setEventRange(e.target.value)}
            className="mb-1.5 rounded border border-border/60 bg-background/60 px-1.5 py-1 font-mono text-[0.6rem] uppercase tracking-widest outline-none focus:border-primary/70"
            aria-label="Filter appointments by date"
          >
            {DATE_RANGES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        {store.events.length > 0 && upcoming.length === 0 && (
          <Empty label="No appointments match" />
        )}
        {store.events.length === 0 && <Empty label="No appointments scheduled" />}
        {upcoming.map((event) => {
          const past = event.at < Date.now();
          return (
            <div
              key={event.id}
              className="group flex items-start gap-2 rounded border border-border/60 px-2 py-1.5"
            >
              <div className={past ? "flex-1 text-muted-foreground" : "flex-1"}>
                <p className="leading-snug">{event.title}</p>
                <p className="font-mono text-[0.65rem] text-accent">
                  {when(event.at)}
                  {event.location ? ` · ${event.location}` : ""}
                </p>
                <label className="mt-1 flex items-center gap-1.5 font-mono text-[0.6rem] uppercase tracking-widest text-muted-foreground">
                  <BellRing size={11} className={event.remindMinutes == null ? "" : "text-primary"} />
                  <select
                    value={event.remindMinutes == null ? "off" : String(event.remindMinutes)}
                    onChange={(e) =>
                      store.setEventRemindMinutes(
                        event.id,
                        e.target.value === "off" ? null : Number(e.target.value),
                      )
                    }
                    className="rounded border border-border/60 bg-background/60 px-1.5 py-0.5 text-[0.6rem] uppercase tracking-widest outline-none focus:border-primary/70"
                    aria-label={`Alert time for ${event.title}`}
                  >
                    <option value="off">No alert</option>
                    {LEAD_OPTIONS.map((m) => (
                      <option key={m} value={m}>
                        {m < 60 ? `${m} min before` : `${m / 60} hr before`}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <button
                onClick={() => store.removeEvent(event.id)}
                className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                aria-label="Cancel appointment"
              >
                <Trash2 size={13} />
              </button>
            </div>
          );
        })}
      </Panel>

      <Panel title="Notes" icon={<StickyNote size={14} />}>
        <SearchInput value={noteQuery} onChange={setNoteQuery} placeholder="Search notes..." />
        {allTags.length > 0 && (
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[0.6rem] uppercase tracking-widest text-muted-foreground">
              Tags:
            </span>
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() => setNoteTag(noteTag === tag ? null : tag)}
                className={cn(
                  "rounded border px-1.5 py-0.5 font-mono text-[0.6rem] uppercase tracking-widest transition-colors",
                  noteTag === tag
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border/60 text-muted-foreground hover:border-primary/60 hover:text-primary",
                )}
                aria-label={`Filter by tag ${tag}`}
              >
                #{tag}
              </button>
            ))}
            {noteTag && (
              <button
                onClick={() => setNoteTag(null)}
                className="rounded border border-destructive/40 px-1.5 py-0.5 font-mono text-[0.6rem] uppercase tracking-widest text-destructive transition-colors hover:bg-destructive/10"
              >
                Clear
              </button>
            )}
          </div>
        )}
        {store.notes.length === 0 && <Empty label="No notes saved" />}
        {store.notes.length > 0 && notes.length === 0 && <Empty label="No notes match" />}
        {notes.map((note) => (
          <div
            key={note.id}
            className="group flex items-start gap-2 rounded border border-border/60 px-2 py-1.5"
          >
            <div className="flex-1">
              {note.title && (
                <p className="font-mono text-[0.65rem] uppercase tracking-widest text-primary">
                  {note.title}
                </p>
              )}
              <p className="whitespace-pre-wrap leading-snug">{note.text}</p>
              {(note.tags ?? []).length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {(note.tags ?? []).map((tag) => (
                    <button
                      key={tag}
                      onClick={() => setNoteTag(tag)}
                      className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[0.6rem] uppercase tracking-widest text-primary transition-colors hover:bg-primary/20"
                      aria-label={`Filter by tag ${tag}`}
                    >
                      #{tag}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={() => store.removeNote(note.id)}
              className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
              aria-label="Delete note"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </Panel>

      <Panel title="Memory Bank" icon={<Brain size={14} />}>
        {store.memories.length === 0 && <Empty label="No memories stored" />}
        {store.memories.map((memory) => (
          <div key={memory.id} className="group flex items-start gap-2 rounded border border-border/60 px-2 py-1.5">
            <span className="flex-1 leading-snug">{memory.text}</span>
            <button
              onClick={() => store.removeMemory(memory.id)}
              className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
              aria-label="Forget memory"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </Panel>

      <Panel title="Task List" icon={<ListTodo size={14} />}>
        {store.tasks.length === 0 && <Empty label="Nothing on the list" />}
        {store.tasks.map((task) => (
          <div key={task.id} className="group flex items-start gap-2 rounded border border-border/60 px-2 py-1.5">
            <button onClick={() => store.toggleTask(task.id)} className="mt-0.5 text-primary" aria-label="Toggle task">
              {task.done ? <CheckCircle2 size={14} /> : <Circle size={14} />}
            </button>
            <span className={task.done ? "flex-1 text-muted-foreground line-through" : "flex-1"}>
              {task.text}
            </span>
            <button
              onClick={() => store.removeTask(task.id)}
              className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
              aria-label="Delete task"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </Panel>

      <Panel title="Reminders & Timers" icon={<Timer size={14} />}>
        {pending.length === 0 && <Empty label="No pending alerts" />}
        {pending.map((reminder) => (
          <div key={reminder.id} className="flex items-center gap-2 rounded border border-border/60 px-2 py-1.5">
            <span className="flex-1 leading-snug">{reminder.text}</span>
            <span className="font-mono text-[0.7rem] text-accent">
              {new Date(reminder.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
            <button
              type="button"
              aria-label={`Delete reminder ${reminder.text}`}
              onClick={() => store.removeReminder(reminder.id)}
              className="text-muted-foreground transition-colors hover:text-destructive"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </Panel>
    </div>
  );
}
