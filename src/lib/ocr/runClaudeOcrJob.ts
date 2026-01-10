// src/lib/ocr/runClaudeOcrJob.ts
import "server-only";
import Anthropic from "@anthropic-ai/sdk";

type ClaudeOcrArgs = {
  fileBytes: Buffer;
  mimeType: string;
  fileName?: string;
};

type ClaudeOcrResult = {
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

export async function runClaudeOcrJob(args: ClaudeOcrArgs): Promise<ClaudeOcrResult> {
  const { fileBytes, mimeType, fileName } = args;
  const started = Date.now();

  console.log("[ClaudeOCR] Starting OCR job", {
    fileName,
    mimeType,
    fileSize: fileBytes.length,
  });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY environment variable");
  }

  try {
    const client = new Anthropic({ apiKey });

    // Convert file to base64
    const base64Data = fileBytes.toString("base64");
    const mediaType = getMediaType(mimeType);

    console.log("[ClaudeOCR] Sending request to Claude API", {
      model: "claude-sonnet-4-5-20250514",
      mediaType,
      base64Length: base64Data.length,
    });

    const response = await client.messages.create({
      model: "claude-sonnet-4-5-20250514",
      max_tokens: 64000,
      messages: [
        {
          role: "user",
          content: [
            {
              type: mediaType === "application/pdf" ? "document" : "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: base64Data,
              },
            } as any, // Type assertion for mixed document/image types
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
    const textBlock = response.content.find((block) => block.type === "text");
    const extractedText = textBlock && "text" in textBlock ? textBlock.text : "";

    if (!extractedText) {
      throw new Error("No text content in Claude response");
    }

    const pageCount = countPagesFromText(extractedText);
    const elapsed = Date.now() - started;

    console.log("[ClaudeOCR] OCR job completed", {
      fileName,
      pageCount,
      textLength: extractedText.length,
      elapsed_ms: elapsed,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
    });

    return {
      text: extractedText,
      pageCount,
    };
  } catch (error: any) {
    const elapsed = Date.now() - started;

    console.error("[ClaudeOCR] OCR job failed", {
      fileName,
      elapsed_ms: elapsed,
      error: error?.message || String(error),
    });

    throw error;
  }
}
