import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkEmbeddings() {
  const dealId = '3d5f3725-5961-4cc2-91dd-3e95c54e7151';
  
  const { data, error } = await sb
    .from('deal_doc_chunks')
    .select('deal_id, id, embedding')
    .eq('deal_id', dealId);

  if (error) {
    console.error('Error:', error.message);
    return;
  }

  const total = data.length;
  const embedded = data.filter(row => row.embedding !== null).length;
  
  console.log('📊 Embedding Status:');
  console.log(`Deal ID: ${dealId}`);
  console.log(`Total chunks: ${total}`);
  console.log(`Embedded: ${embedded}`);
  console.log(`Missing: ${total - embedded}`);
  
  if (embedded === total) {
    console.log('\n✅ All chunks embedded!');
  } else {
    console.log(`\n⚠️  Still need to embed ${total - embedded} chunks`);
  }
}

checkEmbeddings().catch(console.error);
