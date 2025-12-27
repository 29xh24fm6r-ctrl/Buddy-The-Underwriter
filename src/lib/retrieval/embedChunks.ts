import pLimit from "p-limit";
import { supabaseServer } from "./supabaseServer";
import { embedText } from "./embeddings";

export interface EmbedChunksResult {
  updated: number;
  errors: string[];
}

/**
 * Embed all chunks for a deal that are missing embeddings
 * @param dealId - Deal ID to embed chunks for
 * @param opts - Options (limit: max chunks to embed)
 * @returns Result with count of updated chunks and any errors
 */
export async function embedMissingChunksForDeal(
  dealId: string,
  opts?: { limit?: number }
): Promise<EmbedChunksResult> {
  const sb = supabaseServer();
  const limit = opts?.limit ?? 200;

  // Fetch chunks without embeddings
  const { data: chunks, error } = await sb
    .from("evidence_chunks")
    .select("id, content, deal_id")
    .eq("deal_id", dealId)
    .is("embedding", null)
    .limit(limit);

  if (error) throw error;
  if (!chunks?.length) return { updated: 0, errors: [] };

  const limiter = pLimit(4); // 4 concurrent embedding requests
  let updated = 0;
  const errors: string[] = [];

  await Promise.all(
    chunks.map((c) =>
      limiter(async () => {
        try {
          const v = await embedText(c.content);
          const { error: upErr } = await sb
            .from("evidence_chunks")
            .update({ embedding: v })
            .eq("id", c.id);
          if (upErr) throw upErr;
          updated += 1;
        } catch (e: any) {
          errors.push(`Chunk ${c.id}: ${e.message}`);
        }
      })
    )
  );

  return { updated, errors };
}
