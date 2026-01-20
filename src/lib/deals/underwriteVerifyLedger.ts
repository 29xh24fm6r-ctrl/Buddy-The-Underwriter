
export type UnderwriteVerifyDetails = {
  url: string;
  httpStatus?: number;
  auth?: boolean;
  html?: boolean;
  metaFallback?: boolean;
  error?: string;
  redacted?: boolean;
};

export type UnderwriteVerifySource = "builder" | "runtime";

export type UnderwriteVerifyLedgerMeta = {
  status: "pass" | "fail";
  source: UnderwriteVerifySource;
  details: UnderwriteVerifyDetails;
  recommendedNextAction?: string | null;
  diagnostics?: Record<string, unknown> | null;
  timestamp?: string;
};

export async function logUnderwriteVerifyLedger(params: {
  dealId: string;
  bankId: string;
  status: "pass" | "fail";
  source: UnderwriteVerifySource;
  details: UnderwriteVerifyDetails;
  recommendedNextAction?: string | null;
  diagnostics?: Record<string, unknown> | null;
  logLedgerEvent?: (args: {
    dealId: string;
    bankId: string;
    eventKey: string;
    uiState: "working" | "done" | "waiting";
    uiMessage: string;
    meta?: Record<string, unknown>;
  }) => Promise<void>;
}) {
  const {
    dealId,
    bankId,
    status,
    source,
    details,
    recommendedNextAction,
    diagnostics,
    logLedgerEvent: ledgerOverride,
  } = params;

  const ledger =
    ledgerOverride ?? (await import("@/lib/pipeline/logLedgerEvent")).logLedgerEvent;

  // CANON: All verify-underwrite diagnostics MUST be persisted via deal ledger.
  // Console logs are forbidden outside dev-only guards.
  await ledger({
    dealId,
    bankId,
    eventKey: "deal.underwrite.verify",
    uiState: "done",
    uiMessage:
      status === "pass" ? "Underwrite verify passed" : "Underwrite verify blocked",
    meta: {
      status,
      source,
      details,
      recommendedNextAction: recommendedNextAction ?? null,
      diagnostics: diagnostics ?? null,
      timestamp: new Date().toISOString(),
    } satisfies UnderwriteVerifyLedgerMeta,
  });
}
