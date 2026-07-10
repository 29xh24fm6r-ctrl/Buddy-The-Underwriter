import CommsAdminClient from "./CommsAdminClient";

export const dynamic = "force-dynamic";

/**
 * Wrapper restyled for the ink/brass nav rail (no more breadcrumb needed,
 * the rail handles navigation now). CommsAdminClient's internals are
 * still the original Tailwind styling — not yet ported, flagged as a
 * remaining item.
 */
export default function CommsAdminPage() {
  return (
    <div style={{ padding: "18px 24px 40px" }}>
      <CommsAdminClient />
    </div>
  );
}
