// ---------------------------------------------------------------------------
// Phase 15B — Slot Policy Types
// ---------------------------------------------------------------------------

export type BusinessStage = "EXISTING" | "STARTUP" | "ACQUISITION";

export type SlotMode = "UPLOAD" | "INTERACTIVE";

export type InteractiveKind =
  | "PFS_BUILDER"
  | "PROJECTIONS_BUILDER"
  | "QUESTIONNAIRE"
  | null;

/** Persisted scenario signals that drive deterministic slot generation. */
export type IntakeScenario = {
  product_type: string;
  borrower_business_stage: BusinessStage;
  has_business_tax_returns: boolean;
  has_financial_statements: boolean;
  has_projections: boolean;
  entity_age_months: number | null;
};

/** Full slot definition returned by a slot policy. */
export type SlotDefinition = {
  slot_key: string;
  slot_group: string;
  required_doc_type: string;
  required_tax_year: number | null;
  required: boolean;
  sort_order: number;
  slot_mode: SlotMode;
  interactive_kind: InteractiveKind;
  help_title?: string | null;
  help_reason?: string | null;
  help_examples?: string[] | null;
  help_alternatives?: string[] | null;
};

/** A slot policy generates deterministic slots for a given scenario. */
export type SlotPolicy = {
  product: string;
  generateSlots: (scenario: IntakeScenario, now?: Date) => SlotDefinition[];
};
