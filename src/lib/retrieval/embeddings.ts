import { getOpenAI } from "@/lib/ai/openaiClient";

const EMBEDDING_MODEL =
  process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small"; // 1536 dims

/**
 * Generate embedding vector for text using OpenAI embeddings API
 * @param input - Text to embed (max ~8K tokens for text-embedding-3-small)
 * @returns Array of 1536 floats
 */
export async function embedText(input: string): Promise<number[]> {
  const client = getOpenAI();

  const resp = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input,
  });

  const v = resp.data?.[0]?.embedding;
  if (!v?.length) throw new Error("Empty embedding response");
  return v as number[];
}
