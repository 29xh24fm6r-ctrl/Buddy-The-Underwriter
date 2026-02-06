import "server-only";

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { isGoogleDocAiEnabled } from "@/lib/flags/googleDocAi";
import { docAiAuthMode } from "@/lib/extract/googleDocAi";
import { hasWifProviderConfig } from "@/lib/google/wif/getWifProvider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeMsg(msg: string, max = 240): string {
  return msg.length > max ? `${msg.slice(0, max - 1)}…` : msg;
}

/**
 * GET /api/debug/docai/health
 *
 * Admin-only healthcheck that verifies:
 * 1. DocAI feature flag is enabled
 * 2. Auth mode can be determined
 * 3. DocAI client can be instantiated
 * 4. A real lightweight API call (getProcessor) succeeds
 */
export async function GET() {
  try {
    await requireSuperAdmin();
  } catch {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const enabled = isGoogleDocAiEnabled();
  const authMode = docAiAuthMode();
  const hasWif = hasWifProviderConfig();
  const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_PROJECT_ID || null;
  const location = process.env.GOOGLE_DOCAI_LOCATION || process.env.GOOGLE_CLOUD_LOCATION || "us";

  // Resolve test processor name — full resource name or composed from split vars
  const testProcessor =
    process.env.GOOGLE_DOCAI_TEST_PROCESSOR ||
    process.env.GOOGLE_DOCAI_FINANCIAL_PROCESSOR_ID ||
    process.env.GOOGLE_DOCAI_TAX_PROCESSOR_ID ||
    null;

  const result: Record<string, unknown> = {
    ok: false,
    enabled,
    authMode,
    hasWif,
    project,
    location,
    testProcessor: testProcessor ? "(configured)" : null,
  };

  if (!enabled) {
    return NextResponse.json({
      ...result,
      error: "GOOGLE_DOCAI_ENABLED is not true",
    });
  }

  if (!testProcessor) {
    return NextResponse.json({
      ...result,
      error: "No processor configured. Set GOOGLE_DOCAI_TEST_PROCESSOR, GOOGLE_DOCAI_FINANCIAL_PROCESSOR_ID, or GOOGLE_DOCAI_TAX_PROCESSOR_ID.",
    });
  }

  if (!project) {
    return NextResponse.json({
      ...result,
      error: "Missing GOOGLE_CLOUD_PROJECT",
    });
  }

  // Build full processor resource name
  const processorName = testProcessor.startsWith("projects/")
    ? testProcessor
    : `projects/${project}/locations/${location}/processors/${testProcessor}`;

  try {
    // Dynamic import — keeps @google-cloud/documentai out of the webpack bundle
    const { DocumentProcessorServiceClient } = await import("@google-cloud/documentai");

    let client: InstanceType<typeof DocumentProcessorServiceClient>;

    if (authMode === "vercel_wif") {
      const { getVercelWifAuthClient } = await import("@/lib/gcp/vercelAuth");
      const authClient = await getVercelWifAuthClient();
      client = new DocumentProcessorServiceClient({ authClient: authClient as any });
    } else if (authMode === "json") {
      const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON!;
      const credentials = JSON.parse(credsJson);
      client = new DocumentProcessorServiceClient({ credentials });
    } else {
      client = new DocumentProcessorServiceClient();
    }

    // Lightweight API call: getProcessor (no document upload)
    const [processor] = await client.getProcessor({ name: processorName });

    return NextResponse.json({
      ...result,
      ok: true,
      processor: {
        name: processor.name,
        type: processor.type,
        state: processor.state,
        displayName: processor.displayName,
      },
    });
  } catch (e: any) {
    return NextResponse.json({
      ...result,
      error: {
        stage: "getProcessor",
        message: safeMsg(String(e?.message ?? e)),
      },
    });
  }
}
