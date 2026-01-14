import { clerkAuth } from "@/lib/auth/clerkServer";
import UploadInboxCard from "@/components/deals/UploadInboxCard";

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
                <h1 className="text-xl font-semibold text-white">Documents</h1>
                <p className="mt-2 text-sm text-white/70">Please sign in to continue.</p>
            </div>
        );
    }

    if (!dealId || dealId === "undefined") {
        return (
            <div className="p-6">
                <h1 className="text-xl font-semibold text-white">Documents</h1>
                <p className="mt-2 text-sm text-white/70">Loading deal…</p>
            </div>
        );
    }

    return (
        <div className="p-6">
            <div className="mb-4">
                <h1 className="text-2xl font-semibold text-white">Document Inbox</h1>
                <p className="mt-1 text-sm text-white/70">
                    Assign uploads to borrower requests and generate missing requests.
                </p>
            </div>
            <UploadInboxCard dealId={dealId} />
        </div>
    );
}
