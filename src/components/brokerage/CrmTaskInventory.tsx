"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { CrmTaskControl } from "./CrmTaskControl";
import { useCrmWorkspace } from "./CrmWorkspaceFrame";

type Task = {
  id: string;
  title: string | null;
  due_at: string | null;
  completed_at: string | null;
  target_organization_id: string | null;
  target_person_id: string | null;
  target_lead_id: string | null;
  target_deal_id: string | null;
};
export function CrmTaskInventory() {
  const workspace = useCrmWorkspace();
  const [state, setState] = useState("open");
  const [page, setPage] = useState(0);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loadedKey, setLoadedKey] = useState("");
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const refresh = () => {
    setPage(0);
    setRevision((n) => n + 1);
    workspace?.refresh();
  };
  const requestKey = `${state}:${page}:${revision}:${workspace?.revision || 0}`;
  const loading = requestKey !== loadedKey;
  useEffect(() => {
    const controller = new AbortController();
    void fetch(
      `/api/admin/brokerage/crm/activities?state=${state}&page=${page}`,
      { signal: controller.signal },
    )
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error();
        if (!controller.signal.aborted) {
          setTasks(j.tasks);
          setTotal(j.total);
          setError("");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError("Task list unavailable. Refresh to try again.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadedKey(requestKey);
      });
    return () => controller.abort();
  }, [state, page, requestKey]);
  return (
    <section className="crm-task-inventory crm-surface">
      <header>
        <div>
          <p className="crm-eyebrow">CLOSE THE LOOP</p>
          <h2>Team commitments</h2>
          <p>
            All recorded CRM tasks, including older activity and tasks linked to
            people, leads, and deals.
          </p>
        </div>
        <button onClick={refresh} disabled={loading}>
          Refresh tasks
        </button>
      </header>
      <div className="crm-filter-bar" role="group" aria-label="Task state">
        {["open", "completed"].map((v) => (
          <button
            key={v}
            aria-pressed={state === v}
            onClick={() => {
              setState(v);
              setPage(0);
            }}
          >
            {v === "open" ? "Open tasks" : "Completed · reopen"}
          </button>
        ))}
        <span>
          {!loading && !error && total !== null
            ? `${total} ${state} tasks`
            : ""}
        </span>
      </div>
      {!loading && error ? (
        <p role="alert">{error}</p>
      ) : loading ? (
        <p role="status">Loading commitments…</p>
      ) : tasks.length ? (
        <div>
          {tasks.map((task) => (
            <article className="crm-inventory-row" key={task.id}>
              <div>
                <h3>{task.title || "Untitled task"}</h3>
                {task.target_deal_id ? (
                  <Link href={`/deals/${task.target_deal_id}`}>
                    Open linked deal ↗
                  </Link>
                ) : (
                  <button
                    className="crm-text-link"
                    onClick={() => {
                      const id =
                        task.target_organization_id ||
                        task.target_person_id ||
                        task.target_lead_id;
                      if (id)
                        workspace?.openRecord({
                          id,
                          name: "Task context",
                          kind: task.target_organization_id
                            ? "organization"
                            : task.target_person_id
                              ? "person"
                              : "lead",
                        });
                    }}
                  >
                    Open record context ↗
                  </button>
                )}
              </div>
              <CrmTaskControl
                id={task.id}
                dueAt={task.due_at}
                completed={Boolean(task.completed_at)}
                onSaved={refresh}
              />
            </article>
          ))}
        </div>
      ) : (
        <div className="crm-empty-card">
          <h3>
            {state === "open"
              ? "No open CRM tasks"
              : "No completed tasks on this page"}
          </h3>
          <p>
            Open any company, person, or lead and choose Set follow-up to create
            a commitment.
          </p>
        </div>
      )}
      <footer className="crm-pagination">
        <button
          disabled={loading || page === 0}
          onClick={() => setPage((p) => p - 1)}
        >
          Previous
        </button>
        <span>Page {page + 1} · 100 per page</span>
        <button
          disabled={
            loading ||
            !!error ||
            (total !== null ? (page + 1) * 100 >= total : tasks.length < 100)
          }
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </button>
      </footer>
    </section>
  );
}
