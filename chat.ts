import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, stepCountIs, tool, type UIMessage } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";

function minutesFromNow(minutes: number) {
  return Date.now() + Math.round(minutes * 60_000);
}

const tools = {
  save_memory: tool({
    description: "Remember a durable fact the user shared about themselves or their preferences.",
    inputSchema: z.object({ text: z.string().describe("The fact to remember, phrased concisely") }),
    execute: async ({ text }) => ({ kind: "memory_saved" as const, text }),
  }),
  delete_memory: tool({
    description: "Forget a previously stored memory. Pass the memory text as stored.",
    inputSchema: z.object({ text: z.string() }),
    execute: async ({ text }) => ({ kind: "memory_deleted" as const, text }),
  }),
  add_task: tool({
    description: "Add an item to the user's to-do list.",
    inputSchema: z.object({ text: z.string() }),
    execute: async ({ text }) => ({ kind: "task_added" as const, text }),
  }),
  complete_task: tool({
    description: "Mark a to-do item as done. Pass the task text as listed.",
    inputSchema: z.object({ text: z.string() }),
    execute: async ({ text }) => ({ kind: "task_completed" as const, text }),
  }),
  set_reminder: tool({
    description: "Set a reminder a number of minutes from now.",
    inputSchema: z.object({ text: z.string(), inMinutes: z.number() }),
    execute: async ({ text, inMinutes }) => ({
      kind: "reminder_set" as const,
      text,
      at: minutesFromNow(inMinutes),
    }),
  }),
  set_timer: tool({
    description: "Start a countdown timer.",
    inputSchema: z.object({ label: z.string(), minutes: z.number() }),
    execute: async ({ label, minutes }) => ({
      kind: "timer_set" as const,
      text: label,
      at: minutesFromNow(minutes),
    }),
  }),
  update_setting: tool({
    description:
      "Change one of the assistant's own settings. High impact: the user may be asked to confirm.",
    inputSchema: z.object({
      setting: z.enum([
        "spoken_replies",
        "speech_rate",
        "wake_word",
        "require_wake_word",
        "hands_free",
      ]),
      value: z.string().describe("New value: true/false, a number for speech_rate, or the word"),
    }),
    execute: async ({ setting, value }) => ({ kind: "setting_updated" as const, setting, value }),
  }),
  schedule_event: tool({
    description:
      "Schedule an appointment or calendar event. Resolve relative dates using the current date/time given in context.",
    inputSchema: z.object({
      title: z.string(),
      when: z.string().describe("Absolute local date and time, ISO 8601, e.g. 2026-08-20T15:30"),
      location: z.string().optional(),
      remindMinutesBefore: z
        .number()
        .nullable()
        .optional()
        .describe(
          "Minutes before the appointment to alert. Omit to use the user's default, null for no alert.",
        ),
    }),
    execute: async ({ title, when, location, remindMinutesBefore }) => {
      const at = new Date(when).getTime();
      if (!Number.isFinite(at)) return { error: "Could not understand that date and time" };
      return {
        kind: "event_scheduled" as const,
        title,
        at,
        location,
        remindMinutes: remindMinutesBefore,
      };
    },
  }),
  set_event_reminder: tool({
    description:
      "Change how long before an existing appointment the user is alerted, or turn its alert off.",
    inputSchema: z.object({
      title: z.string().describe("The appointment title as listed"),
      minutesBefore: z.number().nullable().describe("Minutes before the event, or null for none"),
    }),
    execute: async ({ title, minutesBefore }) => ({
      kind: "event_reminder_set" as const,
      title,
      minutesBefore,
    }),
  }),
  cancel_event: tool({
    description: "Cancel a scheduled calendar event. Pass the event title as listed.",
    inputSchema: z.object({ title: z.string() }),
    execute: async ({ title }) => ({ kind: "event_cancelled" as const, title }),
  }),
  save_note: tool({
    description:
      "Save a free-form text note for the user. Add 1-3 short lowercase topic tags (e.g. work, ideas, shopping) so notes can be filtered later.",
    inputSchema: z.object({
      text: z.string(),
      title: z.string().optional(),
      tags: z.array(z.string()).optional(),
    }),
    execute: async ({ text, title, tags }) => ({ kind: "note_saved" as const, text, title, tags }),
  }),
  delete_note: tool({
    description: "Delete a saved note. Pass its title or a distinctive part of its text.",
    inputSchema: z.object({ text: z.string() }),
    execute: async ({ text }) => ({ kind: "note_deleted" as const, text }),
  }),
  export_conversation: tool({
    description:
      "Write the conversation history to a downloadable file for the user. Use when the user asks to save, export or download the chat. Format: txt (default, readable plain text) or pdf. For pdf you may pass page_size (a4 default, letter, legal) and orientation (portrait default, landscape).",
    inputSchema: z.object({
      format: z.enum(["txt", "pdf"]).default("txt"),
      page_size: z.enum(["a4", "letter", "legal"]).default("a4"),
      orientation: z.enum(["portrait", "landscape"]).default("portrait"),
    }),
    execute: async ({ format, page_size, orientation }) => ({
      kind: "conversation_exported" as const,
      format,
      page_size,
      orientation,
    }),
  }),
  write_file: tool({
    description:
      "Create a downloadable file with content you write (lists, drafts, summaries, data). Use when the user says 'write this in a file', 'make it downloadable', 'save as a file'. Format: txt (default), md for formatted documents, json for structured data.",
    inputSchema: z.object({
      filename: z.string().describe("Short file name without extension, e.g. shopping-list"),
      format: z.enum(["txt", "md", "json"]).default("txt"),
      content: z.string().describe("Full file content. For json, valid JSON text."),
    }),
    execute: async ({ filename, format, content }) => {
      let body = content;
      if (format === "json") {
        try {
          body = JSON.stringify(JSON.parse(content), null, 2);
        } catch {
          body = JSON.stringify({ content }, null, 2);
        }
      }
      const base =
        filename.replace(/\.(txt|md|json)$/i, "").replace(/[^a-z0-9-_ ]/gi, "").trim().replace(/\s+/g, "-") ||
        "jarvis-file";
      return { kind: "file_written" as const, filename: `${base}.${format}`, format, content: body };
    },
  }),
  open_website: tool({
    description: "Open a website in a new browser tab, or run a web search by opening a search URL.",
    inputSchema: z.object({ url: z.string().describe("Full https URL") }),
    execute: async ({ url }) => ({ kind: "site_opened" as const, url }),
  }),

  calculate: tool({
    description: "Evaluate a numeric expression using +, -, *, /, parentheses and decimals.",
    inputSchema: z.object({ expression: z.string() }),
    execute: async ({ expression }) => {
      if (!/^[0-9+\-*/().%\s]+$/.test(expression)) {
        return { error: "Unsupported expression" };
      }
      try {
        // eslint-disable-next-line no-new-func
        const value = Function(`"use strict";return (${expression})`)() as number;
        return Number.isFinite(value) ? { expression, value } : { error: "Not a finite number" };
      } catch {
        return { error: "Could not evaluate" };
      }
    },
  }),
};

const SYSTEM = (context: string) => `You are JARVIS, a confident, concise futuristic AI assistant running in the user's browser.

Personality: calm, capable, lightly witty. Short natural replies unless detail is requested. Confirm actions naturally ("Done — added to your task list.") instead of robotic status text. Never impersonate copyrighted film dialogue.

Rules:
- Use tools for memories, tasks, reminders, timers, calendar appointments, notes, math and opening sites. Never claim you did something you did not do via a tool.
- When the user asks to write something in a file, make it downloadable, or save it as a file, use write_file. Pick txt unless they ask for markdown (md) or JSON; if they want a file but the format is unclear and it matters, you may briefly offer txt, md or json. Afterwards say something like "Done — saved to your downloads." Use export_conversation only for the chat transcript itself.
- For appointments use schedule_event with an absolute local ISO date-time resolved from the current date/time above. If the user says how early to be alerted ("remind me an hour before"), pass remindMinutesBefore; otherwise omit it and their default lead time applies. Use set_event_reminder to change an existing appointment's alert. Use save_note for anything the user dictates to keep as text.
- You run in a browser sandbox: you cannot control the operating system, launch desktop apps, read local files or read live system stats. Say so plainly if asked, and offer the closest browser-based alternative.
- Distinguish what you know, what came from a website you opened, and what is stored in the user's memory bank.
- Ask for confirmation before deleting a memory, changing settings or anything destructive. The interface may also ask the user to confirm high-impact actions before they take effect; if so, say the action is awaiting confirmation.
- Use update_setting to change spoken replies, speech rate, wake word, wake-word requirement or hands-free listening.
- Your replies are spoken aloud, so avoid tables, code blocks and long lists unless asked.

${context}`;

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env["LOVABLE_API_KEY"];
        if (!apiKey) {
          return new Response(JSON.stringify({ error: "AI is not configured." }), { status: 500 });
        }

        const body = (await request.json()) as {
          messages: UIMessage[];
          context?: {
            memories?: string[];
            tasks?: string[];
            events?: string[];
            notes?: string[];
            userName?: string;
          };
        };

        const memories = body.context?.memories ?? [];
        const tasks = body.context?.tasks ?? [];
        const events = body.context?.events ?? [];
        const notes = body.context?.notes ?? [];
        const context = [
          `Current date and time: ${new Date().toString()}.`,
          body.context?.userName ? `The user's name is ${body.context.userName}.` : "",
          memories.length ? `Stored memories:\n- ${memories.join("\n- ")}` : "Stored memories: none.",
          tasks.length ? `Open tasks:\n- ${tasks.join("\n- ")}` : "Open tasks: none.",
          events.length ? `Calendar:\n- ${events.join("\n- ")}` : "Calendar: no appointments.",
          notes.length ? `Notes:\n- ${notes.join("\n- ")}` : "Notes: none.",
        ]
          .filter(Boolean)
          .join("\n");

        const gateway = createLovableAiGatewayProvider(apiKey);

        try {
          const result = streamText({
            model: gateway("google/gemini-3.6-flash"),
            system: SYSTEM(context),
            messages: await convertToModelMessages(body.messages),
            tools,
            stopWhen: stepCountIs(50),
          });

          return result.toUIMessageStreamResponse();
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown error";
          const status = message.includes("429") ? 429 : message.includes("402") ? 402 : 500;
          return new Response(JSON.stringify({ error: message }), { status });
        }
      },
    },
  },
});
