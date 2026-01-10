// src/lib/ocr/runMistralOcrJob.ts
import "server-only";
import { Mistral } from "@mistralai/mistralai";

type MistralOcrArgs = {
  fileBytes: Buffer;
  mimeType: string;
  fileName?: string;
};

type MistralOcrResult = {
  text: string;
  pageCount: number;
};

function getMediaType(
  mimeType: string
): "application/pdf" | "image/png" | "image/jpeg" | "image/gif" | "image/webp" {
  const normalized = mimeType.toLowerCase().trim();

  if (normalized === "application/pdf") return "application/pdf";
  if (normalized === "image/png") return "image/png";
  if (normalized === "image/jpeg" || normalized === "image/jpg") return "image/jpeg";
  if (normalized === "image/gif") return "image/gif";
  if (normalized === "image/webp") return "image/webp";

  // Default to PDF for unknown document types
  return "application/pdf";
}

function countPagesFromText(text: string): number {
  // Count page markers like [Page 1], [Page 2], etc.
  const matches = text.match(/\[Page\s+(\d+)\]/gi) || [];
  let maxPage = 1;

  for (const match of matches) {
    const num = parseInt(match.replace(/\D/g, ""), 10);
    if (!isNaN(num) && num > maxPage) {
      maxPage = num;
    }
  }

  return maxPage;
}

export async function runMistralOcrJob(args: MistralOcrArgs): Promise<MistralOcrResult> {
  const { fileBytes, mimeType, fileName } = args;
  const started = Date.now();

  console.log("[MistralOCR] Starting OCR job", {
    fileName,
    mimeType,
    fileSize: fileBytes.length,
  });

  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    throw new Error("Missing MISTRAL_API_KEY environment variable");
  }

  try {
    const client = new Mistral({ apiKey });

    // Convert file to base64
    const base64Data = fileBytes.toString("base64");
    const mediaType = getMediaType(mimeType);

    console.log("[MistralOCR] Sending request to Mistral API", {
      model: "pixtral-12b-2409",
      mediaType,
      base64Length: base64Data.length,
    });

    // Mistral's vision model for document OCR
    const chatResponse = await client.chat.complete({
      model: "pixtral-12b-2409", // Pixtral is Mistral's multimodal model
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              imageUrl: `data:${mediaType};base64,${base64Data}`,
            },
            {
              type: "text",
              text: `Extract ALL text from this document exactly as it appears.

Instructions:
- Extract every word, number, and character from each page
- Mark each page with [Page N] at the start (e.g., [Page 1], [Page 2])
- Preserve the original layout and structure as much as possible
- Include all headers, footers, tables, and form fields
- Do not summarize or skip any content
- Extract text in reading order (top to bottom, left to right)

Output format:
[Page 1]
<all text from page 1>

[Page 2]
<all text from page 2>`,
            },
          ],
        },
      ],
    });

    // Extract text from response
    const extractedText = chatResponse.choices?.[0]?.message?.content || "";

    if (!extractedText) {
      throw new Error("No text content in Mistral response");
    }

    const pageCount = countPagesFromText(extractedText);
    const elapsed = Date.now() - started;

    console.log("[MistralOCR] OCR job completed", {
      fileName,
      pageCount,
      textLength: extractedText.length,
      elapsed_ms: elapsed,
      inputTokens: chatResponse.usage?.promptTokens,
      outputTokens: chatResponse.usage?.completionTokens,
    });

    return {
      text: extractedText,
      pageCount,
    };
  } catch (error: any) {
    const elapsed = Date.now() - started;

    console.error("[MistralOCR] OCR job failed", {
      fileName,
      elapsed_ms: elapsed,
      error: error?.message || String(error),
    });

    throw error;
  }
}
