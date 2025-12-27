import { embedMissingChunksForDeal } from "@/lib/retrieval/embedChunks";

async function main() {
  const dealId = process.argv[2];
  if (!dealId) {
    console.error("Usage: npx tsx scripts/evidence/embedDeal.ts <dealId>");
    process.exit(1);
  }

  console.log(`🔮 Embedding chunks for deal ${dealId}...`);

  const res = await embedMissingChunksForDeal(dealId, { limit: 500 });

  console.log(`\n✅ Embedded ${res.updated} chunks for deal ${dealId}`);

  if (res.errors.length > 0) {
    console.log(`\n⚠️  Errors (${res.errors.length}):`);
    res.errors.forEach((err) => console.log(`  - ${err}`));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
