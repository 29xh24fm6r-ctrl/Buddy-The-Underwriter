import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkTables() {
  // Try deal_doc_chunks
  const { data, error } = await sb
    .from('deal_doc_chunks')
    .select('id, content, deal_id, embedding')
    .limit(10);

  console.log('✅ Checking deal_doc_chunks...');
  console.log('rows:', data?.length ?? 0);
  console.log('error:', error?.message ?? 'none');

  if (!error && data && data.length > 0) {
    console.log('Sample:', {
      id: data[0].id,
      deal_id: data[0].deal_id,
      has_embedding: data[0].embedding !== null,
      content_preview: data[0].content?.substring(0, 50)
    });
    
    const res2 = await sb
      .from('deal_doc_chunks')
      .select('*', { count: 'exact', head: true })
      .is('embedding', null);
    
    console.log('Chunks without embeddings:', res2.count);
  }
}

checkTables().catch(console.error);
