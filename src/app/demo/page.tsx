import Link from "next/link";
import { NavBar } from "@/components/NavBar";

export default function DemoPage() {
  return (
    <main>
      <NavBar />
      <section className="py-16 px-8 max-w-5xl mx-auto">
        <h1 className="text-3xl font-bold mb-4">Live Demo: What Buddy Feels Like</h1>
        <p className="text-gray-600 mb-8">
          This is a read-only walkthrough of the borrower + banker experience. No login required.
        </p>

        <div className="grid md:grid-cols-2 gap-6">
          <div className="border rounded-xl p-6">
            <h2 className="font-semibold mb-2">Borrower Journey</h2>
            <ul className="text-gray-700 space-y-2">
              <li>✓ Guided intake</li>
              <li>✓ Upload + auto-match documents</li>
              <li>✓ Clear next steps</li>
              <li>✓ "You're 92% E-Tran ready" progress</li>
            </ul>
          </div>

          <div className="border rounded-xl p-6">
            <h2 className="font-semibold mb-2">Banker Journey</h2>
            <ul className="text-gray-700 space-y-2">
              <li>✓ Deal cockpit</li>
              <li>✓ Pre-approval simulation</li>
              <li>✓ Examiner-safe timeline</li>
              <li>✓ Auto-generated package (no submission)</li>
            </ul>
          </div>
        </div>

        <div className="mt-10 flex gap-4">
          <Link href="/signup" className="px-6 py-3 rounded bg-black text-white">
            Start Free Trial
          </Link>
          <Link href="/pricing" className="px-6 py-3 rounded border">
            See Pricing
          </Link>
        </div>
      </section>
    </main>
  );
}
