import { supabaseAdmin } from "../supabase";

export async function runBuddyIncidentDetector() {
  const enabled = (process.env.BUDDY_INCIDENTS_ENABLED ?? "false") === "true";
  if (!enabled) return { enabled: false };

  const threshold = Number(process.env.BUDDY_INCIDENT_THRESHOLD ?? "10");
  const windowMin = Number(process.env.BUDDY_INCIDENT_WINDOW_MIN ?? "10");
  const cooldownMin = Number(process.env.BUDDY_INCIDENT_COOLDOWN_MIN ?? "60");

  const sinceIso = new Date(Date.now() - windowMin * 60_000).toISOString();
  const cooldownSinceIso = new Date(Date.now() - cooldownMin * 60_000).toISOString();

  const { data, error } = await supabaseAdmin
    .from("buddy_observer_events")
    .select("env,fingerprint,created_at")
    .gte("created_at", sinceIso)
    .in("severity", ["error", "fatal"])
    .limit(5000);

  if (error) return { enabled: true, error: error.message };

  const counts = new Map<
    string,
    { env: string; fingerprint: string; count: number; first: string; last: string }
  >();

  for (const ev of data ?? []) {
    const key = `${ev.env}::${ev.fingerprint}`;
    const cur = counts.get(key);
    if (!cur) {
      counts.set(key, { env: ev.env, fingerprint: ev.fingerprint, count: 1, first: ev.created_at, last: ev.created_at });
    } else {
      cur.count += 1;
      if (ev.created_at < cur.first) cur.first = ev.created_at;
      if (ev.created_at > cur.last) cur.last = ev.created_at;
    }
  }

  const candidates = [...counts.values()].filter((x) => x.count >= threshold);

  let created = 0;

  for (const c of candidates) {
    const { data: existing } = await supabaseAdmin
      .from("buddy_incidents")
      .select("id,last_notified_at,status")
      .eq("env", c.env)
      .eq("fingerprint", c.fingerprint)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const lastNotifiedAt = existing?.last_notified_at as string | null | undefined;
    const isOpen = (existing?.status ?? "open") === "open";
    const recentlyNotified = !!(lastNotifiedAt && lastNotifiedAt > cooldownSinceIso);

    if (isOpen && recentlyNotified) continue;

    const ins = await supabaseAdmin.from("buddy_incidents").insert({
      env: c.env,
      fingerprint: c.fingerprint,
      window_min: windowMin,
      threshold,
      count: c.count,
      first_seen_at: c.first,
      last_seen_at: c.last,
      status: "open",
      last_notified_at: new Date().toISOString(),
    });

    if (!ins.error) created += 1;
  }

  return { enabled: true, windowMin, threshold, created };
}
