import CommsAdminClient from "./CommsAdminClient";

export const dynamic = "force-dynamic";

export default function CommsAdminPage() {
  return (
    <main className="px-8 py-10 max-w-6xl mx-auto">
      <header className="mb-8">
        <nav className="text-sm text-neutral-400 mb-2">
          <a href="/admin/brokerage" className="hover:text-neutral-200">Brokerage ops</a>
          <span className="mx-2">/</span>
          <span className="text-neutral-200">Communications</span>
        </nav>
        <h1 className="text-2xl font-semibold">Brokerage Communications</h1>
        <p className="text-sm text-neutral-400 mt-1">
          Manage borrower nudges, banker alerts, and outbox processing.
        </p>
      </header>
      <CommsAdminClient />
    </main>
  );
}
