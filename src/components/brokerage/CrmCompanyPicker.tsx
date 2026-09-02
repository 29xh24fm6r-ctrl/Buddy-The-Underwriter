"use client";
import { useEffect, useState } from "react";
export function CrmCompanyPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>(
    [],
  );
  const [q, setQ] = useState("");
  const [state, setState] = useState("loading");
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/admin/brokerage/crm/organizations", {
      signal: controller.signal,
    })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error();
        if (!controller.signal.aborted) {
          setCompanies(j.organizations || []);
          setState("ready");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setState("error");
      });
    return () => controller.abort();
  }, []);
  return (
    <div className="crm-company-picker">
      <label>
        Find a company
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by company name"
        />
      </label>
      <label>
        Company
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={state !== "ready"}
        >
          <option value="">
            {state === "loading"
              ? "Loading companies…"
              : state === "error"
                ? "Companies unavailable — reopen to retry"
                : "Choose a company"}
          </option>
          {companies
            .filter(
              (o) =>
                o.id === value ||
                o.name.toLowerCase().includes(q.toLowerCase()),
            )
            .map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
        </select>
      </label>
    </div>
  );
}
