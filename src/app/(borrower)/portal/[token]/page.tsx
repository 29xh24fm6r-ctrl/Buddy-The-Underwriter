import { PortalClient } from "@/components/borrower/PortalClient";

export default async function BorrowerPortalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <PortalClient token={token} />;
}
