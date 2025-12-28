import { getDealSmsTimeline } from "@/lib/sms/getDealSmsTimeline";
import { SmsTimelineCard } from "@/components/timeline/SmsTimelineCard";

/**
 * Server component wrapper for SMS timeline
 * Fetches data server-side and renders client component
 */
export async function DealSmsTimeline({ dealId }: { dealId: string }) {
  try {
    const items = await getDealSmsTimeline(dealId);
    return <SmsTimelineCard items={items} />;
  } catch (error) {
    console.error("DealSmsTimeline error:", error);
    return null;
  }
}
