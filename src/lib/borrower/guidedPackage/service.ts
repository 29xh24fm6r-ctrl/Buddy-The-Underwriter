import { DISCOVERY_CHOICES } from "../journey/discovery";
import { getForm722Status } from "@/lib/sba/forms/form722/service";
import "server-only";
import { buildGuidedSnapshot, parseAnswer, GUIDED_CHOICES } from "./questions";
import { storeSecurePii } from "@/lib/builder/secure/securePiiIntake";
import { redactSsnPatterns } from "@/lib/brokerage/redactSensitive";
type SB = {
  from: (table: string) => any;
  rpc: (name: string, args: Record<string, unknown>) => any;
};
type Session = {
  deal_id: string;
  bank_id: string;
};
const TABLES = [
  "borrowers",
  "ownership_entities",
  "deal_loan_requests",
  "sba_loans",
  "deal_pii_records",
  "character_question_confirmations",
];
export async function loadGuidedPackage(sb: SB, session: Session) {
  const dealResult = await sb
    .from("deals")
    .select("*")
    .eq("id", session.deal_id)
    .eq("bank_id", session.bank_id)
    .maybeSingle();
  if (dealResult.error || !dealResult.data)
    throw new Error("Application unavailable. Please reload.");
  const rows: Record<string, Record<string, any>[]> = {
    deals: [dealResult.data],
  };
  const readErrors: string[] = [];
  await Promise.all(
    TABLES.map(async (table) => {
      const columns =
        table === "deal_pii_records"
          ? "ownership_entity_id,pii_type"
          : table === "character_question_confirmations"
            ? "ownership_entity_id,field_key,answer"
            : "*";
      if (table === "borrowers" && !dealResult.data.borrower_id) {
        rows[table] = [];
        return;
      }
      let query = sb
        .from(table)
        .select(columns)
        .eq(
          table === "borrowers" ? "id" : "deal_id",
          table === "borrowers" ? dealResult.data.borrower_id : session.deal_id,
        );
      if (table === "deal_loan_requests")
        query = query.order("created_at", { ascending: false }).limit(1);
      const result = await query;
      if (result.error) readErrors.push(table);
      rows[table] = result.data ?? [];
    }),
  );
  const ownerIds = (rows.ownership_entities ?? []).map((o) => o.id);
  if (ownerIds.length) {
    const financials = await sb
      .from("borrower_applicant_financials")
      .select("*")
      .in("applicant_id", ownerIds);
    if (financials.error) readErrors.push("borrower_applicant_financials");
    rows.borrower_applicant_financials = financials.data ?? [];
  }
  const result = await sb
    .from("borrower_concierge_sessions")
    .select("confirmed_facts,updated_at")
    .eq("deal_id", session.deal_id)
    .maybeSingle();
  if (result.error) readErrors.push("answers");
  const form722 = await getForm722Status(session.deal_id, sb);
  // Reuse the same payload builder as the form renderer. Never invent agent
  // details or fee amounts, and never charge/create a fee during a status read.
  let form159: { complete: boolean } | undefined;
  if (rows.deal_loan_requests?.[0]?.agent_used === true) {
    const { buildForm159PayloadForDeal } = await import("@/lib/brokerage/compliancePackage");
    const payload = await buildForm159PayloadForDeal(session.deal_id, sb, null);
    form159 = { complete: payload.missing.length === 0 };
  }
  return {
    ...buildGuidedSnapshot({
      rows,
      facts: result.data?.confirmed_facts ?? {},
      revision: result.data?.updated_at ?? null,
      readErrors,
    }),
    form722,
    form159,
  };
}
export async function saveGuidedAnswer(
  sb: SB,
  session: Session,
  body: Record<string, any>,
) {
  const snapshot = await loadGuidedPackage(sb, session);
  if (snapshot.readErrors.length)
    throw new Error(
      "Some application information could not be loaded. Retry before saving.",
    );
  const question = snapshot.questions.find((q) => q.id === body.questionId);
  if (
    !question ||
    question.responsibility !== "borrower" ||
    question.state === "not_applicable"
  )
    throw new Error("This question is not available for borrower entry.");
  if (body.expectedValue !== question.value)
    throw new Error(
      "This answer changed in another session. Reload and review the saved answer.",
    );
  let value: any;
  if (question.id === "loan.use_of_proceeds") {
    if (
      !Array.isArray(body.value) ||
      !body.value.length ||
      body.value.length > 100
    )
      throw new Error("Add your financing purposes and amounts.");
    const categories = [
      "business_acquisition",
      "purchase_or_construction",
      "equipment",
      "working_capital",
      "inventory",
      "debt_refinance",
      "other",
    ];
    value = body.value.map((row: any) => {
      if (!categories.includes(row?.category))
        throw new Error("Choose a financing purpose.");
      const amount = parseAnswer(row.amount, "number");
      if (typeof amount !== "number" || amount < 0)
        throw new Error("Enter a nonnegative amount for every purpose.");
      return {
        category: row.category,
        amount,
        description: redactSsnPatterns(
          String(parseAnswer(row.description, "string") ?? ""),
        ),
      };
    });
  } else
    value = parseAnswer(
      body.value,
      question.field?.registryEntry.type ?? question.type,
    );
  if (question.id === "loan.sba_program" && value !== "7A" && value !== "504")
    throw new Error("Choose 7a or 504.");
  const entry = question.field?.registryEntry;
  const choices =
    DISCOVERY_CHOICES[question.id] ?? (entry && GUIDED_CHOICES[entry.factPath]);
  if (choices && value !== null && !choices.some(([key]) => key === value))
    throw new Error("Choose one of the listed answers.");
  if (question.field?.requiresExplicitConfirmation && body.confirmed !== true)
    throw new Error("Please explicitly confirm this answer.");
  if (question.field?.requiresPiiVault) {
    if (!question.ownerId || typeof value !== "string")
      throw new Error("Select an owner and enter the nine-digit number.");
    const result = await storeSecurePii({
      dealId: session.deal_id,
      bankId: session.bank_id,
      ownershipEntityId: question.ownerId,
      piiType: entry!.key as "full_ssn" | "spouse_full_ssn",
      plaintext: value,
      actorUserId: "borrower",
    });
    if (!result.ok)
      throw new Error("The protected number could not be saved. Please retry.");
    return loadGuidedPackage(sb, session);
  }
  if (typeof value === "string") value = redactSsnPatterns(value);
  const result = await sb.rpc("save_guided_package_answer", {
    p_deal_id: session.deal_id,
    p_bank_id: session.bank_id,
    p_question_id: question.id,
    p_owner_id: question.ownerId ?? null,
    p_table: entry?.sourceTable ?? null,
    p_column: entry?.sourceColumn ?? null,
    p_fact_path: entry?.factPath ?? null,
    p_value: value,
    p_expected: question.storedValue ?? question.value,
    p_source: body.source === "voice" ? "voice" : "text",
    p_character_key: question.field?.requiresExplicitConfirmation
      ? entry!.key
      : null,
  });
  if (result.error)
    throw new Error(
      "Your answer could not be saved, or it changed in another session. Reload and retry; your draft is still here.",
    );
  return loadGuidedPackage(sb, session);
}
export async function guidedSchedules(
  sb: SB,
  session: Session,
  body?: Record<string, any>,
) {
  const { PFS_SCHEDULES } = await import("./schedules");
  const ownerResult = await sb
    .from("ownership_entities")
    .select("id,display_name")
    .eq("deal_id", session.deal_id);
  if (ownerResult.error) throw new Error("Owners could not be loaded.");
  if (body) {
    const definition = PFS_SCHEDULES[body.kind as keyof typeof PFS_SCHEDULES];
    if (
      !definition ||
      !(ownerResult.data ?? []).some((o: any) => o.id === body.ownerId)
    )
      throw new Error("Select an owner in this application.");
    const values: Record<string, unknown> = {};
    for (const [key, type] of Object.entries(definition.fields)) {
      if (body.values && Object.hasOwn(body.values, key))
        values[key] = parseAnswer(body.values[key], type);
    }
    const result = await sb.rpc("save_guided_pfs_row", {
      p_deal_id: session.deal_id,
      p_bank_id: session.bank_id,
      p_owner_id: body.ownerId,
      p_table: definition.table,
      p_row_id: body.rowId ?? null,
      p_values: values,
      p_delete: body.remove === true,
    });
    if (result.error)
      throw new Error(
        "Schedule could not be saved. Check all values and retry.",
      );
  }
  const schedules: Record<string, unknown[]> = {};
  for (const [kind, definition] of Object.entries(PFS_SCHEDULES)) {
    const result = await sb
      .from(definition.table)
      .select("*")
      .eq("deal_id", session.deal_id)
      .order("created_at", { ascending: true });
    if (result.error) throw new Error("Schedule could not be loaded.");
    schedules[kind] = result.data ?? [];
  }
  return { owners: ownerResult.data ?? [], schedules };
}
