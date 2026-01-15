import StitchRouteBridge from "@/components/stitch/StitchRouteBridge";

export default async function Page({
  searchParams,
}: {
  searchParams?: { token?: string | string[] };
}) {
  const tokenParam = searchParams?.token;
  const token = Array.isArray(tokenParam) ? tokenParam[0] : tokenParam || null;

  return (
    <StitchRouteBridge
      slug="borrower-document-upload-review"
      activationContext={{ token }}
    />
  );
}
