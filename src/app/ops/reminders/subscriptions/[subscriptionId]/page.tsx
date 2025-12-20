// src/app/ops/reminders/subscriptions/[subscriptionId]/page.tsx
import SubscriptionDetail from "@/components/ops/reminders/SubscriptionDetail";

export const dynamic = "force-dynamic";

export default async function SubscriptionPage({
  params,
}: {
  params: Promise<{ subscriptionId: string }>;
}) {
  const { subscriptionId } = await params;
  return <SubscriptionDetail subscriptionId={subscriptionId} />;
}
