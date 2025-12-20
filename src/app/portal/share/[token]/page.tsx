"use client";

import * as React from "react";

type ShareInfo = {
  ok: boolean;
  view?: {
    dealName: string;
    requestedItems: Array<{ id: string; title: string; description: string | null }>;
    note: string | null;
    recipientName: string | null;
    expiresAt: string;
  };
  error?: string;
};

export default function PortalSharePage({ params }: { params: Promise<{ token: string }> }) {
  const [token, setToken] = React.useState<string | null>(null);
  const [data, setData] = React.useState<ShareInfo | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    params.then((p) => setToken(p.token));
  }, [params]);

  async function load() {
    if (!token) return;
    setError(null);
    const res = await fetch(`/api/portal/share/view?token=${encodeURIComponent(token)}`, { method: "GET" });
    const json = await res.json();
    if (!json?.ok) {
      setError(json?.error ?? "Invalid link");
      return;
    }
    setData(json);
  }

  React.useEffect(() => {
    if (token) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (error) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <div className="rounded-2xl border bg-white p-5">
          <div className="text-lg font-semibold">This link isn't available</div>
          <div className="mt-2 text-sm text-gray-600">{error}</div>
        </div>
      </div>
    );
  }

  if (!data?.view) {
    return <div className="p-6 text-sm text-gray-600">Loading…</div>;
  }

  const v = data.view;

  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="rounded-2xl border bg-white p-5">
        <div className="text-xs text-gray-500">Secure upload link</div>
        <div className="mt-1 text-lg font-semibold">
          {v.recipientName ? `${v.recipientName},` : ""} please upload the requested document(s)
        </div>
        <div className="mt-2 text-sm text-gray-600">
          For: <span className="font-medium">{v.dealName}</span>
        </div>
        <div className="mt-1 text-xs text-gray-500">
          Link expires: {new Date(v.expiresAt).toLocaleString()}
        </div>

        {v.note ? (
          <div className="mt-4 rounded-xl border bg-gray-50 p-4 text-sm text-gray-800">
            <div className="text-xs font-semibold text-gray-600">Note</div>
            <div className="mt-1">{v.note}</div>
          </div>
        ) : null}

        <div className="mt-4">
          <div className="text-sm font-semibold">What to upload</div>
          <div className="mt-2 space-y-2">
            {v.requestedItems.map((it) => (
              <div key={it.id} className="rounded-xl border p-4">
                <div className="text-sm font-semibold">{it.title}</div>
                {it.description ? <div className="mt-1 text-sm text-gray-600">{it.description}</div> : null}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 rounded-xl border bg-gray-50 p-4">
          <div className="text-sm font-semibold">Upload</div>
          <div className="mt-1 text-sm text-gray-600">
            Drag & drop files here (or click). We'll confirm receipt immediately.
          </div>

          {token ? <ShareUploadBox token={token as string} /> : null}
        </div>
      </div>
    </div>
  );
}

function ShareUploadBox(props: { token: string }) {
  const [files, setFiles] = React.useState<File[]>([]);
  const [status, setStatus] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function uploadAll() {
    setError(null);
    setStatus(null);
    try {
      if (!files.length) return;

      // NOTE:
      // Wire this into your existing upload pipeline.
      // For now we call a share-aware attach endpoint that you will connect to your storage logic.
      for (const f of files) {
        setStatus(`Uploading ${f.name}…`);
        const res = await fetch(`/api/portal/share/upload`, {
          method: "POST",
          headers: { "x-share-token": props.token },
          body: await fileToFormData(f),
        });
        const json = await res.json();
        if (!json?.ok) throw new Error(json?.error ?? "Upload failed");
      }

      setStatus("✅ Received — thank you!");
      setFiles([]);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
      setStatus(null);
    }
  }

  return (
    <div className="mt-3">
      <input
        type="file"
        multiple
        onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
        className="text-sm"
      />

      <div className="mt-3 flex gap-2">
        <button
          className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          onClick={uploadAll}
          disabled={!files.length}
        >
          Upload
        </button>
      </div>

      {status ? <div className="mt-2 text-sm text-gray-700">{status}</div> : null}
      {error ? <div className="mt-2 text-sm text-red-700">{error}</div> : null}
    </div>
  );
}

async function fileToFormData(file: File) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("filename", file.name);
  return fd;
}
