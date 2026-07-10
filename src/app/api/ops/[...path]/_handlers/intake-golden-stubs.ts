import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { generateGoldenTest, type ClusterInput } from "@/lib/intake/override/generateGoldenTest";
import confusionExamples from "@/lib/classification/confusionExamples.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// GET /api/ops/intake/golden-stubs
//
// Closes the override-correction feedback loop that generateGoldenTest()
// and override_clusters_v1 already implement but nothing ever called:
//   1. Pull high-signal correction clusters (>=3 occurrences) from the ledger.
//   2. Generate test.skip() golden-test stubs for a human to review and
//      promote — this is the existing generateGoldenTest() contract.
//   3. Cross-reference confusionExamples.json (the Tier3 LLM prompt's
//      curated confusion pairs) and flag clusters that have NO corresponding
//      entry yet, so a human knows which prompt examples are worth adding.
//
// Buddy alerts and drafts — it does not auto-patch. A human must review the
// generated stub source and the missing-example list before committing
// anything to the repo.
// ---------------------------------------------------------------------------

type ClusterRow = {
  from_type: string | null;
  to_type: string | null;
  override_count: number | null;
  avg_confidence_at_time: number | null;
  dominant_classifier_source: string | null;
  classification_version_range: string | null;
  segmentation_presence_ratio: number | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
};

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    await requireSuperAdmin();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const sb = supabaseAdmin();
    const { data, error } = await (sb as any)
      .from("override_clusters_v1")
      .select("*")
      .order("override_count", { ascending: false })
      .limit(100);

    if (error) {
      console.warn("[ops/intake/golden-stubs] cluster query error:", error);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const rows: ClusterRow[] = data ?? [];
    const clusters: ClusterInput[] = rows
      .filter((r) => r.from_type && r.to_type)
      .map((r) => ({
        fromType: String(r.from_type),
        toType: String(r.to_type),
        overrideCount: Number(r.override_count ?? 0),
        avgConfidence: r.avg_confidence_at_time != null ? Number(r.avg_confidence_at_time) : null,
        dominantClassifierSource: r.dominant_classifier_source,
        classificationVersionRange: r.classification_version_range,
        segmentationPresenceRatio:
          r.segmentation_presence_ratio != null ? Number(r.segmentation_presence_ratio) : null,
        firstSeenAt: r.first_seen_at ?? "",
        lastSeenAt: r.last_seen_at ?? "",
      }));

    // Caller-supplied generatedAt (never Date.now() inside the pure generator).
    const generatedAt = new Date().toISOString();
    const filenameVersion = req.nextUrl.searchParams.get("version") ?? "v1";
    const testStubSource = generateGoldenTest(clusters, { generatedAt, filenameVersion });

    // Cross-reference against confusionExamples.json — surface clusters
    // that have real override volume but no curated Tier3 prompt example yet.
    const knownPairs = new Set(
      (confusionExamples as Array<{ original_type: string; corrected_type: string }>).map(
        (e) => `${e.original_type}|||${e.corrected_type}`,
      ),
    );
    const missingConfusionExamples = clusters
      .filter((c) => c.overrideCount >= 3 && !knownPairs.has(`${c.fromType}|||${c.toType}`))
      .map((c) => ({
        original_type: c.fromType,
        corrected_type: c.toType,
        override_count: c.overrideCount,
        avg_confidence_at_time: c.avgConfidence,
      }));

    return NextResponse.json({
      ok: true,
      generatedAt,
      clusterCount: clusters.length,
      testStubSource: testStubSource || null,
      suggestedFilePath: testStubSource
        ? `src/lib/intake/matching/__tests__/override_generated/override_golden_${filenameVersion}.test.ts`
        : null,
      missingConfusionExamples,
    });
  } catch (e: any) {
    console.error("[ops/intake/golden-stubs] unexpected error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "Internal error" }, { status: 500 });
  }
}
