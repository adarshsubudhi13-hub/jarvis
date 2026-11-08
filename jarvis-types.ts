export type Memory = { id: string; text: string; createdAt: number };
export type Task = { id: string; text: string; done: boolean; createdAt: number };
export type Reminder = { id: string; text: string; at: number; fired: boolean };
export type CalendarEvent = {
  id: string;
  title: string;
  at: number;
  location?: string | undefined;
  /** Minutes before the appointment to alert. null = no alert. */
  remindMinutes?: number | null | undefined;
  alerted?: boolean | undefined;
  createdAt: number;
};
export type Note = {
  id: string;
  title?: string | undefined;
  text: string;
  tags?: string[] | undefined;
  createdAt: number;
};

export type ChatTurn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: number;
};

/** One saved conversation: a titled list of turns, reopenable at any time. */
export type ConversationSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  turns: ChatTurn[];
};




export type JarvisAction =
  | { kind: "memory_saved"; text: string }
  | { kind: "memory_deleted"; text: string }
  | { kind: "task_added"; text: string }
  | { kind: "task_completed"; text: string }
  | { kind: "reminder_set"; text: string; at: number }
  | { kind: "timer_set"; text: string; at: number }
  | { kind: "site_opened"; url: string }
  | { kind: "event_scheduled"; title: string; at: number; location?: string }
  | { kind: "event_cancelled"; title: string }
  | { kind: "note_saved"; title?: string; text: string; tags?: string[] }
  | { kind: "note_deleted"; text: string };

export type JarvisState =
  | "IDLE"
  | "LISTENING"
  | "THINKING"
  | "SPEAKING"
  | "EXECUTING"
  | "ERROR";
