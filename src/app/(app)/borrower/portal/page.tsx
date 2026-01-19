import StitchSurface from "@/stitch/StitchSurface";

export default async function Page({
  searchParams,
}: {
  searchParams?: { token?: string | string[] };
}) {
  const tokenParam = searchParams?.token;
  const token = Array.isArray(tokenParam) ? tokenParam[0] : tokenParam || null;

  return (
    <StitchSurface
      surfaceKey="borrower_portal"
      activationToken={token}
      title="Borrower Portal"
      mode="iframe"
    />
  );
}
