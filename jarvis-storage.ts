import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type {
  CalendarEvent,
  ChatTurn,
  ConversationSession,
  Memory,
  Note,
  Reminder,
  Task,
} from "./jarvis-types";

const KEY = "jarvis.store.v1";

type Store = {
  memories: Memory[];
  tasks: Task[];
  reminders: Reminder[];
  events: CalendarEvent[];
  notes: Note[];
  /** Saved conversation sessions, newest activity first. */
  sessions: ConversationSession[];
  /** Session currently open in the chat; null = a fresh, unsaved chat. */
  activeSessionId: string | null;
  userName: string;
  voiceEnabled: boolean;
  micDeviceId: string;
  speechRate: number;
  wakeWord: string;
  wakeWordRequired: boolean;
  handsFree: boolean;
  confirmHighImpact: boolean;
  /** Default minutes before an appointment to alert. */
  eventLeadMinutes: number;
};

const EMPTY: Store = {
  memories: [],
  tasks: [],
  reminders: [],
  events: [],
  notes: [],
  sessions: [],
  activeSessionId: null,
  userName: "",
  voiceEnabled: true,
  micDeviceId: "",
  speechRate: 1.03,
  wakeWord: "jarvis",
  wakeWordRequired: true,
  handsFree: true,
  confirmHighImpact: true,
  eventLeadMinutes: 15,
};

const MAX_SESSIONS = 100;
const MAX_TURNS = 500;

const id = () => Math.random().toString(36).slice(2, 10);

/** Derive a session title from its first user message. */
function titleFrom(turns: ChatTurn[]) {
  const first = turns.find((t) => t.role === "user") ?? turns[0];
  const text = (first?.text ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "New conversation";
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

/** Upgrade older saves that held one flat transcript into a session list. */
function migrateStore(raw: Partial<Store> & { conversation?: ChatTurn[] }): Store {
  const base: Store = {
    ...EMPTY,
    ...raw,
    sessions: raw.sessions ?? [],
    activeSessionId: raw.activeSessionId ?? null,
  };
  const legacy = raw.conversation;
  if (!base.sessions.length && legacy?.length) {
    const session: ConversationSession = {
      id: id(),
      title: titleFrom(legacy),
      createdAt: legacy[0]!.at,
      updatedAt: legacy[legacy.length - 1]!.at,
      turns: legacy,
    };
    base.sessions = [session];
    base.activeSessionId = session.id;
  }
  return base;
}

export function useJarvisStore() {
  const [store, setStore] = useState<Store>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [user, setUser] = useState<{ id: string; email: string } | null>(null);
  const [cloudReady, setCloudReady] = useState(false);
  const storeRef = useRef(store);
  storeRef.current = store;

  // Timestamp of the latest local change, so stale cloud copies never overwrite newer edits
  // (e.g. a deleted note coming back after refresh).
  const changedAtRef = useRef(0);
  const skipStampRef = useRef(true);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setStore(migrateStore(JSON.parse(raw) as Partial<Store>));
      changedAtRef.current = Number(localStorage.getItem(KEY + ".changedAt") ?? 0) || 0;
    } catch {
      /* ignore corrupt state */
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (skipStampRef.current) {
      skipStampRef.current = false;
    } else {
      changedAtRef.current = Date.now();
      localStorage.setItem(KEY + ".changedAt", String(changedAtRef.current));
    }
    localStorage.setItem(KEY, JSON.stringify(store));
  }, [store, loaded]);

  // Track the signed-in account.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user;
      setUser((prev) => (prev?.id === u?.id ? prev : u ? { id: u.id, email: u.email ?? "" } : null));
      if (!u) setCloudReady(false);
    });
    void supabase.auth.getSession().then(({ data }) => {
      const u = data.session?.user;
      setUser((prev) => (prev?.id === u?.id ? prev : u ? { id: u.id, email: u.email ?? "" } : null));
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const push = useCallback((userId: string, data: Store) => {
    const at = changedAtRef.current || Date.now();
    return supabase
      .from("jarvis_state")
      .upsert({ user_id: userId, data: data as never, updated_at: new Date(at).toISOString() });
  }, []);

  // Pull the account's saved data once signed in; keep whichever copy is newer.
  useEffect(() => {
    if (!loaded || !user) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("jarvis_state")
        .select("data, updated_at")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled || error) return;
      const remote = (data?.data ?? null) as (Partial<Store> & { conversation?: ChatTurn[] }) | null;
      const remoteAt = data?.updated_at ? new Date(data.updated_at).getTime() : 0;
      if (remote && Object.keys(remote).length > 0 && remoteAt > changedAtRef.current) {
        skipStampRef.current = true;
        changedAtRef.current = remoteAt;
        localStorage.setItem(KEY + ".changedAt", String(remoteAt));
        setStore(migrateStore(remote));
      } else {
        await push(user.id, storeRef.current);
      }
      if (!cancelled) setCloudReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [loaded, user, push]);

  // Push changes to the account quickly, and flush when the tab is hidden/closed.
  useEffect(() => {
    if (!user || !cloudReady) return;
    const timer = setTimeout(() => void push(user.id, store), 300);
    return () => clearTimeout(timer);
  }, [store, user, cloudReady, push]);

  useEffect(() => {
    if (!user || !cloudReady) return;
    const flush = () => void push(user.id, storeRef.current);
    const onVis = () => document.visibilityState === "hidden" && flush();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", flush);
    };
  }, [user, cloudReady, push]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const api = {
    addMemory: useCallback((text: string) => {
      setStore((s) =>
        s.memories.some((m) => m.text.toLowerCase() === text.toLowerCase())
          ? s
          : { ...s, memories: [{ id: id(), text, createdAt: Date.now() }, ...s.memories] },
      );
    }, []),
    removeMemory: useCallback((match: string) => {
      setStore((s) => ({
        ...s,
        memories: s.memories.filter(
          (m) => m.id !== match && !m.text.toLowerCase().includes(match.toLowerCase()),
        ),
      }));
    }, []),
    addTask: useCallback((text: string) => {
      setStore((s) => ({
        ...s,
        tasks: [{ id: id(), text, done: false, createdAt: Date.now() }, ...s.tasks],
      }));
    }, []),
    toggleTask: useCallback((match: string) => {
      setStore((s) => ({
        ...s,
        tasks: s.tasks.map((t) =>
          t.id === match || t.text.toLowerCase().includes(match.toLowerCase())
            ? { ...t, done: !t.done }
            : t,
        ),
      }));
    }, []),
    completeTask: useCallback((match: string) => {
      setStore((s) => ({
        ...s,
        tasks: s.tasks.map((t) =>
          t.id === match || t.text.toLowerCase().includes(match.toLowerCase())
            ? { ...t, done: true }
            : t,
        ),
      }));
    }, []),
    removeTask: useCallback((taskId: string) => {
      setStore((s) => ({ ...s, tasks: s.tasks.filter((t) => t.id !== taskId) }));
    }, []),
    addReminder: useCallback((text: string, at: number) => {
      setStore((s) => ({
        ...s,
        reminders: [...s.reminders, { id: id(), text, at, fired: false }].sort(
          (a, b) => a.at - b.at,
        ),
      }));
    }, []),
    fireReminder: useCallback((reminderId: string) => {
      setStore((s) => ({
        ...s,
        reminders: s.reminders.map((r) => (r.id === reminderId ? { ...r, fired: true } : r)),
      }));
    }, []),
    removeReminder: useCallback((reminderId: string) => {
      setStore((s) => ({ ...s, reminders: s.reminders.filter((r) => r.id !== reminderId) }));
    }, []),
    addEvent: useCallback(
      (title: string, at: number, location?: string, remindMinutes?: number | null) => {
        setStore((s) => ({
          ...s,
          events: [
            ...s.events,
            {
              id: id(),
              title,
              at,
              location,
              remindMinutes: remindMinutes === undefined ? s.eventLeadMinutes : remindMinutes,
              alerted: false,
              createdAt: Date.now(),
            },
          ].sort((a, b) => a.at - b.at),
        }));
      },
      [],
    ),
    setEventRemindMinutes: useCallback((eventId: string, remindMinutes: number | null) => {
      setStore((s) => ({
        ...s,
        events: s.events.map((e) =>
          e.id === eventId ? { ...e, remindMinutes, alerted: false } : e,
        ),
      }));
    }, []),
    markEventAlerted: useCallback((eventId: string) => {
      setStore((s) => ({
        ...s,
        events: s.events.map((e) => (e.id === eventId ? { ...e, alerted: true } : e)),
      }));
    }, []),
    setEventLeadMinutes: useCallback(
      (eventLeadMinutes: number) => setStore((s) => ({ ...s, eventLeadMinutes })),
      [],
    ),
    removeEvent: useCallback((match: string) => {
      setStore((s) => ({
        ...s,
        events: s.events.filter(
          (e) => e.id !== match && !e.title.toLowerCase().includes(match.toLowerCase()),
        ),
      }));
    }, []),
    addNote: useCallback((text: string, title?: string, tags?: string[]) => {
      const clean = (tags ?? [])
        .map((t) => t.trim().toLowerCase().replace(/^#/, ""))
        .filter(Boolean);
      setStore((s) => ({
        ...s,
        notes: [
          { id: id(), title, text, tags: Array.from(new Set(clean)), createdAt: Date.now() },
          ...s.notes,
        ],
      }));
    }, []),
    removeNote: useCallback((match: string) => {
      setStore((s) => ({
        ...s,
        notes: s.notes.filter(
          (n) =>
            n.id !== match &&
            !n.text.toLowerCase().includes(match.toLowerCase()) &&
            !(n.title ?? "").toLowerCase().includes(match.toLowerCase()),
        ),
      }));
    }, []),
    setUserName: useCallback((userName: string) => setStore((s) => ({ ...s, userName })), []),
    setVoiceEnabled: useCallback(
      (voiceEnabled: boolean) => setStore((s) => ({ ...s, voiceEnabled })),
      [],
    ),
    setMicDeviceId: useCallback(
      (micDeviceId: string) => setStore((s) => ({ ...s, micDeviceId })),
      [],
    ),
    setSpeechRate: useCallback((speechRate: number) => setStore((s) => ({ ...s, speechRate })), []),
    setWakeWord: useCallback(
      (wakeWord: string) => setStore((s) => ({ ...s, wakeWord: wakeWord || "jarvis" })),
      [],
    ),
    setWakeWordRequired: useCallback(
      (wakeWordRequired: boolean) => setStore((s) => ({ ...s, wakeWordRequired })),
      [],
    ),
    setHandsFree: useCallback((handsFree: boolean) => setStore((s) => ({ ...s, handsFree })), []),
    setConfirmHighImpact: useCallback(
      (confirmHighImpact: boolean) => setStore((s) => ({ ...s, confirmHighImpact })),
      [],
    ),
    /** Save completed turns into the open session (creating one on the first message). */
    recordTurns: useCallback((turns: ChatTurn[]) => {
      if (!turns.length) return;
      setStore((s) => {
        const existing = s.sessions.find((x) => x.id === s.activeSessionId);
        const known = new Map((existing?.turns ?? []).map((t) => [t.id, t]));
        let changed = false;
        for (const turn of turns) {
          const prev = known.get(turn.id);
          if (!prev || prev.text !== turn.text) {
            known.set(turn.id, { ...turn, at: prev?.at ?? turn.at });
            changed = true;
          }
        }
        if (!changed) return s;
        const merged = Array.from(known.values()).sort((a, b) => a.at - b.at).slice(-MAX_TURNS);
        if (existing) {
          return {
            ...s,
            sessions: s.sessions.map((x) =>
              x.id === existing.id
                ? { ...x, turns: merged, updatedAt: Date.now(), title: x.title || titleFrom(merged) }
                : x,
            ),
          };
        }
        const session: ConversationSession = {
          id: id(),
          title: titleFrom(merged),
          createdAt: merged[0]!.at,
          updatedAt: Date.now(),
          turns: merged,
        };
        return {
          ...s,
          sessions: [session, ...s.sessions].slice(0, MAX_SESSIONS),
          activeSessionId: session.id,
        };
      });
    }, []),
    /** Start a fresh chat; the next message opens a new session. */
    newConversation: useCallback(() => setStore((s) => ({ ...s, activeSessionId: null })), []),
    openSession: useCallback(
      (sessionId: string) => setStore((s) => ({ ...s, activeSessionId: sessionId })),
      [],
    ),
    deleteSession: useCallback((sessionId: string) => {
      setStore((s) => {
        const sessions = s.sessions.filter((x) => x.id !== sessionId);
        return {
          ...s,
          sessions,
          activeSessionId: s.activeSessionId === sessionId ? null : s.activeSessionId,
        };
      });
    }, []),
    /** Wipe the open session's messages (it disappears once empty). */
    clearConversation: useCallback(() => {
      setStore((s) => ({
        ...s,
        sessions: s.sessions.filter((x) => x.id !== s.activeSessionId || x.turns.length === 0),
        activeSessionId: s.sessions.some((x) => x.id === s.activeSessionId) ? null : s.activeSessionId,
      }));
    }, []),
  };

  const activeSession =
    store.sessions.find((x) => x.id === store.activeSessionId) ?? null;

  return {
    ...store,
    loaded,
    user,
    signOut,
    activeSession,
    /** Turns of the conversation currently open in the chat. */
    conversation: activeSession?.turns ?? [],
    ...api,
  };
}

export type JarvisStore = ReturnType<typeof useJarvisStore>;
export type { Memory, Task, Reminder };
