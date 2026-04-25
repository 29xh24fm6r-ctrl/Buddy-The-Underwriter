export type StitchSurfaceKey =
  // ── Existing (keep as-is) ──────────────────────────────────
  | "deal_command"
  | "underwrite"
  | "credit_committee"
  | "borrower_portal"
  | "portfolio"
  | "deal_intake"
  // ── Class 1: Direct page restoration ───────────────────────
  | "pipeline_analytics_command_center"
  | "loan_servicing_command_center"
  | "workout_command_center"
  | "workout_case_file"
  | "workout_committee_packet"
  | "workout_legal_execution_tracker"
  | "reo_command_center"
  | "chargeoff_recovery_command_center"
  | "audit_compliance_ledger"
  | "document_template_vault"
  | "exceptions_change_review"
  | "ocr_review_data_validation"
  | "roles_permissions_control"
  | "merge_field_registry"
  | "borrower_control_record"
  | "credit_committee_view"
  // ── Class 2: Deal-scoped restoration ───────────────────────
  | "deals_command_bridge"
  | "borrower_task_inbox"
  | "borrower_document_upload_inbox"
  | "borrower_profile"
  | "pricing_memo_command_center"
  | "credit_memo_pdf_template"
  | "deal_output_credit_memo_spreads"
  // ── Class 3: Recovery routes ───────────────────────────────
  | "stitch_login";

export type StitchSurfaceConfig = {
  key: StitchSurfaceKey;
  route: string;
  required: boolean;
  owner: "banker" | "borrower" | "admin";
  mode: "iframe" | "new_tab" | "panel";
  slug?: string;
  openHref?: string;
  activation?: "dealId" | "token";
  pagePath?: string;
  notes?: string;
};

export const STITCH_SURFACES: StitchSurfaceConfig[] = [
  // ══════════════════════════════════════════════════════════════
  // Existing surfaces (keep as-is)
  // ══════════════════════════════════════════════════════════════
  {
    key: "deal_command",
    route: "/deals/[dealId]/command",
    required: true,
    owner: "banker",
    mode: "panel",
    slug: "command-center-latest",
    pagePath: "src/app/(app)/deals/[dealId]/command/StitchPanel.tsx",
    notes: "Command surface uses panel mode to avoid duplicate CTAs.",
  },
  {
    key: "underwrite",
    route: "/deals/[dealId]/underwrite",
    required: true,
    owner: "banker",
    mode: "iframe",
    slug: "underwrite",
    activation: "dealId",
    pagePath: "src/app/(app)/deals/[dealId]/underwrite/page.tsx",
    notes: "Canonical underwriting route. AnalystWorkbench is primary. Embeds deals_command_bridge as transitional legacy Stitch layer. No standalone stitch_exports/underwrite/code.html.",
  },
  {
    key: "credit_committee",
    route: "/deals/[dealId]/committee",
    required: true,
    owner: "banker",
    mode: "iframe",
    slug: "deal-summary",
    pagePath: "src/app/(app)/deals/[dealId]/committee/CommitteeView.tsx",
  },
  {
    key: "borrower_portal",
    route: "/borrower/portal",
    required: true,
    owner: "borrower",
    mode: "iframe",
    slug: "borrower-document-upload-review",
    activation: "token",
    pagePath: "src/app/(app)/borrower/portal/page.tsx",
  },
  {
    key: "portfolio",
    route: "/portfolio",
    required: true,
    owner: "banker",
    mode: "iframe",
    slug: "portfolio-command-bridge",
    pagePath: "src/app/(app)/portfolio/page.tsx",
  },
  {
    key: "deal_intake",
    route: "/intake",
    required: true,
    owner: "banker",
    mode: "iframe",
    slug: "deal-intake-console",
    pagePath: "src/app/(app)/intake/page.tsx",
  },

  // ══════════════════════════════════════════════════════════════
  // Class 1: Direct page restoration (non-deal-scoped)
  // ══════════════════════════════════════════════════════════════
  {
    key: "pipeline_analytics_command_center",
    route: "/analytics",
    required: true,
    owner: "banker",
    mode: "iframe",
    slug: "pipeline-analytics-command-center",
    pagePath: "src/app/(app)/analytics/page.tsx",
    notes: "Pipeline analytics dashboard — restored from saved Stitch export.",
  },
  {
    key: "loan_servicing_command_center",
    route: "/servicing",
    required: true,
    owner: "banker",
    mode: "iframe",
    slug: "loan-servicing-command-center",
    pagePath: "src/app/(app)/servicing/page.tsx",
    notes: "Loan servicing command center — restored from saved Stitch export.",
  },
  {
    key: "workout_command_center",
    route: "/workout",
    required: true,
    owner: "banker",
    mode: "iframe",
    slug: "workout-command-center",
    pagePath: "src/app/(app)/workout/page.tsx",
    notes: "Workout command center — restored from saved Stitch export.",
  },
  {
    key: "workout_case_file",
    route: "/workout/case-file",
    required: true,
    owner: "banker",
    mode: "iframe",
    slug: "workout-case-file",
    pagePath: "src/app/(app)/workout/case-file/page.tsx",
    notes: "Workout case file — restored from saved Stitch export.",
  },
  {
    key: "workout_committee_packet",
    route: "/workout/committee-packet",
    required: true,
    owner: "banker",
    mode: "iframe",
    slug: "workout-committee-packet",
    pagePath: "src/app/(app)/workout/committee-packet/page.tsx",
    notes: "Workout committee packet — restored from saved Stitch export.",
  },
  {
    key: "workout_legal_execution_tracker",
    route: "/workout/legal",
    required: true,
    owner: "banker",
    mode: "iframe",
    slug: "workout-legal-execution-tracker",
    pagePath: "src/app/(app)/workout/legal/page.tsx",
    notes: "Workout legal execution tracker — restored from saved Stitch export.",
  },
  {
    key: "reo_command_center",
    route: "/workout/reo",
    required: true,
    owner: "banker",
    mode: "iframe",
    slug: "reo-command-center",
    pagePath: "src/app/(app)/workout/reo/page.tsx",
    notes: "REO command center — restored from saved Stitch export.",
  },
  {
    key: "chargeoff_recovery_command_center",
    route: "/workout/chargeoff",
    required: true,
    owner: "banker",
    mode: "iframe",
    slug: "chargeoff-recovery-command-center",
    pagePath: "src/app/(app)/workout/chargeoff/page.tsx",
    notes: "Chargeoff recovery command center — restored from saved Stitch export.",
  },
  {
    key: "audit_compliance_ledger",
    route: "/compliance/audit-ledger",
    required: true,
    owner: "admin",
    mode: "iframe",
    slug: "audit-compliance-ledger",
    pagePath: "src/app/(app)/compliance/audit-ledger/page.tsx",
    notes: "Audit compliance ledger — restored from saved Stitch export.",
  },
  {
    key: "document_template_vault",
    route: "/templates/vault",
    required: true,
    owner: "banker",
    mode: "iframe",
    slug: "document-template-vault",
    pagePath: "src/app/(app)/templates/vault/page.tsx",
    notes: "Document template vault — restored from saved Stitch export.",
  },
  {
    key: "exceptions_change_review",
    route: "/exceptions",
    required: true,
    owner: "banker",
    mode: "iframe",
    slug: "exceptions-change-review",
    pagePath: "src/app/(app)/exceptions/page.tsx",
    notes: "Exceptions change review — restored from saved Stitch export.",
  },
  {
    key: "ocr_review_data_validation",
    route: "/ocr/review",
    required: true,
    owner: "banker",
    mode: "iframe",
    slug: "ocr-review-data-validation",
    pagePath: "src/app/(app)/ocr/review/page.tsx",
    notes: "OCR review and data validation — restored from saved Stitch export.",
  },
  {
    key: "roles_permissions_control",
    route: "/admin/roles",
    required: true,
    owner: "admin",
    mode: "iframe",
    slug: "roles-permissions-control",
    pagePath: "src/app/(app)/admin/roles/page.tsx",
    notes: "Roles and permissions control — restored from saved Stitch export.",
  },
  {
    key: "merge_field_registry",
    route: "/admin/merge-fields",
    required: true,
    owner: "admin",
    mode: "iframe",
    slug: "merge-field-registry",
    pagePath: "src/app/(app)/admin/merge-fields/page.tsx",
    notes: "Merge field registry — restored from saved Stitch export.",
  },
  {
    key: "borrower_control_record",
    route: "/borrowers/control-record",
    required: true,
    owner: "banker",
    mode: "iframe",
    slug: "borrower-control-record",
    pagePath: "src/app/(app)/borrowers/control-record/page.tsx",
    notes: "Borrower control record — restored from saved Stitch export.",
  },
  {
    key: "credit_committee_view",
    route: "/credit/committee",
    required: true,
    owner: "banker",
    mode: "iframe",
    slug: "credit-committee-view",
    pagePath: "src/app/(app)/credit/committee/page.tsx",
    notes: "Credit committee overview — restored from saved Stitch export.",
  },

  // ══════════════════════════════════════════════════════════════
  // Class 2: Deal-scoped Stitch restoration
  // ══════════════════════════════════════════════════════════════
  {
    key: "deals_command_bridge",
    route: "/deals/[dealId]/underwriter",
    required: false,
    owner: "banker",
    mode: "iframe",
    slug: "deals-command-bridge",
    activation: "dealId",
    pagePath: "src/app/(app)/deals/[dealId]/underwriter/page.tsx",
    notes: "RETIRED — Phase 57C. Route redirects to /deals/[dealId]/underwrite. No longer a required Stitch surface.",
  },
  {
    key: "borrower_task_inbox",
    route: "/deals/[dealId]/portal-inbox",
    required: true,
    owner: "banker",
    mode: "iframe",
    slug: "borrower-task-inbox",
    activation: "dealId",
    pagePath: "src/app/(app)/deals/[dealId]/portal-inbox/page.tsx",
    notes: "Borrower task inbox — restored from saved Stitch export.",
  },
  {
    key: "borrower_document_upload_inbox",
    route: "/deals/[dealId]/borrower-inbox",
    required: true,
    owner: "banker",
    mode: "iframe",
    slug: "borrower-document-upload-review",
    activation: "dealId",
    pagePath: "src/app/(app)/deals/[dealId]/borrower-inbox/page.tsx",
    notes: "Borrower document upload inbox — restored from saved Stitch export.",
  },
  {
    key: "borrower_profile",
    route: "/deals/[dealId]/borrower",
    required: true,
    owner: "banker",
    mode: "iframe",
    slug: "borrower-profile",
    activation: "dealId",
    pagePath: "src/app/(app)/deals/[dealId]/borrower/page.tsx",
    notes: "Borrower profile — restored from saved Stitch export.",
  },
  {
    key: "pricing_memo_command_center",
    route: "/deals/[dealId]/pricing-memo",
    required: true,
    owner: "banker",
    mode: "iframe",
    slug: "pricing-memo-command-center",
    activation: "dealId",
    pagePath: "src/app/(app)/deals/[dealId]/pricing-memo/page.tsx",
    notes: "Pricing memo command center — restored from saved Stitch export.",
  },
  {
    key: "credit_memo_pdf_template",
    route: "/deals/[dealId]/memo-template",
    required: true,
    owner: "banker",
    mode: "iframe",
    slug: "credit-memo-pdf-template",
    activation: "dealId",
    pagePath: "src/app/(app)/deals/[dealId]/memo-template/page.tsx",
    notes: "Credit memo PDF template — restored from saved Stitch export.",
  },
  {
    key: "deal_output_credit_memo_spreads",
    route: "/deals/[dealId]/memos/new",
    required: true,
    owner: "banker",
    mode: "iframe",
    slug: "deal-output-credit-memo-spreads",
    activation: "dealId",
    pagePath: "src/app/(app)/deals/[dealId]/memos/new/page.tsx",
    notes: "Deal output credit memo spreads — restored from saved Stitch export.",
  },

  // ══════════════════════════════════════════════════════════════
  // Class 3: Recovery routes (optional, non-destructive)
  // ══════════════════════════════════════════════════════════════
  // Note: deals_pipeline_recovery + deal_intake_recovery retired in
  // Sprint A.1 (route-manifest reduction). Native /deals and /deals/new
  // are the live canonical surfaces; the recovery comparison routes
  // were never promoted out of `recovery_optional` status.
  {
    key: "stitch_login",
    route: "/stitch-login",
    required: false,
    owner: "borrower",
    mode: "iframe",
    slug: "stitch_buddy_login_page",
    pagePath: "src/app/stitch-login/page.tsx",
    notes: "Branded Stitch login shell — does not replace Clerk auth mechanics.",
  },
];

export function getStitchSurfaceConfig(key: StitchSurfaceKey): StitchSurfaceConfig | null {
  return STITCH_SURFACES.find((surface) => surface.key === key) ?? null;
}
