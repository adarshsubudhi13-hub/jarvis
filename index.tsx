import { useChat } from "@ai-sdk/react";
import { createFileRoute } from "@tanstack/react-router";
import { DefaultChatTransport } from "ai";
import {
  AlertTriangle,
  Loader2,
  Mic,
  MicOff,
  PanelLeft,
  Paperclip,
  Radio,
  Send,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { AiCore } from "@/components/jarvis/AiCore";
import { ConversationHistory } from "@/components/jarvis/ConversationHistory";
import { exportConversation } from "@/lib/export-conversation";
import {
  conversationExportPdfOptions,
  mapConversationExportOutput,
} from "@/lib/conversation-export-result";
import { SessionSidebar } from "@/components/jarvis/SessionSidebar";
import { SidePanels } from "@/components/jarvis/SidePanels";
import { VoiceSettings } from "@/components/jarvis/VoiceSettings";
import { Link } from "@tanstack/react-router";
import { LogIn, LogOut } from "lucide-react";


import { useJarvisStore } from "@/lib/jarvis-storage";
import type { ChatTurn, JarvisState } from "@/lib/jarvis-types";
import { useVoice } from "@/lib/use-voice";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "JARVIS — Voice AI Assistant in Your Browser" },
      {
        name: "description",
        content:
          "Talk to JARVIS: a futuristic browser AI assistant with wake word voice control, spoken replies, memory, tasks and reminders.",
      },
      { property: "og:title", content: "JARVIS — Voice AI Assistant in Your Browser" },
      {
        property: "og:description",
        content:
          "Wake-word voice control, spoken replies, a personal memory bank, tasks and reminders.",
      },
    ],
  }),
  component: Jarvis,
});

function textOf(message: { parts?: Array<{ type: string; text?: string }> }) {
  return (message.parts ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("");
}

/** Rebuild chat messages from a saved session's turns. */
/** Options the AI chose for a conversation export, waiting for the stream to finish. */
type PendingExport = {
  format: "txt" | "pdf";
  pageSize?: "a4" | "letter" | "legal";
  orientation?: "portrait" | "landscape";
};

/** Convert chat messages into saved transcript turns. */
function turnsFromMessages(messages: Array<{ id: string; role: string; parts?: Array<{ type: string; text?: string }> }>): ChatTurn[] {
  return messages
    .map((m) => ({
      id: m.id,
      role: m.role === "user" ? ("user" as const) : ("assistant" as const),
      text: textOf(m).trim(),
      at: Date.now(),
    }))
    .filter((t) => t.text.length > 0 && (t.role === "user" || t.role === "assistant"));
}

function toUiMessages(turns: ChatTurn[]) {
  return turns.map((turn) => ({
    id: turn.id,
    role: turn.role,
    parts: [{ type: "text" as const, text: turn.text }],
  }));
}


function fileBodyText(file: { format: "txt" | "md" | "json"; content: string }) {
  if (file.format !== "json") return file.content;
  try {
    return JSON.stringify(JSON.parse(file.content), null, 2);
  } catch {
    return JSON.stringify({ content: file.content }, null, 2);
  }
}

const PREVIEW_LIMIT = 20000;

function filePreviewText(file: { format: "txt" | "md" | "json"; content: string }) {
  const body = fileBodyText(file);
  if (body.length <= PREVIEW_LIMIT) return body;
  return `${body.slice(0, PREVIEW_LIMIT)}\n… preview truncated — full content will be downloaded`;
}

function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!now) return <span className="font-mono text-2xl text-primary">--:--:--</span>;
  return (
    <div className="text-right">
      <p className="font-mono text-2xl leading-none text-primary">{now.toLocaleTimeString()}</p>
      <p className="font-mono text-[0.65rem] uppercase tracking-[0.3em] text-muted-foreground">
        {now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" })}
      </p>
    </div>
  );
}

function Jarvis() {
  const store = useJarvisStore();
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<
    Array<{ type: "file"; filename: string; mediaType: string; url: string }>
  >([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(async (list: FileList | null) => {
    if (!list?.length) return;
    const loaded = await Promise.all(
      Array.from(list).map(
        (file) =>
          new Promise<{ type: "file"; filename: string; mediaType: string; url: string } | null>(
            (resolve) => {
              if (file.size > 15 * 1024 * 1024) {
                toast.error(`${file.name} is larger than 15 MB`);
                resolve(null);
                return;
              }
              const reader = new FileReader();
              reader.onload = () =>
                resolve({
                  type: "file",
                  filename: file.name,
                  mediaType: file.type || "application/octet-stream",
                  url: String(reader.result),
                });
              reader.onerror = () => {
                toast.error(`Could not read ${file.name}`);
                resolve(null);
              };
              reader.readAsDataURL(file);
            },
          ),
      ),
    );
    const valid = loaded.filter(Boolean) as Array<{
      type: "file";
      filename: string;
      mediaType: string;
      url: string;
    }>;
    if (valid.length) setAttachments((prev) => [...prev, ...valid]);
  }, []);
  const [level, setLevel] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const handledTools = useRef<Set<string>>(new Set());
  const spokenIds = useRef<Set<string>>(new Set());
  const storeRef = useRef(store);
  storeRef.current = store;
  const voiceRef = useRef<ReturnType<typeof useVoice> | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const [pending, setPending] = useState<{ label: string; apply: () => void } | null>(null);
  const [pendingFile, setPendingFile] = useState<{
    base: string;
    format: "txt" | "md" | "json";
    content: string;
  } | null>(null);
  const [copiedPreview, setCopiedPreview] = useState(false);
  const [pendingExport, setPendingExport] = useState<PendingExport | null>(null);
  const [chatsOpen, setChatsOpen] = useState(true);

  const downloadFile = useCallback(
    (file: { base: string; format: "txt" | "md" | "json"; content: string }) => {
      const body = fileBodyText(file);
      const mime =
        file.format === "json"
          ? "application/json"
          : file.format === "md"
            ? "text/markdown"
            : "text/plain";
      const blob = new Blob([body], { type: `${mime};charset=utf-8` });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${file.base}.${file.format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setPendingFile(null);
      toast.success(`Saved ${file.base}.${file.format} to your downloads`);
    },
    [],
  );
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  const requestConfirm = (label: string, apply: () => void) => {
    if (!storeRef.current.confirmHighImpact) {
      apply();
      return;
    }
    setPending({ label, apply });
    toast.warning(`Confirm: ${label} — say “yes” or “no”`, { duration: 12000 });
    // Accept a spoken yes/no without needing the wake word again.
    voiceRef.current?.arm(45000);
    if (storeRef.current.voiceEnabled) {
      voiceRef.current?.speak(`Please confirm: ${label}. Say yes or no.`);
    }
  };


  const { messages, sendMessage, setMessages, status, error, stop } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      prepareSendMessagesRequest: ({ messages: msgs }) => ({
        body: {
          messages: msgs,
          context: {
            memories: storeRef.current.memories.map((m) => m.text),
            tasks: storeRef.current.tasks.filter((t) => !t.done).map((t) => t.text),
            events: storeRef.current.events.map(
              (e) => `${e.title} — ${new Date(e.at).toLocaleString()}${e.location ? ` @ ${e.location}` : ""}`,
            ),
            notes: storeRef.current.notes.map((n) => (n.title ? `${n.title}: ${n.text}` : n.text)),
            userName: storeRef.current.userName,
          },
        },
      }),
    }),
  });

  const busy = status === "submitted" || status === "streaming";
  stopRef.current = stop;

  const applySetting = (setting: string, raw: string) => {
    const truthy = /^(true|on|yes|enable|enabled)$/i.test(raw.trim());
    switch (setting) {
      case "spoken_replies":
        storeRef.current.setVoiceEnabled(truthy);
        break;
      case "speech_rate": {
        const rate = Number.parseFloat(raw);
        if (Number.isFinite(rate)) storeRef.current.setSpeechRate(Math.min(2, Math.max(0.5, rate)));
        break;
      }
      case "wake_word":
        storeRef.current.setWakeWord(raw.trim().toLowerCase());
        break;
      case "require_wake_word":
        storeRef.current.setWakeWordRequired(truthy);
        break;
      case "hands_free":
        storeRef.current.setHandsFree(truthy);
        break;
      default:
        break;
    }
  };

  const resolvePending = (accept: boolean) => {
    const item = pendingRef.current;
    if (!item) return;
    setPending(null);
    if (accept) {
      item.apply();
      toast.success("Confirmed");
      if (storeRef.current.voiceEnabled) voiceRef.current?.speak("Confirmed.");
    } else {
      toast("Cancelled");
      if (storeRef.current.voiceEnabled) voiceRef.current?.speak("Cancelled.");
    }
  };

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    if (pendingRef.current) {
      const spoken = trimmed.toLowerCase().replace(/^[\W_]+|[\W_]+$/g, "");
      if (
        /^(yes|yeah|yep|yup|sure|affirmative|confirm|confirmed|do it|go ahead|proceed|ok|okay|please do)\b/i.test(
          spoken,
        )
      ) {
        resolvePending(true);
        return;
      }
      if (
        /^(no|nope|nah|cancel|don'?t|do not|negative|abort|stop|forget it|never ?mind)\b/i.test(
          spoken,
        )
      ) {
        resolvePending(false);
        return;
      }
    }
    if (busy) return;
    voice.shutUp();
    sendMessage({
      text: trimmed || "Please review the attached file(s).",
      ...(attachments.length ? { files: attachments } : {}),
    });
    setAttachments([]);
    setInput("");
  };

  const voice = useVoice({
    onFinalTranscript: (text) => submit(text),
    onWake: () => {
      const greeting = ["Yes?", "At your service.", "Listening.", "Go ahead."][
        Math.floor(Math.random() * 4)
      ]!;
      toast(greeting, { duration: 2500 });
      if (storeRef.current.voiceEnabled) voiceRef.current?.speak(greeting);
    },
    onInterrupt: () => {
      stopRef.current?.();
      if (pendingRef.current) {
        setPending(null);
        toast("Cancelled");
        return;
      }
      toast("Stopped.", { duration: 1500 });
    },
    busy,
    wakeWord: store.wakeWord,
    wakeWordRequired: store.wakeWordRequired,
    speechRate: store.speechRate,
    micDeviceId: store.micDeviceId,
  });
  voiceRef.current = voice;

  // Apply the persisted preference exactly once. Later changes are user-driven only.
  const startupMicAppliedRef = useRef(false);
  useEffect(() => {
    if (startupMicAppliedRef.current) return;
    if (!store.loaded || !voice.supported) return;
    startupMicAppliedRef.current = true;
    if (store.handsFree) voice.startWakeMode();
  }, [store.loaded, store.handsFree, voice.supported, voice.startWakeMode]);

  // User-driven toggle: persist the choice, then apply it. No effect ever
  // writes back to the saved preference, so nothing can re-enable the mic.
  const handleWakeToggle = useCallback(() => {
    const next = !voice.wakeMode;
    store.setHandsFree(next);
    if (next) voice.startWakeMode();
    else voice.stop();
  }, [voice.wakeMode, voice.startWakeMode, voice.stop, store.setHandsFree]);

  const handleMicClick = useCallback(() => {
    if (voice.listening) {
      store.setHandsFree(false);
      voice.stop();
    } else {
      voice.start();
    }
  }, [voice.listening, voice.start, voice.stop, store.setHandsFree]);

  /** Reopen a saved conversation and continue it where it left off. */
  const openChat = useCallback(
    (sessionId: string) => {
      const session = storeRef.current.sessions.find((s) => s.id === sessionId);
      storeRef.current.openSession(sessionId);
      setMessages(session ? toUiMessages(session.turns) : []);
      for (const turn of session?.turns ?? []) spokenIds.current.add(turn.id);
    },
    [setMessages],
  );

  /** Start a fresh chat; the next message opens a new session. */
  const newChat = useCallback(() => {
    setMessages([]);
    storeRef.current.newConversation();
  }, [setMessages]);

  const deleteChat = useCallback(
    (sessionId: string) => {
      const wasActive = storeRef.current.activeSessionId === sessionId;
      storeRef.current.deleteSession(sessionId);
      if (wasActive) setMessages([]);
    },
    [setMessages],
  );





  // Apply tool results to local state
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant") return;
    for (const part of last.parts as Array<any>) {
      if (!part?.type?.startsWith("tool-") || part.state !== "output-available") continue;
      const key = part.toolCallId as string;
      if (handledTools.current.has(key)) continue;
      handledTools.current.add(key);
      const output = part.output as any;
      if (!output?.kind) continue;
      switch (output.kind) {
        case "memory_saved":
          store.addMemory(output.text);
          toast.success("Memory stored");
          break;
        case "memory_deleted":
          requestConfirm(`delete the memory "${output.text}"`, () => {
            storeRef.current.removeMemory(output.text);
            toast("Memory removed");
          });
          break;
        case "setting_updated":
          requestConfirm(`change ${output.setting.replace(/_/g, " ")} to ${output.value}`, () => {
            applySetting(output.setting, output.value);
            toast.success("Setting updated");
          });
          break;
        case "task_added":
          store.addTask(output.text);
          toast.success("Task added");
          break;
        case "task_completed":
          store.completeTask(output.text);
          break;
        case "reminder_set":
        case "timer_set":
          store.addReminder(output.text, output.at);
          toast.success("Alert scheduled");
          break;
        case "event_scheduled":
          store.addEvent(output.title, output.at, output.location, output.remindMinutes);
          toast.success("Appointment scheduled");
          break;
        case "event_reminder_set": {
          const target = storeRef.current.events.find((e) =>
            e.title.toLowerCase().includes(String(output.title).toLowerCase()),
          );
          if (target) {
            store.setEventRemindMinutes(target.id, output.minutesBefore);
            toast.success("Appointment alert updated");
          }
          break;
        }
        case "event_cancelled":
          requestConfirm(`cancel the appointment "${output.title}"`, () => {
            storeRef.current.removeEvent(output.title);
            toast("Appointment cancelled");
          });
          break;
        case "note_saved":
          store.addNote(output.text, output.title, output.tags);
          toast.success("Note saved");
          break;
        case "note_deleted":
          requestConfirm(`delete the note "${output.text}"`, () => {
            storeRef.current.removeNote(output.text);
            toast("Note deleted");
          });
          break;
        case "conversation_exported": {
          // The tool fires mid-stream, before this turn is recorded, so defer
          // the export until the reply finishes and the transcript is complete.
          setPendingExport(
            mapConversationExportOutput({
              format: output.format,
              page_size: output.page_size,
              orientation: output.orientation,
            }),
          );
          break;
        }
        case "site_opened":
          window.open(output.url, "_blank", "noopener");
          break;
        case "file_written": {
          const base = String(output.filename).replace(/\.(txt|md|json)$/i, "");
          setPendingFile({ base, format: output.format, content: output.content });
          break;
        }

        default:
          break;
      }
    }
  }, [messages, store]);

  // Speak completed assistant replies
  useEffect(() => {
    if (busy) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant" || spokenIds.current.has(last.id)) return;
    spokenIds.current.add(last.id);
    if (store.voiceEnabled) voice.speak(textOf(last as any));
  }, [messages, busy, store.voiceEnabled, voice]);

  // Reminder watcher
  useEffect(() => {
    const timer = setInterval(() => {
      const due = storeRef.current.reminders.filter((r) => !r.fired && r.at <= Date.now());
      due.forEach((reminder) => {
        storeRef.current.fireReminder(reminder.id);
        toast.warning(`Reminder: ${reminder.text}`, { duration: 10000 });
        if (storeRef.current.voiceEnabled) voice.speak(`Reminder. ${reminder.text}`);
      });

      // Appointment alerts, fired a chosen number of minutes before the event.
      const now = Date.now();
      storeRef.current.events
        .filter(
          (e) =>
            !e.alerted &&
            e.remindMinutes !== null &&
            e.remindMinutes !== undefined &&
            now >= e.at - e.remindMinutes * 60_000 &&
            now < e.at + 60 * 60_000,
        )
        .forEach((event) => {
          storeRef.current.markEventAlerted(event.id);
          const mins = Math.max(0, Math.round((event.at - now) / 60_000));
          const lead =
            mins <= 0 ? "starting now" : mins === 1 ? "in 1 minute" : `in ${mins} minutes`;
          toast.warning(`Appointment ${lead}: ${event.title}`, { duration: 12000 });
          if (storeRef.current.voiceEnabled) {
            voice.speak(
              `Heads up. ${event.title} is ${lead}${event.location ? ` at ${event.location}` : ""}.`,
            );
          }
        });
    }, 5000);
    return () => clearInterval(timer);
  }, [voice]);

  // Pulse the core while active
  useEffect(() => {
    if (!busy && !voice.listening && !voice.speaking) {
      setLevel(0);
      return;
    }
    const timer = setInterval(() => setLevel(Math.random() * 0.9), 140);
    return () => clearInterval(timer);
  }, [busy, voice.listening, voice.speaking]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // Keep a saved transcript of the conversation.
  useEffect(() => {
    if (busy) return;
    storeRef.current.recordTurns(turnsFromMessages(messages));
  }, [messages, busy]);

  // Carry out a requested conversation export once the reply has finished.
  useEffect(() => {
    if (busy || !pendingExport) return;
    const turns = turnsFromMessages(messages);
    setPendingExport(null);
    if (!turns.length) return;
    const pdfOptions = conversationExportPdfOptions(pendingExport);
    exportConversation(turns, pendingExport.format, storeRef.current.activeSession?.title, pdfOptions)
      .then(() => toast.success(`Transcript downloaded as ${pendingExport.format.toUpperCase()}`))
      .catch(() => toast.error("Could not export the conversation"));
  }, [busy, pendingExport, messages]);


  useEffect(() => {
    if (error) toast.error(error.message || "JARVIS could not reach the AI service.");
  }, [error]);

  const state: JarvisState = useMemo(() => {
    if (error) return "ERROR";
    if (status === "submitted") return "THINKING";
    if (status === "streaming") return "EXECUTING";
    if (voice.speaking) return "SPEAKING";
    if (voice.listening) return "LISTENING";
    return "IDLE";
  }, [error, status, voice.speaking, voice.listening]);

  return (
    <main className="flex h-screen flex-col gap-3 overflow-hidden p-3 lg:p-5">
      <header className="panel flex items-center gap-4 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/70" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
          </span>
          <div>
            <h1 className="font-display text-lg leading-none tracking-[0.35em] text-primary">
              JARVIS
            </h1>
            <p className="font-mono text-[0.6rem] uppercase tracking-[0.25em] text-muted-foreground">
              Just A Rather Very Intelligent System
            </p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-4">
          <span
            aria-live="polite"
            className={cn(
              "flex items-center gap-2 rounded border px-3 py-1.5 font-mono text-[0.65rem] uppercase tracking-widest transition-colors",
              voice.listening
                ? "border-primary bg-primary/15 text-primary shadow-[0_0_24px_-8px_var(--glow)]"
                : "border-border text-muted-foreground",
            )}
          >
            {voice.listening ? (
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/70" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
            ) : (
              <MicOff size={13} />
            )}
            {voice.listening ? (voice.awake ? "Listening — go ahead" : "Listening") : "Mic off"}
          </span>
          <button
            onClick={() => store.setVoiceEnabled(!store.voiceEnabled)}
            className="flex items-center gap-2 rounded border border-border px-3 py-1.5 font-mono text-[0.65rem] uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary/60 hover:text-primary"
          >
            {store.voiceEnabled ? <Volume2 size={13} /> : <VolumeX size={13} />}
            {store.voiceEnabled ? "Voice on" : "Muted"}
          </button>
          <ConversationHistory
            conversation={store.conversation}
            onClear={store.clearConversation}
          />
          {store.user ? (
            <button
              onClick={() => void store.signOut()}
              title={store.user.email}
              className="flex items-center gap-2 rounded border border-border px-3 py-1.5 font-mono text-[0.65rem] uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary/60 hover:text-primary"
            >
              <LogOut size={13} />
              <span className="max-w-32 truncate normal-case tracking-normal">
                {store.user.email}
              </span>
            </button>
          ) : (
            <Link
              to="/auth"
              className="flex items-center gap-2 rounded border border-border px-3 py-1.5 font-mono text-[0.65rem] uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary/60 hover:text-primary"
            >
              <LogIn size={13} />
              Sign in
            </Link>
          )}
          <VoiceSettings store={store} onPreview={(text) => voice.speak(text)} />

          <Clock />
        </div>

      </header>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <section className="panel hidden flex-col items-center justify-center gap-6 p-6 lg:flex">
          <AiCore state={state} level={level} />
          <div className="w-full space-y-2">
            <button
              onClick={handleWakeToggle}
              disabled={!voice.supported}
              className={cn(
                "flex w-full items-center justify-center gap-2 rounded border px-4 py-2.5 font-display text-xs uppercase tracking-[0.25em] transition-all disabled:cursor-not-allowed disabled:opacity-40",
                voice.wakeMode
                  ? "border-primary bg-primary/15 text-primary shadow-[0_0_30px_-8px_var(--glow)]"
                  : "border-border text-muted-foreground hover:border-primary/60 hover:text-primary",
              )}
            >
              <Radio size={14} />
              {voice.wakeMode
                ? voice.awake
                  ? "Awaiting your command…"
                  : store.wakeWordRequired
                    ? `Say "${store.wakeWord}" anytime`
                    : "Always listening"
                : "Enable hands-free listening"}
            </button>

            {voice.interim && (
              <p className="truncate text-center font-mono text-[0.7rem] text-muted-foreground">
                “{voice.interim}”
              </p>
            )}
            {!voice.supported && (
              <p className="flex items-center justify-center gap-2 text-center font-mono text-[0.65rem] uppercase tracking-widest text-accent">
                <AlertTriangle size={12} /> Mic unsupported — use text
              </p>
            )}
            {voice.error && (
              <p className="text-center font-mono text-[0.65rem] uppercase tracking-widest text-destructive">
                {voice.error}
              </p>
            )}
          </div>
        </section>

        <section className="panel flex min-h-0 flex-col">
          <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
            <button
              type="button"
              onClick={() => setChatsOpen((open) => !open)}
              aria-pressed={chatsOpen}
              aria-label="Past conversations"
              title={chatsOpen ? "Hide past conversations" : "Show past conversations"}
              className="text-muted-foreground transition-colors hover:text-primary"
            >
              <PanelLeft size={14} />
            </button>
            <h2 className="panel-title">Conversation</h2>
            <span className="scan-line ml-auto h-px w-16" />
            <span className="font-mono text-[0.6rem] uppercase tracking-widest text-muted-foreground">
              {state}
            </span>
          </header>

          <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            {messages.length === 0 && (
              <div className="space-y-3 py-8 text-center">
                <p className="font-display text-sm tracking-[0.2em] text-primary">
                  Systems online. How can I help?
                </p>
                <div className="mx-auto grid max-w-sm gap-1.5 text-left">
                  {[
                    "Remember that I prefer meetings after 2pm",
                    "Add finish the DSA assignment to my task list",
                    "Remind me to stretch in 20 minutes",
                    "Open a web search for the weather in Bhubaneswar",
                  ].map((example) => (
                    <button
                      key={example}
                      onClick={() => submit(example)}
                      className="rounded border border-border/70 px-3 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
                    >
                      {example}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((message) => {
              const body = textOf(message as any);
              const files = ((message.parts ?? []) as Array<any>).filter(
                (part) => part?.type === "file",
              );
              const isUser = message.role === "user";
              return (
                <div key={message.id} className={cn("flex", isUser ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[85%] rounded-lg px-3.5 py-2.5 text-sm leading-relaxed",
                      isUser
                        ? "border border-accent/40 bg-accent/10"
                        : "border border-primary/30 bg-primary/5",
                    )}
                  >
                    <p className="mb-1 font-mono text-[0.55rem] uppercase tracking-[0.25em] text-muted-foreground">
                      {isUser ? "You" : "Jarvis"}
                    </p>
                    {files.length > 0 && (
                      <div className="mb-2 flex flex-wrap gap-2">
                        {files.map((file, index) =>
                          String(file.mediaType).startsWith("image/") ? (
                            <img
                              key={index}
                              src={file.url}
                              alt={file.filename ?? "attachment"}
                              className="max-h-32 rounded border border-border object-cover"
                            />
                          ) : (
                            <span
                              key={index}
                              className="flex items-center gap-1.5 rounded border border-border px-2 py-1 font-mono text-[0.6rem] text-muted-foreground"
                            >
                              <Paperclip size={10} />
                              {file.filename ?? file.mediaType}
                            </span>
                          ),
                        )}
                      </div>
                    )}
                    {body ? (
                      <div className="space-y-2 [&_a]:text-primary [&_a]:underline [&_li]:ml-4 [&_li]:list-disc">
                        <ReactMarkdown>{body}</ReactMarkdown>
                      </div>
                    ) : (
                      <span className="font-mono text-xs text-muted-foreground">working…</span>
                    )}
                  </div>
                </div>
              );
            })}

            {busy && (
              <div className="flex items-center gap-2 font-mono text-[0.65rem] uppercase tracking-widest text-primary">
                <Loader2 size={12} className="animate-spin" /> processing
              </div>
            )}
          </div>

          {pending && (
            <div className="flex flex-wrap items-center gap-3 border-t border-accent/40 bg-accent/10 px-3 py-2.5">
              <AlertTriangle size={14} className="text-accent" />
              <p className="flex-1 text-sm">
                Confirm required — {pending.label}?{" "}
                <span className="font-mono text-[0.65rem] uppercase tracking-widest text-muted-foreground">
                  say yes or no
                </span>
              </p>
              <button
                type="button"
                onClick={() => resolvePending(true)}
                className="rounded border border-primary px-3 py-1.5 font-mono text-[0.6rem] uppercase tracking-widest text-primary hover:bg-primary/15"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={() => resolvePending(false)}
                className="rounded border border-border px-3 py-1.5 font-mono text-[0.6rem] uppercase tracking-widest text-muted-foreground hover:border-destructive hover:text-destructive"
              >
                Cancel
              </button>
            </div>
          )}

          {pendingFile && (
            <div className="border-t border-primary/40 bg-primary/10 px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-3">
                <p className="flex-1 text-sm">
                  <span className="font-mono text-primary">{pendingFile.base}</span> is ready —
                  pick a format, preview it, then download
                </p>
                {(["txt", "md", "json"] as const).map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => setPendingFile({ ...pendingFile, format: fmt })}
                    className={cn(
                      "rounded border px-3 py-1.5 font-mono text-[0.6rem] uppercase tracking-widest",
                      fmt === pendingFile.format
                        ? "border-primary bg-primary/20 text-primary"
                        : "border-border text-muted-foreground hover:border-primary hover:text-primary",
                    )}
                  >
                    .{fmt}
                  </button>
                ))}
              </div>
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded border border-primary/30 bg-background/70 p-2.5 font-mono text-xs leading-relaxed text-foreground/90">
                {filePreviewText(pendingFile)}
              </pre>
              <div className="mt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(filePreviewText(pendingFile));
                      setCopiedPreview(true);
                      setTimeout(() => setCopiedPreview(false), 1500);
                    } catch {
                      toast.error("Couldn't copy — try again");
                    }
                  }}
                  className="rounded border border-border px-3 py-1.5 font-mono text-[0.6rem] uppercase tracking-widest text-muted-foreground hover:border-primary hover:text-primary"
                >
                  {copiedPreview ? "Copied!" : "Copy"}
                </button>
                <button
                  type="button"
                  onClick={() => downloadFile({ ...pendingFile })}
                  className="rounded border border-primary bg-primary/20 px-3 py-1.5 font-mono text-[0.6rem] uppercase tracking-widest text-primary hover:bg-primary/30"
                >
                  Download .{pendingFile.format}
                </button>
                <button
                  type="button"
                  onClick={() => setPendingFile(null)}
                  className="rounded border border-border px-3 py-1.5 font-mono text-[0.6rem] uppercase tracking-widest text-muted-foreground hover:border-destructive hover:text-destructive"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 border-t border-border px-3 pt-3">
              {attachments.map((file, index) => (
                <span
                  key={`${file.filename}-${index}`}
                  className="flex items-center gap-2 rounded border border-primary/40 bg-primary/10 px-2 py-1 font-mono text-[0.6rem] text-primary"
                >
                  {file.mediaType.startsWith("image/") && (
                    <img src={file.url} alt="" className="h-6 w-6 rounded object-cover" />
                  )}
                  <span className="max-w-[10rem] truncate">{file.filename}</span>
                  <button
                    type="button"
                    onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== index))}
                    aria-label={`Remove ${file.filename}`}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit(input);
            }}
            className="flex items-center gap-2 border-t border-border p-3"
          >
            <button
              type="button"
              onClick={handleMicClick}
              disabled={!voice.supported}
              className={cn(
                "rounded-full border p-2.5 transition-all disabled:opacity-40",
                voice.listening
                  ? "border-primary bg-primary/20 text-primary shadow-[0_0_24px_-6px_var(--glow)]"
                  : "border-border text-muted-foreground hover:border-primary/60 hover:text-primary",
              )}
              aria-label="Toggle microphone"
            >
              {voice.supported ? <Mic size={16} /> : <MicOff size={16} />}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,application/pdf,text/*,audio/*,video/*"
              className="hidden"
              onChange={(event) => {
                void addFiles(event.target.files);
                event.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded-full border border-border p-2.5 text-muted-foreground transition-colors hover:border-primary/60 hover:text-primary"
              aria-label="Attach files"
              title="Attach files or media"
            >
              <Paperclip size={16} />
            </button>
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={voice.listening ? "Listening…" : "Speak, type, or attach a file"}
              className="flex-1 rounded border border-border bg-background/50 px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/70"
            />
            {voice.speaking && (
              <button
                type="button"
                onClick={voice.shutUp}
                className="rounded border border-border px-3 py-2 font-mono text-[0.6rem] uppercase tracking-widest text-muted-foreground hover:text-destructive"
              >
                Stop
              </button>
            )}
            <button
              type="submit"
              disabled={busy || (!input.trim() && attachments.length === 0)}
              className="rounded border border-primary/60 bg-primary/15 p-2.5 text-primary transition-colors hover:bg-primary/25 disabled:opacity-40"
              aria-label="Send"
            >
              <Send size={16} />
            </button>
          </form>
        </section>

        <aside className="flex min-h-0 flex-col gap-3">
          <div className={cn("min-h-0 flex-[0.85] flex-col", chatsOpen ? "flex" : "hidden")}>
            <SessionSidebar
              sessions={store.sessions}
              activeId={store.activeSessionId}
              hasUnsavedChat={store.activeSessionId === null && messages.length > 0}
              onOpen={openChat}
              onNew={newChat}
              onDelete={deleteChat}
              onClose={() => setChatsOpen(false)}
            />
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            <SidePanels store={store} />
          </div>
        </aside>
      </div>
    </main>
  );
}
