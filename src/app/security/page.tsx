export default function SecurityPage() {
  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-3xl font-semibold">Security</h1>
        <p className="mt-4 text-white/70 leading-7">
          Buddy is built for sensitive financial documents and examiner-grade workflows.
          This page can be expanded into a full security posture overview (RLS, encryption,
          audit ledger, signed uploads, retention, and incident response).
        </p>
      </div>
    </div>
  );
}
