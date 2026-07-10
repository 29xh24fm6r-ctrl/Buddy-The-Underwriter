import { stampColor, type StampStatus } from "./tokens";

/**
 * Refined stamp — brass-framed status mark for dense table rows.
 * Used in deals, lenders, CRM, billing, team lists.
 */
export function RefinedStamp({ status }: { status: StampStatus }) {
  const c = stampColor(status);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontFamily: "var(--font-brokerage-mono)",
        fontSize: 9,
        letterSpacing: 1.2,
        textTransform: "uppercase",
        color: c.text,
        border: `1px solid ${c.border}`,
        padding: "3px 7px",
        borderRadius: 2,
        background: c.bg,
        whiteSpace: "nowrap",
      }}
    >
      {status}
    </span>
  );
}

/**
 * Characterful stamp — the angled ink-stamp treatment for hero/detail
 * moments (deal file header, invoice header). The signature element of
 * the whole system.
 */
export function CharacterfulStamp({
  status,
  dateLabel,
}: {
  status: StampStatus;
  dateLabel?: string;
}) {
  const c = stampColor(status);
  return (
    <div style={{ flex: "none", transform: "rotate(-5deg)", paddingTop: 6 }}>
      <div
        style={{
          border: `2.5px solid ${c.text}`,
          color: c.text,
          borderRadius: 7,
          padding: "8px 16px 7px",
          textAlign: "center",
          position: "relative",
          boxShadow: `0 0 0 1px ${c.text} inset`,
          opacity: 0.92,
        }}
      >
        <div style={{ fontFamily: "var(--font-brokerage-mono)", fontSize: 8, letterSpacing: 2, opacity: 0.7 }}>
          BUDDY · SBA
        </div>
        <div
          style={{
            fontFamily: "var(--font-brokerage-display)",
            fontWeight: 700,
            fontSize: 20,
            letterSpacing: 2,
            textTransform: "uppercase",
            lineHeight: 1,
          }}
        >
          {status}
        </div>
        {dateLabel && (
          <div style={{ fontFamily: "var(--font-brokerage-mono)", fontSize: 8, letterSpacing: 1, opacity: 0.7, marginTop: 2 }}>
            {dateLabel}
          </div>
        )}
      </div>
    </div>
  );
}
