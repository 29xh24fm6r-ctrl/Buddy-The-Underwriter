// src/app/evidence/inbox/page.tsx
import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";
import { tryGetCurrentBankId } from "@/lib/tenant/getCurrentBankId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function EvidenceInboxPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const pick = await tryGetCurrentBankId();
  if (!pick.ok) redirect("/deals");

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-3xl font-bold">Evidence Inbox</h1>
      <p className="text-muted-foreground mt-2">
        Review newly uploaded documents and evidence items.
      </p>

      <div className="mt-6 rounded-2xl border p-6">
        <div className="text-sm text-muted-foreground">
          Evidence inbox UI coming soon. This will show:
          <ul className="list-disc ml-6 mt-2">
            <li>Recent document uploads</li>
            <li>Pending OCR/classification tasks</li>
            <li>Items awaiting review</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
