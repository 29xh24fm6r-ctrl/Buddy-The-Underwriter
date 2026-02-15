import "server-only";

import { NextResponse, NextRequest } from "next/server";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { loadRegulatorSandbox } from "@/lib/sandbox/loadRegulatorSandbox";
import {
  respond200,
  createHeaders,
  generateCorrelationId,
  createTimestamp,
  sanitizeError,
} from "@/lib/api/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/sandbox/deals";

/**
 * GET /api/sandbox/deals
 *
 * Returns the sandbox deal list for the current bank.
 * Read-only. All data served from snapshot builders, never live tables.
 *
 * Accessible to: super_admin, bank_admin, regulator_sandbox
 */
export async function GET(_req: NextRequest) {
  const correlationId = generateCorrelationId("sbx");
  const ts = createTimestamp();
  const headers = createHeaders(correlationId, ROUTE);

  try {
    await requireRoleApi(["super_admin", "bank_admin", "regulator_sandbox"]);
    const bankId = await getCurrentBankId();

    const sandbox = await loadRegulatorSandbox(bankId);

    return respond200(
      {
        ok: true,
        sandbox,
        meta: { correlationId, ts, bankId },
      },
      headers,
    );
  } catch (err) {
    rethrowNextErrors(err);

    if (err instanceof AuthorizationError) {
      return NextResponse.json(
        { ok: false, error: err.code },
        { status: err.code === "not_authenticated" ? 401 : 403 },
      );
    }

    const safe = sanitizeError(err, "sandbox_load_failed");
    return respond200(
      { ok: false, error: safe, meta: { correlationId, ts } },
      headers,
    );
  }
}
