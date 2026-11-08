import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { ChatTurn } from "./jarvis-types";

export type ExportFormat = "txt" | "pdf";
export type PdfPageSize = "a4" | "letter" | "legal";
export type PdfOrientation = "portrait" | "landscape";

export type PdfOptions = { pageSize?: PdfPageSize; orientation?: PdfOrientation };

const PAGE_SIZES: Record<PdfPageSize, { w: number; h: number }> = {
  a4: { w: 595.28, h: 841.89 },
  letter: { w: 612, h: 792 },
  legal: { w: 612, h: 1008 },
};

/** Full page dimensions in PDF points, honouring orientation. */
function pageDims(size: PdfPageSize, orientation: PdfOrientation) {
  const base = PAGE_SIZES[size] ?? PAGE_SIZES.a4;
  return orientation === "landscape" ? { w: base.h, h: base.w } : base;
}

/** Readable plain-text transcript with a header and one block per message. */
export function conversationText(turns: ChatTurn[], title?: string) {
  const header =
    `JARVIS conversation${title ? ` — ${title}` : ""}\n` +
    `Exported ${new Date().toLocaleString()} · ${turns.length} messages\n` +
    `${"=".repeat(64)}\n\n`;
  return (
    header +
    turns
      .map((t) => {
        const stamp = new Date(t.at).toLocaleString();
        const who = t.role === "user" ? "You" : "JARVIS";
        const body = t.text.trim() || "(no text)";
        return `[${stamp}] ${who}:\n${body}`;
      })
      .join("\n\n") +
    "\n"
  );
}

/** File-system-safe base name derived from the conversation title. */
function baseName(turns: ChatTurn[], title?: string) {
  const slug = (title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const stamp = new Date().toISOString().slice(0, 10);
  return `jarvis-${slug || "conversation"}-${stamp}`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Export a conversation as a readable .txt download. */
export function exportConversationTxt(turns: ChatTurn[], title?: string) {
  if (!turns.length) return;
  downloadBlob(
    new Blob([conversationText(turns, title)], { type: "text/plain;charset=utf-8" }),
    `${baseName(turns, title)}.txt`,
  );
}

/*
 * PDF export. pdf-lib's standard fonts use WinAnsi encoding, which throws on
 * characters outside it (emoji, CJK, …), so text is transliterated/filtered
 * before drawing.
 */
const WINANSI_MAP: Array<[RegExp, string]> = [
  [/[\u201C\u201D]/g, '"'],
  [/[\u2018\u2019\u201B]/g, "'"],
  [/[\u2013\u2014\u2015]/g, "-"],
  [/\u2026/g, "..."],
  [/[\u00A0\u2007\u202F]/g, " "],
  [/\u2022/g, "-"],
  [/\u20B9/g, "Rs."],
  [/\u20AC/g, "EUR"],
  [/\u00A3/g, "GBP"],
  [/[\u2192]/g, "->"],
];

function winAnsi(input: string) {
  let text = input;
  for (const [re, sub] of WINANSI_MAP) text = text.replace(re, sub);
  // Label emoji so they remain visible in PDFs using WinAnsi-only fonts.
  text = text.replace(
    /\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\p{Emoji_Modifier})?)*/gu,
    "[emoji]",
  );
  // Drop anything else the encoding cannot represent (CJK, symbols).
  return text.replace(/[^\t\n\r\x20-\x7E\u00A1-\u00FF]/g, "");
}

const MARGIN = 52;
const BODY = 10.5;
const LINE = 14.5;
const LABEL = 9;

/** Greedy word wrap using the real font metrics. */
function wrapLine(text: string, font: { widthOfTextAtSize(t: string, s: number): number }, size: number, max: number) {
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= max) {
        line = next;
        continue;
      }
      if (line) out.push(line);
      // A single word longer than the line gets hard-broken.
      let chunk = word;
      while (font.widthOfTextAtSize(chunk, size) > max) {
        let cut = chunk.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(chunk.slice(0, cut), size) > max) cut--;
        out.push(chunk.slice(0, cut));
        chunk = chunk.slice(cut);
      }
      line = chunk;
    }
    if (line) out.push(line);
  }
  return out;
}

/** Export a conversation as a cleanly laid-out PDF download. */
export async function createConversationPdf(
  turns: ChatTurn[],
  title?: string,
  options?: PdfOptions,
): Promise<Uint8Array | null> {
  const pageSize = options?.pageSize ?? "a4";
  const orientation = options?.orientation ?? "portrait";
  const dims = pageDims(pageSize, orientation);

  const doc = await PDFDocument.create();
  doc.setTitle(title ? `JARVIS — ${title}` : "JARVIS conversation");
  doc.setProducer("JARVIS AI Assistant");

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.1, 0.12, 0.16);
  const muted = rgb(0.45, 0.47, 0.52);
  const accent = rgb(0.05, 0.35, 0.45);

  const pageMax = dims.w - MARGIN * 2;
  let page = doc.addPage([dims.w, dims.h]);
  let y = dims.h - MARGIN;

  // Continuation pages get a small repeated header under the top margin.
  const startPage = (continuation: boolean) => {
    page = doc.addPage([dims.w, dims.h]);
    if (continuation) {
      const head = winAnsi(
        title ? `JARVIS — ${title} (continued)` : "JARVIS conversation (continued)",
      );
      page.drawText(head, { x: MARGIN, y: dims.h - MARGIN, size: LABEL, font: bold, color: accent });
      y = dims.h - MARGIN - 22;
    } else {
      y = dims.h - MARGIN;
    }
  };

  const ensureRoom = (needed: number) => {
    if (y - needed >= MARGIN) return;
    startPage(true);
  };

  // Header
  const heading = winAnsi(title ? `JARVIS — ${title}` : "JARVIS conversation");
  for (const line of wrapLine(heading, bold, 15, pageMax)) {
    ensureRoom(20);
    page.drawText(line, { x: MARGIN, y, size: 15, font: bold, color: accent });
    y -= 20;
  }
  const meta = winAnsi(
    `Exported ${new Date().toLocaleString()} · ${turns.length} messages`,
  );
  page.drawText(meta, { x: MARGIN, y: y - 4, size: LABEL, font: regular, color: muted });
  y -= 26;

  for (const turn of turns) {
    const who = turn.role === "user" ? "You" : "JARVIS";
    const when = winAnsi(new Date(turn.at).toLocaleString());

    // Speaker label + timestamp
    ensureRoom(LINE);
    const label = winAnsi(who);
    const labelWidth = bold.widthOfTextAtSize(label, LABEL);
    page.drawText(label, { x: MARGIN, y, size: LABEL, font: bold, color: accent });
    page.drawText(when, {
      x: MARGIN + labelWidth + 8,
      y,
      size: LABEL,
      font: regular,
      color: muted,
    });
    y -= LINE;

    const body = winAnsi((turn.text.trim() || "(no text)").replace(/\r\n?/g, "\n"));
    const font = turn.role === "user" ? bold : regular;
    for (const line of wrapLine(body, font, BODY, pageMax)) {
      ensureRoom(LINE);
      if (line) page.drawText(line, { x: MARGIN + 10, y, size: BODY, font, color: ink });
      y -= LINE;
    }
    y -= 6; // gap between messages
  }

  // Page numbers: stamp every page once the total count is known.
  const pages = doc.getPages();
  pages.forEach((pg, i) => {
    const label = winAnsi(`Page ${i + 1} of ${pages.length}`);
    const w = regular.widthOfTextAtSize(label, LABEL);
    pg.drawText(label, {
      x: (dims.w - w) / 2,
      y: 28,
      size: LABEL,
      font: regular,
      color: muted,
    });
  });

  return doc.save();
}

/** Export a conversation as a cleanly laid-out PDF download. */
export async function exportConversationPdf(
  turns: ChatTurn[],
  title?: string,
  options?: PdfOptions,
) {
  const bytes = await createConversationPdf(turns, title, options);
  if (!bytes) return;
  downloadBlob(
    new Blob([bytes as unknown as BlobPart], { type: "application/pdf" }),
    `${baseName(turns, title)}.pdf`,
  );
}

/** Export in the chosen format. */
export async function exportConversation(
  turns: ChatTurn[],
  format: ExportFormat,
  title?: string,
  pdfOptions?: PdfOptions,
) {
  if (format === "pdf") await exportConversationPdf(turns, title, pdfOptions);
  else exportConversationTxt(turns, title);
}
