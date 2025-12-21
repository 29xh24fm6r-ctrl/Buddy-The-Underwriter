// src/app/deals/[dealId]/page.tsx
import DealWorkspaceClient from "./DealWorkspaceClient";
import { DealEvidenceDeepLinkHandler } from "@/components/evidence/DealEvidenceDeepLinkHandler";

export const dynamic = "force-dynamic";

export default async function DealPage({
  params,
  searchParams,
}: {
  params: Promise<{ dealId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { dealId } = await params;
  const searchParamsResolved = searchParams ? await searchParams : {};
  const dealNameRaw = searchParamsResolved?.name;

  const dealName =
    typeof dealNameRaw === "string"
      ? dealNameRaw
      : Array.isArray(dealNameRaw)
      ? dealNameRaw[0] ?? "Untitled Deal"
      : "Untitled Deal";

  if (!dealId) {
    return (
      <main className="min-h-screen p-10">
        <div className="mx-auto max-w-6xl text-red-600">
          Missing dealId — route params not found.
        </div>
      </main>
    );
  }

  return (
    <>
      <DealEvidenceDeepLinkHandler dealId={dealId} />
      <DealWorkspaceClient dealId={dealId} dealName={dealName} />
    </>
  );
}
