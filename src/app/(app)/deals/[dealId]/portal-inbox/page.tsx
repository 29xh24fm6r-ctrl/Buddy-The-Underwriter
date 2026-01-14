import { clerkAuth } from "@/lib/auth/clerkServer";
import DealPortalInboxClient from "./DealPortalInboxClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Page({
    params,
}: {
    params: Promise<{ dealId?: string }>;
}) {
    const { userId } = await clerkAuth();
    const { dealId } = await params;

    if (!userId) {
        return (
            <div className="p-6">
                <h1 className="text-xl font-semibold text-white">Portal</h1>
                <p className="mt-2 text-sm text-white/70">Please sign in to continue.</p>
            </div>
        );
    }

    if (!dealId || dealId === "undefined") {
        return (
            <div className="p-6">
                <h1 className="text-xl font-semibold text-white">Portal</h1>
                <p className="mt-2 text-sm text-white/70">Loading deal…</p>
            </div>
        );
    }

    return <DealPortalInboxClient dealId={dealId} bankerUserId={userId} />;
}
