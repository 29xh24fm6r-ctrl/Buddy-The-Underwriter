import { NextRequest, NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { signGcsReadUrl } from "@/lib/storage/gcs";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ dealId: string; documentId: string }>;
};

export async function GET(_req: NextRequest, ctx: Context) {
  try {
    const { userId } = await clerkAuth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { dealId, documentId } = await ctx.params;
    const bankId = await getCurrentBankId();
    const sb = supabaseAdmin();

    const { data: doc, error } = await sb
      .from("deal_documents")
      .select("id, deal_id, bank_id, storage_bucket, storage_path")
      .eq("id", documentId)
      .eq("deal_id", dealId)
      .maybeSingle();

    if (error || !doc || doc.bank_id !== bankId) {
      return NextResponse.json(
        { ok: false, error: "File not found" },
        { status: 404 },
      );
    }

    const storageBucket = String(doc.storage_bucket || "deal-uploads");
    const storagePath = String(doc.storage_path || "");

    if (!storagePath) {
      return NextResponse.json(
        { ok: false, error: "Missing storage path" },
        { status: 404 },
      );
    }

    const gcsBucket = process.env.GCS_BUCKET || "";
    if (gcsBucket && storageBucket === gcsBucket) {
      const signedUrl = await signGcsReadUrl({
        key: storagePath,
        expiresSeconds: 60 * 10,
      });

      await logLedgerEvent({
        dealId,
        bankId,
        eventKey: "documents.download_signed",
        uiState: "done",
        uiMessage: "Signed download generated (gcs)",
        meta: {
          storage_bucket: storageBucket,
          storage_path: storagePath,
          document_id: documentId,
        },
      });

      return NextResponse.redirect(signedUrl, 302);
    }

    const { data, error: signErr } = await sb.storage
      .from(storageBucket)
      .createSignedUrl(storagePath, 60 * 10);

    if (signErr || !data?.signedUrl) {
      return NextResponse.json(
        { ok: false, error: signErr?.message || "Failed to sign download" },
        { status: 500 },
      );
    }

    await logLedgerEvent({
      dealId,
      bankId,
      eventKey: "documents.download_signed",
      uiState: "done",
      uiMessage: "Signed download generated (supabase)",
      meta: {
        storage_bucket: storageBucket,
        storage_path: storagePath,
        document_id: documentId,
      },
    });

    return NextResponse.redirect(data.signedUrl, 302);
  } catch (error: any) {
    console.error("[files/download]", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Internal server error" },
      { status: 500 },
    );
  }
}
