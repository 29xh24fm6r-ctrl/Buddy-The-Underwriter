// src/app/upload/[token]/page.tsx
import React from "react";
import UploadFormClient from "./UploadFormClient";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ token: string }>;
};

export default async function UploadLinkPage(props: PageProps) {
  const { token } = await props.params;

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-50">
      <div className="mx-auto max-w-2xl px-6 py-10">
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-6 shadow">
          <h1 className="text-2xl font-semibold">Upload Documents</h1>
          <p className="mt-2 text-sm text-neutral-300">
            Use this secure link to upload requested documents. Your uploads are
            encrypted and logged for audit.
          </p>

          <div className="mt-6">
            <UploadFormClient token={token} />
          </div>

          <div className="mt-6 rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
            <p className="text-xs text-neutral-400">
              Tip: If you have multiple files, you can select them all at once.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
