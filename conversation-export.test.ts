import { describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { extractText } from "unpdf";
import { conversationExportPdfOptions, mapConversationExportOutput } from "../src/lib/conversation-export-result";
import { createConversationPdf, exportConversationPdf, type PdfOptions } from "../src/lib/export-conversation";
import type { ChatTurn } from "../src/lib/jarvis-types";

describe("AI conversation export mapping", () => {
  it("maps format, page_size, and orientation into browser export options", () => {
    expect(
      mapConversationExportOutput({
        format: "pdf",
        page_size: "legal",
        orientation: "landscape",
      }),
    ).toEqual({ format: "pdf", pageSize: "legal", orientation: "landscape" });
  });

  it("defaults invalid or missing AI options to a plain-text export", () => {
    expect(mapConversationExportOutput({})).toEqual({ format: "txt" });
    expect(
      mapConversationExportOutput({ format: "doc", page_size: "tabloid", orientation: "sideways" }),
    ).toEqual({ format: "txt" });
  });
});

describe("AI-selected PDF export", () => {
  it("uses legal landscape dimensions and includes every transcript message", async () => {
    const turns: ChatTurn[] = [
      {
        id: "turn-1",
        role: "user",
        text: "Please prepare the quarterly launch notes.",
        at: Date.parse("2026-11-06T04:18:00.000Z"),
      },
      {
        id: "turn-2",
        role: "assistant",
        text: "The launch plan includes three milestones and a customer review.",
        at: Date.parse("2026-11-06T04:18:10.000Z"),
      },
      {
        id: "turn-3",
        role: "user",
        text: "Keep the final transcript marker: transcript-complete-7319.",
        at: Date.parse("2026-11-06T04:18:20.000Z"),
      },
    ];
    const exportResult = mapConversationExportOutput({
      format: "pdf",
      page_size: "legal",
      orientation: "landscape",
    });
    const bytes = await createConversationPdf(
      turns,
      "AI-selected PDF export",
      conversationExportPdfOptions(exportResult),
    );

    expect(bytes).not.toBeNull();
    if (!bytes) throw new Error("Expected the PDF export to contain bytes");

    const pdf = await PDFDocument.load(bytes);
    const pages = pdf.getPages();
    expect(pages.length).toBeGreaterThan(0);
    for (const page of pages) {
      const { width, height } = page.getSize();
      expect(width).toBeCloseTo(1008, 2);
      expect(height).toBeCloseTo(612, 2);
    }

    const extracted = await extractText(bytes, { mergePages: true });
    const transcript = Array.isArray(extracted.text) ? extracted.text.join("\n") : extracted.text;
    for (const turn of turns) {
      expect(transcript).toContain(turn.text);
    }
  });

  it("falls back to A4 portrait for invalid runtime page options", async () => {
    const turns: ChatTurn[] = [
      {
        id: "invalid-options-turn",
        role: "user",
        text: "Check the safe PDF defaults.",
        at: Date.parse("2026-11-06T04:18:00.000Z"),
      },
    ];
    const invalidOptions = {
      pageSize: "tabloid",
      orientation: "sideways",
    } as unknown as PdfOptions;

    const bytes = await createConversationPdf(turns, "Invalid options", invalidOptions);
    expect(bytes).not.toBeNull();
    if (!bytes) throw new Error("Expected the PDF export to contain bytes");

    const [page] = (await PDFDocument.load(bytes)).getPages();
    expect(page).toBeDefined();
    if (!page) throw new Error("Expected the PDF to contain a page");
    const { width, height } = page.getSize();
    expect(width).toBeCloseTo(595.28, 2);
    expect(height).toBeCloseTo(841.89, 2);
  });

  it("creates a valid one-page PDF for an empty conversation", async () => {
    const bytes = await createConversationPdf([], "Empty conversation");
    expect(bytes).not.toBeNull();
    if (!bytes) throw new Error("Expected an empty conversation to produce a PDF");

    const pdf = await PDFDocument.load(bytes);
    const pages = pdf.getPages();
    expect(pages).toHaveLength(1);
    const page = pages[0];
    expect(page).toBeDefined();
    if (!page) throw new Error("Expected the empty PDF to contain a page");
    const { width, height } = page.getSize();
    expect(width).toBeCloseTo(595.28, 2);
    expect(height).toBeCloseTo(841.89, 2);

    const extracted = await extractText(bytes, { mergePages: true });
    const text = Array.isArray(extracted.text) ? extracted.text.join("\n") : extracted.text;
    expect(text).toContain("Empty conversation");
    expect(text).toContain("0 messages");
  });

  it("surfaces a PDF generation failure to the caller", async () => {
    const turns: ChatTurn[] = [
      {
        id: "failure-turn",
        role: "user",
        text: "This export should fail.",
        at: Date.parse("2026-11-06T04:18:00.000Z"),
      },
    ];
    const failure = new Error("PDF engine failed");
    const createSpy = vi.spyOn(PDFDocument, "create").mockRejectedValueOnce(failure);

    try {
      await expect(exportConversationPdf(turns, "Failed export")).rejects.toThrow(
        "PDF engine failed",
      );
    } finally {
      createSpy.mockRestore();
    }
  });

  it("keeps every message in a long, multi-page transcript", async () => {
    const turns: ChatTurn[] = Array.from({ length: 140 }, (_, index) => ({
      id: `long-turn-${index + 1}`,
      role: index % 2 === 0 ? "user" : "assistant",
      text: `Transcript message ${index + 1}: long-conversation-marker-${String(index + 1).padStart(3, "0")}.`,
      at: Date.parse("2026-11-06T04:18:00.000Z") + index * 1_000,
    }));

    const bytes = await createConversationPdf(turns, "Long conversation");
    expect(bytes).not.toBeNull();
    if (!bytes) throw new Error("Expected the PDF export to contain bytes");

    const pages = (await PDFDocument.load(bytes)).getPages();
    expect(pages.length).toBeGreaterThan(1);

    const extracted = await extractText(bytes, { mergePages: true });
    const transcript = Array.isArray(extracted.text) ? extracted.text.join("\n") : extracted.text;
    for (const turn of turns) {
      expect(transcript).toContain(turn.text);
    }
  });

  it("keeps a single message readable when its body crosses PDF page breaks", async () => {
    const markers = Array.from({ length: 240 }, (_, index) =>
      `page-break-marker-${String(index + 1).padStart(3, "0")}`,
    );
    const turn: ChatTurn = {
      id: "page-break-turn",
      role: "assistant",
      text: markers.map((marker) => `${marker}: details continue in order.`).join(" "),
      at: Date.parse("2026-11-06T04:18:00.000Z"),
    };

    const bytes = await createConversationPdf([turn], "Message across page breaks");
    expect(bytes).not.toBeNull();
    if (!bytes) throw new Error("Expected the PDF export to contain bytes");

    const pages = (await PDFDocument.load(bytes)).getPages();
    expect(pages.length).toBeGreaterThan(1);

    const extracted = await extractText(bytes, { mergePages: true });
    const transcript = Array.isArray(extracted.text) ? extracted.text.join("\n") : extracted.text;
    let previousPosition = -1;
    for (const marker of markers) {
      const position = transcript.indexOf(marker);
      expect(position).toBeGreaterThan(previousPosition);
      previousPosition = position;
    }
  });

  it("keeps multiple long messages distinct and ordered across page breaks", async () => {
    const turns: ChatTurn[] = ["user", "assistant", "user"].map((role, messageIndex) => {
      const messageNumber = messageIndex + 1;
      const markers = Array.from({ length: 90 }, (_, index) =>
        `message-${messageNumber}-segment-${String(index + 1).padStart(3, "0")}`,
      );
      return {
        id: `multi-page-turn-${messageNumber}`,
        role,
        text: markers.map((marker) => `${marker}: distinct details continue in this section.`).join(" "),
        at: Date.parse("2026-11-06T04:18:00.000Z") + messageIndex * 1_000,
      };
    });

    const bytes = await createConversationPdf(turns, "Multiple long messages");
    expect(bytes).not.toBeNull();
    if (!bytes) throw new Error("Expected the PDF export to contain bytes");

    const pages = (await PDFDocument.load(bytes)).getPages();
    expect(pages.length).toBeGreaterThan(3);

    const extracted = await extractText(bytes, { mergePages: true });
    const transcript = Array.isArray(extracted.text) ? extracted.text.join("\n") : extracted.text;
    let previousPosition = -1;
    for (const turn of turns) {
      const markers = [...turn.text.matchAll(/message-\d+-segment-\d{3}/g)].map(([marker]) => marker);
      expect(markers.length).toBe(90);
      for (const marker of markers) {
        const position = transcript.indexOf(marker);
        expect(position).toBeGreaterThan(previousPosition);
        previousPosition = position;
      }
    }
  });

  it("preserves conversational text around supported special characters", async () => {
    const turn: ChatTurn = {
      id: "special-character-turn",
      role: "user",
      text: "“Café”—it’s €5… • ready → yes; £2 is fine.",
      at: Date.parse("2026-11-06T04:18:00.000Z"),
    };

    const bytes = await createConversationPdf([turn], "Special characters");
    expect(bytes).not.toBeNull();
    if (!bytes) throw new Error("Expected the PDF export to contain bytes");

    const extracted = await extractText(bytes, { mergePages: true });
    const transcript = Array.isArray(extracted.text) ? extracted.text.join("\n") : extracted.text;
    expect(transcript).toContain('"Café"-it\'s EUR5... - ready -> yes; GBP2 is fine.');
  });

  it("keeps accented characters and readable emoji markers in exported PDFs", async () => {
    const turn: ChatTurn = {
      id: "accented-emoji-turn",
      role: "user",
      text: "Café déjà vu — launch 🚀, then smile 😀.",
      at: Date.parse("2026-11-06T04:18:00.000Z"),
    };

    const bytes = await createConversationPdf([turn], "Accented text and emoji");
    expect(bytes).not.toBeNull();
    if (!bytes) throw new Error("Expected the PDF to contain the conversation text");

    const extracted = await extractText(bytes, { mergePages: true });
    const transcript = Array.isArray(extracted.text) ? extracted.text.join("\n") : extracted.text;
    expect(transcript).toContain("Café déjà vu - launch [emoji], then smile [emoji].");
  });
});