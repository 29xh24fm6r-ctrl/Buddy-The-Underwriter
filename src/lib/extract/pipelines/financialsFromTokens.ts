// This is a placeholder for when coordinate extraction modules are implemented
// Currently returns empty results until pdfTextCoords, azureToCoords, and tableReconstruct exist

export function buildFinancialsTablesFromTokens(items: Array<{ str: string; page: number; x: number; y: number; w?: number; h?: number }>) {
  // NOT IMPLEMENTED: coordinate-based table reconstruction (groupIntoRowBands /
  // reconstructAndStitchMultiPageTables) was never built. This used to silently
  // return an empty { tables: [], evidence: [] } result, which looks like a
  // successful-but-empty extraction to any caller that doesn't check `items`
  // up front — a real risk of silent data loss if this is ever re-wired.
  // Confirmed dead in production (financialsHybrid.ts hardcodes pdfItems/ocrItems
  // to [] and its only caller, extractFinancialsLegacy, has zero callers itself).
  // Fail loud instead of fail silent if someone re-wires this with real items.
  if (items.length > 0) {
    throw new Error(
      "buildFinancialsTablesFromTokens: not implemented — coordinate extraction " +
        "(groupIntoRowBands/reconstructAndStitchMultiPageTables) does not exist yet. " +
        "Refusing to silently return an empty result for non-empty input.",
    );
  }

  // When ready, uncomment and use:
  // const bands = groupIntoRowBands(items as any, 2.2);
  // const stitched = reconstructAndStitchMultiPageTables({ bands });

  const tables: Array<{ name: string; columns: string[]; rows: Array<Array<string | number>> }> = [];
  const evidence: Array<any> = [];
  const periodsDetected: string[] = [];

  // TODO: Implement when coordinate extraction modules exist
  // const stitched = [] as any[];
  // const tables = stitched.map((t) => ({
  //   name: t.name,
  //   columns: t.columns,
  //   rows: t.rows,
  // }));
  //
  // const evidence = stitched.flatMap((t) =>
  //   t.rows.slice(0, 260).map((r, idx) => ({
  //     id: `EV_${t.kind}_${idx}`,
  //     page: t.rowEvidence[idx]?.page,
  //     table: t.name,
  //     field: String(r[0] ?? ""),
  //     excerpt: t.rowEvidence[idx]?.excerpt,
  //   }))
  // );
  //
  // const isTable = stitched.find((t) => t.kind === "IS") ?? stitched[0];
  // const periodsDetected = isTable ? isTable.columns.slice(1) : [];

  return { tables, evidence, periodsDetected };
}
