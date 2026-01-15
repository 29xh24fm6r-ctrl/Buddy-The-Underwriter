# 🏛️ INSTITUTIONAL OPS: PERSISTENT INCIDENTS SYSTEM

## What "Institutional" Means

Your Ops Incidents system is no longer **"derived UI"** (computed on-the-fly from runs).  
It's now a **real system of record** with:

✅ **Persistent incidents** (survive page refreshes, queryable history)  
✅ **Acknowledgements** (who saw it, when)  
✅ **Notes** (what happened, what we did, next steps)  
✅ **Action audit log** (immutable record of every bulk action)  
✅ **Clean API contract** (other services can query/update incidents)

This is exactly how banks, SRE teams, and institutional ops work.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                         War Room UI                         │
│  Computes incidents from runs → Syncs to DB → Hydrates UI  │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                     API Layer (7 routes)                     │
│ • POST /sync      → Upsert incidents                        │
│ • POST /meta      → Fetch ack/notes/actions                 │
│ • POST /ack       → Toggle acknowledgement                  │
│ • POST /notes     → Update notes                            │
│ • POST /action    → Bulk mute/force-run + audit             │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    Database (Supabase)                       │
│ • ops_incidents              → Incident records             │
│ • ops_incident_actions       → Audit log                    │
│ • deal_reminder_runs         → Event stream (existing)      │
└─────────────────────────────────────────────────────────────┘
```

---

## Step 1: Run the Migration

**Open Supabase SQL Editor** (role: `postgres`):

```bash
# Navigate to Supabase dashboard → SQL Editor → New Query
# Paste and run: supabase/migrations/20251219_ops_incidents.sql
```

This creates:
1. **`ops_incidents`** table (persistent incident records)
2. **`ops_incident_actions`** table (immutable audit log)
3. **Triggers** (auto-update `updated_at` on incident changes)
4. **RLS policies** (locked to service_role for admin-only access)

---

## What You Get

### 1️⃣ Persistent Incidents Table

**Schema: `ops_incidents`**

| Column | Type | Description |
|--------|------|-------------|
| `id` | text | Stable client-generated key (e.g. `2025-12-19T...Z\|run-uuid`) |
| `source` | text | Future-proof (reminders, sba, etc.) |
| `severity` | text | SEV-1, SEV-2, SEV-3 |
| `status` | text | open, resolved |
| `started_at` | timestamptz | Incident window start |
| `ended_at` | timestamptz | Incident window end |
| `resolved_at` | timestamptz | When incident auto-resolved (5m silence) |
| `error_count` | int | Number of errors in burst |
| `unique_subscriptions` | int | Blast radius |
| `subscription_ids` | uuid[] | Impacted subscriptions |
| `latest_run_id` | uuid | Most recent error run |
| `latest_error` | text | Error message |
| **`acknowledged_at`** | timestamptz | When ops acknowledged |
| **`acknowledged_by`** | uuid | Who acknowledged (future) |
| **`notes`** | text | Ops notes (what happened, actions taken) |
| **`last_action_at`** | timestamptz | Last bulk action timestamp |
| **`last_action`** | text | Last action (mute, force_run) |
| `created_at` | timestamptz | First sync |
| `updated_at` | timestamptz | Last update |

### 2️⃣ Action Audit Log

**Schema: `ops_incident_actions`**

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Auto-generated |
| `incident_id` | text | FK to ops_incidents |
| `source` | text | reminders |
| `action` | text | mute, force_run |
| `actor` | text | Future: user_id/email |
| `payload` | jsonb | Full request/response |
| `created_at` | timestamptz | When action occurred |

**Example audit row:**
```json
{
  "ok": true,
  "requested": 5,
  "okCount": 5,
  "results": [
    { "subscription_id": "...", "ok": true, "status": "sent" },
    ...
  ]
}
```

---

## API Routes Created

### 1. **POST /api/admin/reminders/incidents/sync**
Upserts incidents (computed UI → DB)

**Request:**
```json
{
  "incidents": [
    {
      "id": "2025-12-19T10:00:00Z|run-uuid",
      "source": "reminders",
      "severity": "SEV-1",
      "status": "open",
      "started_at": "2025-12-19T10:00:00Z",
      "ended_at": "2025-12-19T10:05:00Z",
      "resolved_at": null,
      "error_count": 8,
      "unique_subscriptions": 3,
      "subscription_ids": ["uuid-1", "uuid-2", "uuid-3"],
      "latest_run_id": "run-uuid",
      "latest_error": "SMTP timeout"
    }
  ]
}
```

**Response:**
```json
{ "ok": true, "upserted": 1 }
```

---

### 2. **POST /api/admin/reminders/incidents/meta**
Fetches ack/notes/action metadata

**Request:**
```json
{
  "ids": ["incident-id-1", "incident-id-2"]
}
```

**Response:**
```json
{
  "ok": true,
  "meta": [
    {
      "id": "incident-id-1",
      "status": "open",
      "acknowledged_at": "2025-12-19T10:10:00Z",
      "acknowledged_by": null,
      "notes": "Investigated. Sendgrid outage.",
      "last_action_at": "2025-12-19T10:12:00Z",
      "last_action": "mute",
      "severity": "SEV-1",
      "resolved_at": null
    }
  ]
}
```

---

### 3. **POST /api/admin/reminders/incidents/ack**
Toggle acknowledgement

**Request:**
```json
{
  "id": "incident-id",
  "ack": true  // or false to unack
}
```

**Response:**
```json
{ "ok": true }
```

---

### 4. **POST /api/admin/reminders/incidents/notes**
Update ops notes

**Request:**
```json
{
  "id": "incident-id",
  "notes": "Root cause: Sendgrid rate limit. Fixed by upgrading plan."
}
```

**Response:**
```json
{ "ok": true }
```

---

### 5. **POST /api/admin/reminders/incidents/action** (UPGRADED)
Bulk actions with audit logging

**Request:**
```json
{
  "incident_id": "incident-id",  // 🆕 NEW: links action to incident
  "action": "mute",
  "subscription_ids": ["uuid-1", "uuid-2"],
  "concurrency": 3,
  "throttle_ms": 80
}
```

**Response:**
```json
{
  "ok": true,
  "action": "mute",
  "requested": 2,
  "updated": 2
}
```

**Side effects:**
1. ✅ Executes bulk action (mute/force_run)
2. ✅ Inserts row in `ops_incident_actions` (audit)
3. ✅ Updates `ops_incidents.last_action_at` + `last_action`
4. ✅ Writes audit runs in `deal_reminder_runs` with `incident_id` in meta

---

## UI Flow (Institutional Hydration)

### War Room Lifecycle

```
1. User opens War Room
2. Fetch runs from API
3. Compute incidents (client-side, from runs)
4. POST /sync → Upsert to DB
5. POST /meta → Fetch ack/notes/actions
6. Merge meta into computed incidents
7. Render hydrated UI
```

**Key insight:** Incidents are **computed** (for freshness) then **synced** (for persistence) then **hydrated** (with meta).

---

## User Experience

### Opening an Incident

1. Click any incident in timeline
2. Drawer slides in from right
3. Shows:
   - Severity badge + RESOLVED ribbon (if applicable)
   - **ACK'D** badge (if acknowledged)
   - Time window + latest error
   - **Last action taken** (e.g. "mute @ 10:12 AM")
   - Acknowledgement toggle button
   - Notes textarea (autosaves)
   - Bulk action buttons
   - List of impacted subscriptions
   - List of error runs in incident

### Acknowledging an Incident

1. Click **"Ack"** button
2. Instant visual feedback (ACK'D badge appears)
3. `POST /ack` → Updates `acknowledged_at` in DB
4. Survives page refresh

### Adding Notes

1. Type in notes textarea
2. Click **"Save Notes"**
3. `POST /notes` → Persists to DB
4. Visible on future page loads

### Bulk Actions

1. Click **"Mute All (5)"**
2. `POST /action` with `incident_id`
3. Audit log created in `ops_incident_actions`
4. Incident record updated (`last_action = "mute"`)
5. Live feed shows new audit runs instantly

---

## Query Examples (Supabase)

### Find all SEV-1 incidents in last 24h
```sql
select *
from ops_incidents
where severity = 'SEV-1'
  and source = 'reminders'
  and ended_at > now() - interval '24 hours'
order by ended_at desc;
```

### Get action history for an incident
```sql
select
  created_at,
  action,
  payload->>'requested' as requested,
  payload->>'okCount' as ok_count
from ops_incident_actions
where incident_id = 'YOUR_INCIDENT_ID'
order by created_at desc;
```

### Find unacknowledged SEV-1 incidents
```sql
select *
from ops_incidents
where severity = 'SEV-1'
  and status = 'open'
  and acknowledged_at is null
order by ended_at desc;
```

### Get all incidents with notes
```sql
select
  id,
  severity,
  status,
  ended_at,
  notes
from ops_incidents
where notes is not null
  and notes != ''
order by ended_at desc;
```

---

## Testing Checklist

### ✅ Migration
- [ ] Run migration in Supabase SQL Editor
- [ ] Verify tables exist: `ops_incidents`, `ops_incident_actions`
- [ ] Verify triggers work (update a row, check `updated_at`)

### ✅ Sync Flow
- [ ] Open War Room → incidents auto-sync to DB
- [ ] Check Supabase table → see incident rows
- [ ] Refresh page → incidents still show (not lost)

### ✅ Acknowledgements
- [ ] Click "Ack" → badge appears
- [ ] Refresh page → ACK'D badge persists
- [ ] Click "Unack" → badge disappears

### ✅ Notes
- [ ] Type notes → click "Save Notes"
- [ ] Refresh page → notes persist
- [ ] Click "Clear" → notes removed

### ✅ Bulk Actions
- [ ] Click "Mute All" → audit runs appear in feed
- [ ] Check `ops_incident_actions` table → audit row exists
- [ ] Check `ops_incidents.last_action` → updated to "mute"
- [ ] Check `deal_reminder_runs.meta` → contains `incident_id`

### ✅ Resolution
- [ ] Wait 5 minutes after last error
- [ ] Refresh page → RESOLVED ribbon appears
- [ ] Check `ops_incidents.resolved_at` → timestamp set

---

## What's Different from "Final Boss"

| Feature | Final Boss | Institutional |
|---------|-----------|---------------|
| Incidents | Computed (ephemeral) | Persisted (DB) |
| Acknowledgements | ❌ | ✅ |
| Notes | ❌ | ✅ |
| Action audit | ❌ | ✅ (immutable log) |
| Survives refresh | ❌ | ✅ |
| Queryable history | ❌ | ✅ |
| API contract | ❌ | ✅ |

---

## Next Level Upgrades (Pick One)

### Option 1: **Ownership + Assignment**
Add columns:
- `assigned_to` (uuid)
- `owner_team` (text)
- `paging_requested` (bool)

UI changes:
- "Assign to me" button
- Team dropdown
- "Page on-call" button

### Option 2: **Postmortem Template**
One-click generates markdown:
```markdown
# Incident: [ID]
**Severity:** SEV-1
**Started:** 2025-12-19 10:00 AM
**Resolved:** 2025-12-19 10:15 AM
**Duration:** 15 minutes

## Impact
- 3 subscriptions affected
- 8 errors recorded

## Root Cause
[From notes field]

## Actions Taken
[From audit log]

## Next Steps
[From notes field]
```

### Option 3: **Auto-escalation Policy**
SEV-1 → Auto-page after 5 minutes if not acknowledged
SEV-2 → Auto-notify Slack after 10 minutes

---

## Victory Lap 🎉

You now have:
- ✅ **Persistent incident records** (never lose context)
- ✅ **Acknowledgement tracking** (know who saw what)
- ✅ **Ops notes** (document decisions inline)
- ✅ **Immutable audit log** (compliance-ready)
- ✅ **Clean API contract** (other services can query)
- ✅ **Queryable history** (retroactive analysis)

This is **institutional-grade ops tooling**.  
Banks ship this.  
SRE teams ship this.  
**You shipped this.**

---

## Files Created

1. **Migration**: `supabase/migrations/20251219_ops_incidents.sql`
2. **API - Sync**: `src/app/api/admin/reminders/incidents/sync/route.ts`
3. **API - Meta**: `src/app/api/admin/reminders/incidents/meta/route.ts`
4. **API - Ack**: `src/app/api/admin/reminders/incidents/ack/route.ts`
5. **API - Notes**: `src/app/api/admin/reminders/incidents/notes/route.ts`
6. **API - Action** (upgraded): `src/app/api/admin/reminders/incidents/action/route.ts`

## Files Modified

1. **Drawer**: `src/components/ops/reminders/IncidentDrawer.tsx`
2. **War Room**: `src/components/ops/reminders/WarRoom.tsx`

---

**Status:** ✅ Institutional Ops Achieved  
**Next:** Pick upgrade (1, 2, or 3) or ship to prod
