/** Shared lifecycle boundary for every financial fact consumer. Pure, no I/O. */
export type FactLifecycle = {
  is_superseded?: boolean | null;
  resolution_status?: string | null;
  fact_value_num?: number | null;
};

export function factExclusionReason(fact: FactLifecycle): string | null {
  const status = (fact.resolution_status ?? "").trim().toLowerCase();
  if (fact.is_superseded === true || status === "superseded") {
    return "superseded fact — never selectable";
  }
  if (status === "rejected" || status === "system_invalidated") {
    return `resolution_status=${status} — never selectable`;
  }
  if (typeof fact.fact_value_num !== "number" || !Number.isFinite(fact.fact_value_num)) {
    return "missing or non-finite value — nothing to certify";
  }
  return null;
}

export function isSelectableNumericFact<T extends FactLifecycle>(fact: T): boolean {
  return factExclusionReason(fact) === null;
}

/** A sentinel does not establish an entity identity. Do not merge it into a named entity. */
export function factEntityId(id: string | null | undefined): string | null {
  return !id || id === "00000000-0000-0000-0000-000000000000" ? null : id;
}
