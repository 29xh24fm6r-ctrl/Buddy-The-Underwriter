// SPEC-13 — `/committee` was a separate renderer that duplicated
// `/committee-studio`. The journey rail and CreditMemoPanel both point
// at /committee-studio; redirecting here removes the dead-end fork
// without deleting `CommitteeView` (still imported elsewhere).
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function CommitteePage({
  params,
}: {
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;
  redirect(`/deals/${dealId}/committee-studio`);
}
