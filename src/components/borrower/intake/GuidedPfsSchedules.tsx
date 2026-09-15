"use client";
import { useCallback, useEffect, useState } from "react";
import {
  PFS_SCHEDULES,
  type ScheduleKind,
} from "@/lib/borrower/guidedPackage/schedules";
export function GuidedPfsSchedules({ dealId }: { dealId: string }) {
  const [owners, setOwners] = useState<
    Array<{
      id: string;
      display_name: string;
    }>
  >([]);
  const [rows, setRows] = useState<Record<string, Array<Record<string, any>>>>(
    {},
  );
  const [ownerId, setOwnerId] = useState("");
  const [kind, setKind] = useState<ScheduleKind>("notes");
  const [rowId, setRowId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const apply = (data: any) => {
    setRows(data.schedules);
    setOwners(data.owners);
    setOwnerId((v) => v || data.owners[0]?.id || "");
  };
  const load = useCallback(async () => {
    try {
      const r = await fetch(
        `/api/brokerage/concierge?dealId=${dealId}&view=schedules`,
        { cache: "no-store" },
      );
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error("Schedules could not be loaded.");
      apply(data);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load.");
    }
  }, [dealId]);
  useEffect(() => {
    void load();
  }, [load]);
  const definition = PFS_SCHEDULES[kind];
  const save = async (remove = false) => {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/brokerage/concierge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "guided_schedule",
          dealId,
          ownerId,
          kind,
          rowId,
          values,
          remove,
        }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || "Unable to save.");
      apply(data);
      setValues({});
      setRowId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="rounded-2xl border bg-white p-5">
      <h3 className="text-lg font-semibold">Personal financial schedules</h3>
      <p className="mt-1 text-sm text-slate-600">
        List each debt, investment and property. Additional rows are included on
        continuation pages with Form 413.
      </p>
      {error && (
        <p role="alert" className="my-3 rounded-lg bg-amber-50 p-3 text-sm">
          {error}{" "}
          <button
            type="button"
            onClick={() => void load()}
            className="underline"
          >
            Reload
          </button>
        </p>
      )}
      <div className="my-4 flex flex-wrap gap-3">
        <label className="text-sm">
          Owner
          <select
            className="ml-2 rounded-lg border p-2"
            value={ownerId}
            onChange={(e) => {
              setOwnerId(e.target.value);
              setValues({});
              setRowId(null);
            }}
          >
            {owners.map((o) => (
              <option value={o.id} key={o.id}>
                {o.display_name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Schedule
          <select
            className="ml-2 rounded-lg border p-2"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as ScheduleKind);
              setValues({});
              setRowId(null);
            }}
          >
            {Object.entries(PFS_SCHEDULES).map(([k, d]) => (
              <option key={k} value={k}>
                {d.title}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mb-4 space-y-2">
        {(rows[kind] ?? [])
          .filter((r) => r.applicant_id === ownerId)
          .map((r) => (
            <button
              className="block w-full rounded-lg border p-3 text-left text-sm hover:bg-sky-50"
              key={r.id}
              type="button"
              onClick={() => {
                setRowId(r.id);
                setValues(
                  Object.fromEntries(
                    Object.keys(definition.fields).map((k) => [
                      k,
                      r[k] == null ? "" : String(r[k]),
                    ]),
                  ),
                );
              }}
            >
              {r.noteholder_name_address ||
                r.name_of_securities ||
                r.address ||
                r.property_label ||
                "Saved row"}{" "}
              · Edit
            </button>
          ))}
      </div>
      <h4 className="mb-3 text-sm font-semibold">
        {rowId ? "Edit saved row" : "Add a row"}
      </h4>
      <div className="grid gap-3 sm:grid-cols-2">
        {Object.entries(definition.fields).map(([key, type]) => (
          <label key={key} className="text-sm capitalize">
            {key.replaceAll("_", " ")}
            <input
              className="mt-1 block w-full rounded-lg border p-2"
              type={
                type === "date" ? "date" : type === "number" ? "number" : "text"
              }
              step="any"
              value={values[key] ?? ""}
              onChange={(e) =>
                setValues((v) => ({ ...v, [key]: e.target.value }))
              }
            />
          </label>
        ))}
      </div>
      <div className="mt-4 flex gap-3">
        <button
          type="button"
          disabled={
            busy || !ownerId || !Object.values(values).some((v) => v.trim())
          }
          onClick={() => void save()}
          className="rounded-lg bg-sky-700 px-4 py-2 text-sm text-white disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save row"}
        </button>
        {rowId && (
          <>
            <button
              className="rounded-lg border px-4 py-2 text-sm"
              type="button"
              onClick={() => {
                setRowId(null);
                setValues({});
              }}
            >
              Add another
            </button>
            <button
              type="button"
              disabled={busy}
              className="rounded-lg border px-4 py-2 text-sm"
              onClick={() => void save(true)}
            >
              Remove this row
            </button>
          </>
        )}
      </div>
    </section>
  );
}
