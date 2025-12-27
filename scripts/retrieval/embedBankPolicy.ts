import pLimit from "p-limit";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";

async function main() {
  const bankId = process.argv[2];
  if (!bankId) {
    console.error("Usage: npx tsx scripts/retrieval/embedBankPolicy.ts <bank_uuid>");
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const apiKey = process.env.OPENAI_API_KEY!;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL missing");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing");
  if (!apiKey) throw new Error("OPENAI_API_KEY missing");

  const sb = createClient(url, key, { auth: { persistSession: false } });
  const openai = new OpenAI({ apiKey });

  const { data: rows, error } = await sb
    .from("bank_policy_chunks")
    .select("id, content")
    .eq("bank_id", bankId)
    .is("embedding", null)
    .limit(5000);

  if (error) throw error;
  if (!rows?.length) {
    console.log("✅ No missing policy embeddings");
    return;
  }

  const limiter = pLimit(4);
  let done = 0;

  await Promise.all(
    rows.map((r) =>
      limiter(async () => {
        const emb = await openai.embeddings.create({ model: EMBEDDING_MODEL, input: r.content });
        const v = emb.data?.[0]?.embedding;
        if (!v?.length) throw new Error("Empty embedding");
        const { error: upErr } = await sb.from("bank_policy_chunks").update({ embedding: v }).eq("id", r.id);
        if (upErr) throw upErr;
        done += 1;
        if (done % 25 === 0) console.log(`…embedded ${done}/${rows.length}`);
      })
    )
  );

  console.log(`✅ Embedded ${done} policy chunks for bank ${bankId}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
