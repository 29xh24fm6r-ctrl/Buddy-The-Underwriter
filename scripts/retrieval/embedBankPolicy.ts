import pLimit from "p-limit";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";

type Args = {
  bankId: string;
  file?: string;
  kind?: string;
  title?: string;
  description?: string;
};

function parseArgs(argv: string[]): Args {
  // Back-compat: `embedBankPolicy.ts <bank_uuid>`
  const out: any = {};
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a) continue;
    if (!a.startsWith("--")) {
      positional.push(a);
      continue;
    }

    const key = a.replace(/^--+/, "").trim();
    const val = argv[i + 1];
    if (!val || val.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = val;
      i++;
    }
  }

  const bankId = String(out.bank || out.bankId || positional[0] || "").trim();
  if (!bankId) {
    console.error(
      "Usage: npx tsx scripts/retrieval/embedBankPolicy.ts <bank_uuid> [--file <path>] [--kind <kind>] [--title <title>]",
    );
    process.exit(1);
  }

  return {
    bankId,
    file: typeof out.file === "string" ? out.file : undefined,
    kind: typeof out.kind === "string" ? out.kind : undefined,
    title: typeof out.title === "string" ? out.title : undefined,
    description: typeof out.description === "string" ? out.description : undefined,
  };
}

function inferMimeFromExt(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase().replace(/^\./, "");
  if (ext === "pdf") return "application/pdf";
  if (ext === "md" || ext === "markdown") return "text/markdown";
  if (ext === "txt") return "text/plain";
  return "application/octet-stream";
}

function safeExt(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase().replace(/^\./, "");
  const cleaned = ext.replace(/[^a-z0-9]/g, "").slice(0, 8);
  return cleaned || "bin";
}

function chunkText(raw: string): Array<{ section: string | null; content: string }> {
  const text = String(raw || "").replace(/\r\n/g, "\n");

  // Lightweight markdown-aware segmentation by headings.
  const lines = text.split("\n");
  const blocks: Array<{ section: string | null; text: string }> = [];
  let curSection: string | null = null;
  let curLines: string[] = [];

  function flush() {
    const t = curLines.join("\n").trim();
    if (t) blocks.push({ section: curSection, text: t });
    curLines = [];
  }

  for (const line of lines) {
    const m = /^#{1,6}\s+(.+)$/.exec(line.trim());
    if (m) {
      flush();
      curSection = m[1].trim() || null;
      continue;
    }
    curLines.push(line);
  }
  flush();

  // Re-chunk into ~1200 char windows with small overlap.
  const MAX = 1200;
  const OVERLAP = 120;
  const out: Array<{ section: string | null; content: string }> = [];

  for (const b of blocks.length ? blocks : [{ section: null, text }]) {
    const t = b.text;
    if (t.length <= MAX) {
      out.push({ section: b.section, content: t });
      continue;
    }

    let i = 0;
    while (i < t.length) {
      const slice = t.slice(i, i + MAX).trim();
      if (slice) out.push({ section: b.section, content: slice });
      if (i + MAX >= t.length) break;
      i += Math.max(1, MAX - OVERLAP);
    }
  }

  return out;
}

async function extractTextFromFile(filePath: string, mimeType: string): Promise<string> {
  if (mimeType === "application/pdf") {
    const bytes = await fs.readFile(filePath);
    const mod = await import("pdf-parse");
    const pdfParse = (mod as any).default ?? (mod as any);
    const out = await pdfParse(bytes);
    return String(out?.text || "");
  }
  return await fs.readFile(filePath, "utf8");
}

async function ingestLocalPolicyFile(args: {
  sb: any;
  bankId: string;
  filePath: string;
  kind: string;
  title: string;
  description?: string;
}): Promise<{ assetId: string; chunksInserted: number }> {
  const { sb, bankId, filePath, kind, title, description } = args;
  const abs = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  const mime = inferMimeFromExt(abs);
  const bytes = await fs.readFile(abs);

  const bucket = process.env.BANK_ASSETS_BUCKET || "bank-assets";
  const assetId = crypto.randomUUID();
  const storagePath = `${bankId}/${kind}/${assetId}.${safeExt(abs)}`;

  const up = await sb.storage
    .from(bucket)
    .upload(storagePath, bytes, { contentType: mime, upsert: false });
  if (up.error) throw up.error;

  const insAsset = await sb.from("bank_assets").insert({
    id: assetId,
    bank_id: bankId,
    kind,
    title,
    description: description ?? null,
    storage_bucket: bucket,
    storage_path: storagePath,
    mime_type: mime,
    size_bytes: bytes.byteLength,
    version: 1,
    active: true,
    created_by: null,
  } as any);

  if (insAsset.error) throw insAsset.error;

  const extractedText = await extractTextFromFile(abs, mime);
  const chunks = chunkText(extractedText);
  const sourceLabel = path.basename(abs);

  // Ensure idempotent for this asset.
  await sb.from("bank_policy_chunks").delete().eq("bank_id", bankId).eq("asset_id", assetId);

  const rows = chunks.map((c, idx) => ({
    bank_id: bankId,
    asset_id: assetId,
    chunk_index: idx,
    content: c.content,
    page_num: null,
    section: c.section,
    source_label: sourceLabel,
  }));

  // source_label may not exist on older DBs; retry without it if needed.
  const insChunks = await sb.from("bank_policy_chunks").insert(rows as any);
  if (insChunks.error) {
    const msg = String(insChunks.error.message || "");
    if (msg.toLowerCase().includes("source_label")) {
      const fallbackRows = rows.map(({ source_label: _sl, ...rest }) => rest);
      const ins2 = await sb.from("bank_policy_chunks").insert(fallbackRows as any);
      if (ins2.error) throw ins2.error;
    } else {
      throw insChunks.error;
    }
  }

  return { assetId, chunksInserted: rows.length };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const bankId = args.bankId;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const apiKey = process.env.OPENAI_API_KEY!;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL missing");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing");
  if (!apiKey) throw new Error("OPENAI_API_KEY missing");

  const sb = createClient(url, key, { auth: { persistSession: false } });
  const openai = new OpenAI({ apiKey });

  if (args.file) {
    const kind = args.kind || "credit_policy";
    const title = args.title || path.basename(args.file);
    console.log("🧩 Ingesting policy file into bank_policy_chunks…", {
      bankId,
      file: args.file,
      kind,
      title,
    });

    const ing = await ingestLocalPolicyFile({
      sb,
      bankId,
      filePath: args.file,
      kind,
      title,
      description: args.description,
    });

    console.log("✅ Ingested policy asset + chunks", {
      bankId,
      assetId: ing.assetId,
      chunksInserted: ing.chunksInserted,
    });
  }

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
