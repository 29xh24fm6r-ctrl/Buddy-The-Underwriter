// src/lib/ocr/runMistralOcrJob.ts
import "server-only";

export type MistralOcrArgs = {
  fileBytes: Buffer;
  mimeType: string;
  fileName?: string;
};

export type MistralOcrResult = {
  text: string;
  pageCount: number;
};

export async function runMistralOcrJob(_args: MistralOcrArgs): Promise<MistralOcrResult> {
  throw new Error("Mistral OCR is disabled. Use Gemini OCR instead.");
}
