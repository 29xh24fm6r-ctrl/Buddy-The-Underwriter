import Link from "next/link";

export default function SettingsPage() {
  const items = [
    {
      title: "Document Requirements",
      description: "Manage borrower upload requirements and doc packs.",
      href: "/banks/settings/documents",
    },
    {
      title: "Policy Ingestion",
      description: "Upload and index internal policy manuals.",
      href: "/banks/settings/policy-ingestion",
    },
    {
      title: "Policy Chunks",
      description: "Review extracted policy chunks and embeddings.",
      href: "/banks/settings/policy-chunks",
    },
  ];

  return (
    <div className="min-h-screen bg-[#0f1115] text-white">
      <header className="border-b border-white/10 bg-[#111418] px-6 py-4">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-sm text-white/60 mt-1">
            Configure bank-level policies and document requirements
          </p>
        </div>
      </header>

      <main className="p-6">
        <div className="grid gap-4 md:grid-cols-2">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-lg border border-white/10 bg-[#181b21] p-5 hover:bg-white/5 transition-colors"
            >
              <h2 className="text-lg font-semibold text-white">{item.title}</h2>
              <p className="mt-2 text-sm text-white/70">{item.description}</p>
              <div className="mt-4 text-sm font-semibold text-primary">Open →</div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
