import StitchSurface from "@/stitch/StitchSurface";

export const dynamic = "force-dynamic";

export default async function Page() {
  return (
    <StitchSurface
      surfaceKey="audit_compliance_ledger"
      title="Audit Compliance Ledger"
      mode="iframe"
    />
  );
}
