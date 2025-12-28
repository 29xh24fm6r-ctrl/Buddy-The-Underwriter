"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";

export default function AttestPage() {
  const router = useRouter();
  const params = useParams<{ dealId: string; snapshotId: string }>();
  const [role, setRole] = useState("");
  const [statement, setStatement] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const res = await fetch(`/api/deals/${params.dealId}/decision/${params.snapshotId}/attest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, statement }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to attest decision");
      }

      // Success - redirect back to decision page
      router.push(`/deals/${params.dealId}/decision?snapshot=${params.snapshotId}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Attest Decision</h1>
        <p className="text-gray-600 mt-2">
          By attesting this decision, you are certifying that you have reviewed the evidence, policy,
          and decision logic, and that you affirm the decision is sound and audit-ready.
        </p>
      </div>

      <div className="bg-amber-50 border-l-4 border-amber-500 p-4 mb-6">
        <h3 className="font-semibold text-amber-900">Chain of Custody</h3>
        <p className="text-sm text-amber-800 mt-1">
          This attestation creates a cryptographically signed record linking you to this decision.
          It cannot be edited or deleted once created.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-6">
          <p className="text-red-800">{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-semibold mb-2">Your Role</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-full border rounded-lg px-3 py-2"
            required
          >
            <option value="">Select your role...</option>
            <option value="underwriter">Underwriter</option>
            <option value="credit_chair">Credit Committee Chair</option>
            <option value="risk_officer">Risk Officer</option>
            <option value="cro">Chief Risk Officer</option>
            <option value="other">Other</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-semibold mb-2">Attestation Statement</label>
          <textarea
            value={statement}
            onChange={(e) => setStatement(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 h-32"
            placeholder="I have reviewed this underwriting decision and affirm that..."
            required
          />
          <p className="text-xs text-gray-500 mt-1">
            This statement will be permanently recorded and included in audit logs.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-xl border px-5 py-3 text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? "Attesting..." : "Attest Decision"}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-xl border px-5 py-3 text-sm hover:bg-gray-100"
          >
            Cancel
          </button>
        </div>
      </form>

      <div className="mt-8 border-t pt-6">
        <h3 className="text-sm font-semibold mb-3">What happens when you attest?</h3>
        <ul className="space-y-2 text-sm text-gray-700">
          <li className="flex items-start gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-blue-500 mt-1.5" />
            <span>A cryptographic hash of the decision snapshot is computed and stored</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-blue-500 mt-1.5" />
            <span>Your user ID, role, and statement are permanently recorded</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-blue-500 mt-1.5" />
            <span>An audit event is written to the deal timeline</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-blue-500 mt-1.5" />
            <span>Regulators and auditors can verify the integrity of this attestation</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
