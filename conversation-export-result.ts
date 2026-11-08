import type { PdfOptions, PdfOrientation, PdfPageSize } from "./export-conversation";

export type ConversationExportResult = {
  format: "txt" | "pdf";
  pageSize?: PdfPageSize;
  orientation?: PdfOrientation;
};

type ConversationExportToolOutput = {
  format?: unknown;
  page_size?: unknown;
  orientation?: unknown;
};

/** Normalize AI tool output for the browser export flow. */
export function mapConversationExportOutput(
  output: ConversationExportToolOutput,
): ConversationExportResult {
  const pageSize = output.page_size;
  const orientation = output.orientation;

  return {
    format: output.format === "pdf" ? "pdf" : "txt",
    ...(pageSize === "a4" || pageSize === "letter" || pageSize === "legal"
      ? { pageSize }
      : {}),
    ...(orientation === "portrait" || orientation === "landscape" ? { orientation } : {}),
  };
}

/** Build the PDF options consumed by both the UI and automated export tests. */
export function conversationExportPdfOptions(result: ConversationExportResult): PdfOptions {
  return {
    ...(result.pageSize ? { pageSize: result.pageSize } : {}),
    ...(result.orientation ? { orientation: result.orientation } : {}),
  };
}