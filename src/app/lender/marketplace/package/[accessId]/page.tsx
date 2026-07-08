import { LenderPackageClient } from "./LenderPackageClient";

export const dynamic = "force-dynamic";

export default async function LenderPackagePage({
  params,
}: {
  params: Promise<{ accessId: string }>;
}) {
  const { accessId } = await params;
  return <LenderPackageClient accessId={accessId} />;
}
