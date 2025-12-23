type Table = {
  name: string;
  columns: string[];
  rows: Array<Array<string | number>>;
};

export type TableQuality = {
  score: number; // 0-100
  reasons: string[];
  metrics: {
    columnCount: number;
    rowCount: number;
    fillRatio: number;        // % of numeric cells filled (excluding label col)
    numericDensity: number;   // numeric cells / all cells (excluding label col)
    headerHasPeriods: boolean;
    periodCount: number;
    rowStrengthRatio: number; // % rows with >=2 numeric cells
  };
};

function isNumber(x: any) {
  return typeof x === "number" && !Number.isNaN(x);
}

function headerHasPeriods(cols: string[]) {
  const labels = cols.slice(1).map((c) => String(c).toUpperCase());
  const hasYear = labels.some((c) => /^FY20\d{2}$/.test(c) || /^20\d{2}$/.test(c));
  const hasTTM = labels.some((c) => c === "TTM" || c === "LTM");
  return hasYear || hasTTM;
}

export function scoreTableQuality(table: Table): TableQuality {
  const reasons: string[] = [];
  const columnCount = table.columns.length;
  const rowCount = table.rows.length;

  // Need at least 3 columns total (label + 2 periods)
  if (columnCount < 3) reasons.push("Too few columns (<3).");
  if (rowCount < 8) reasons.push("Too few rows (<8).");

  const periodCount = Math.max(0, columnCount - 1);
  const headerPeriods = headerHasPeriods(table.columns);
  if (!headerPeriods) reasons.push("Header does not clearly contain periods (FY/TTM).");

  // Compute fillRatio on numeric area (exclude label column)
  let numericCells = 0;
  let filledNumeric = 0;
  let totalCells = 0;
  let rowsStrong = 0;

  for (const r of table.rows) {
    let rowFilled = 0;
    for (let c = 1; c < columnCount; c++) {
      totalCells += 1;
      const v = r[c];
      if (isNumber(v)) {
        numericCells += 1;
        filledNumeric += 1;
        rowFilled += 1;
      } else if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
        // numeric-ish string
        numericCells += 1;
        filledNumeric += 1;
        rowFilled += 1;
      }
    }
    if (rowFilled >= 2) rowsStrong += 1;
  }

  const fillRatio = totalCells > 0 ? filledNumeric / totalCells : 0;
  const numericDensity = totalCells > 0 ? numericCells / totalCells : 0;
  const rowStrengthRatio = rowCount > 0 ? rowsStrong / rowCount : 0;

  if (fillRatio < 0.35) reasons.push("Low fill ratio (<35%) — sparse table.");
  if (rowStrengthRatio < 0.55) reasons.push("Many weak rows (<2 numeric values).");

  // Score composition (0-100)
  let score = 0;

  // Structure
  score += Math.min(20, (columnCount - 2) * 6); // 2 periods -> ~12, 4 periods -> ~24 (capped)
  score += Math.min(15, rowCount * 0.35);       // 40 rows -> 14

  // Period confidence
  score += headerPeriods ? 18 : 6;

  // Density / fill / row strength
  score += clamp01(fillRatio) * 25;
  score += clamp01(rowStrengthRatio) * 18;
  score += clamp01(numericDensity) * 4;

  score = Math.round(Math.max(0, Math.min(100, score)));

  return {
    score,
    reasons,
    metrics: {
      columnCount,
      rowCount,
      fillRatio: round2(fillRatio),
      numericDensity: round2(numericDensity),
      headerHasPeriods: headerPeriods,
      periodCount,
      rowStrengthRatio: round2(rowStrengthRatio),
    },
  };
}

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}
function round2(x: number) {
  return Math.round(x * 100) / 100;
}
