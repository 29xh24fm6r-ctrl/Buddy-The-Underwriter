/**
 * Buddy Brokerage design tokens.
 *
 * Ported from the Claude Design prototype (Buddy_Brokerage_dc.html) —
 * exact hex values and the stamp() status-color mapping preserved as-is,
 * markup rebuilt as React/Tailwind-inline rather than the prototype's
 * template-string DSL.
 */

export const brokerageColors = {
  ink: "#0E1013",
  inkRail: "#101216",
  inkHeader: "#13151A",
  card: "#16181C",
  cardHover: "#1B1E23",
  border: "#24272D",
  borderStrong: "#2A2D33",
  borderStronger: "#3A3E45",
  divider: "#1C1F24",
  paper: "#E8E3D8",
  textSecondary: "#9A968C",
  textMuted: "#8A8578",
  textFaint: "#6E6B63",
  skeleton: "#20232A",
  brass: "#B8905B",
  brassBright: "#D4A868",
  brassOnBrass: "#181206",
  sage: "#7BAE92",
  brick: "#C77F73",
} as const;

export type StampStatus = string | null | undefined;

/**
 * Status -> color mapping used by every stamp/badge in the system.
 * Preserved exactly from the prototype's stamp() function.
 */
export function stampColor(status: StampStatus): {
  text: string;
  border: string;
  bg: string;
} {
  const s = (status ?? "").toLowerCase();
  if (["funded", "paid", "active (funded)"].includes(s)) {
    return { text: brokerageColors.sage, border: "rgba(90,138,110,.5)", bg: "rgba(90,138,110,.12)" };
  }
  if (["stuck", "overdue", "error"].includes(s)) {
    return { text: brokerageColors.brick, border: "rgba(168,93,82,.5)", bg: "rgba(168,93,82,.12)" };
  }
  if (["active", "finalized"].includes(s)) {
    return { text: brokerageColors.brassBright, border: "rgba(184,144,91,.5)", bg: "rgba(184,144,91,.12)" };
  }
  return { text: brokerageColors.textSecondary, border: "rgba(154,150,140,.35)", bg: "rgba(154,150,140,.07)" };
}

export function fmtMoney(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

export function fmtMoneyCompact(n: number): string {
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2).replace(/\.?0+$/, "") + "M";
  if (n >= 1_000) return "$" + Math.round(n / 1_000) + "k";
  return "$" + Math.round(n);
}
