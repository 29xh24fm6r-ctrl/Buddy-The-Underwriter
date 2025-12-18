// src/app/deals/[dealId]/page.tsx
import DealWorkspaceClient from "./DealWorkspaceClient";

export const dynamic = "force-dynamic";

export default function DealPage({
  params,
  searchParams,
}: {
  params: { dealId: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const dealId = params?.dealId ?? "";
  const dealNameRaw = searchParams?.name;

  const dealName =
    typeof dealNameRaw === "string"
      ? dealNameRaw
      : Array.isArray(dealNameRaw)
      ? dealNameRaw[0] ?? "Untitled Deal"
      : "Untitled Deal";

  return <DealWorkspaceClient dealId={dealId} dealName={dealName} />;
}
