// src/app/deals/[dealId]/page.tsx
"use client";

import UploadBox from "@/components/deals/UploadBox";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";

export default function DealWorkspace() {
  const params = useParams<{ dealId: string }>();
  const searchParams = useSearchParams();

  const dealId = params?.dealId || "";
  const dealName = searchParams.get("name") || "Untitled Deal";

  return (
    <main className="min-h-screen p-10">
      <div className="mx-auto max-w-6xl space-y-8">
        <header className="space-y-2">
          <Link href="/deals" className="text-sm text-gray-600 hover:underline">
            ← Back to Deals
          </Link>

          <h1 className="text-3xl font-bold">{dealName}</h1>
          <p className="text-sm text-gray-500">Deal ID: {dealId || "(missing)"}</p>
        </header>

        <section>
          {dealId ? (
            <UploadBox dealId={dealId} />
          ) : (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
              Missing dealId — route params not found.
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
