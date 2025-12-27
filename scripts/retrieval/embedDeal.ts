import { createClient } from '@supabase/supabase-js';
import pLimit from 'p-limit';
import { getOpenAI } from '@/lib/ai/openaiClient';

const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';

async function embedText(input: string): Promise<number[]> {
  const client = getOpenAI();
  const resp = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input,
  });
  const v = resp.data?.[0]?.embedding;
  if (!v?.length) throw new Error('Empty embedding response');
  return v as number[];
}

function supabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL missing');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');
  return createClient(url, key, { auth: { persistSession: false } });
}

async function main() {
  const dealId = process.argv[2];
  if (!dealId) {
    console.error('Usage: npx tsx scripts/retrieval/embedDeal.ts <dealId>');
    process.exit(1);
  }

  console.log(`🔮 Embedding chunks for deal ${dealId}...`);

  const sb = supabaseServer();
  
  // Fetch chunks without embeddings from deal_doc_chunks
  const { data: chunks, error } = await sb
    .from('deal_doc_chunks')
    .select('id, content, deal_id')
    .eq('deal_id', dealId)
    .is('embedding', null)
    .limit(500);

  if (error) {
    console.error('❌ Error fetching chunks:', error.message);
    process.exit(1);
  }

  if (!chunks?.length) {
    console.log('✅ No chunks need embedding (all done!)');
    process.exit(0);
  }

  console.log(`Found ${chunks.length} chunks without embeddings`);

  const limiter = pLimit(4); // 4 concurrent embedding requests
  let updated = 0;
  const errors: string[] = [];

  await Promise.all(
    chunks.map((c) =>
      limiter(async () => {
        try {
          console.log(`  Embedding chunk ${c.id.substring(0, 8)}...`);
          const v = await embedText(c.content);
          const { error: upErr } = await sb
            .from('deal_doc_chunks')
            .update({ embedding: v })
            .eq('id', c.id);
          if (upErr) throw upErr;
          updated += 1;
          console.log(`  ✅ Embedded chunk ${c.id.substring(0, 8)}`);
        } catch (e: any) {
          const errMsg = `Chunk ${c.id}: ${e.message}`;
          errors.push(errMsg);
          console.error(`  ❌ ${errMsg}`);
        }
      })
    )
  );

  console.log(`\n✅ Embedded ${updated} chunks for deal ${dealId}`);

  if (errors.length > 0) {
    console.log(`\n⚠️  Errors (${errors.length}):`);
    errors.forEach((err) => console.log(`  - ${err}`));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
