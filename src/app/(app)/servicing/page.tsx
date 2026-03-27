import StitchSurface from "@/stitch/StitchSurface";

export const dynamic = "force-dynamic";

export default async function Page() {
  return (
    <StitchSurface
      surfaceKey="loan_servicing_command_center"
      title="Loan Servicing"
      mode="iframe"
    />
  );
}
