// Offline component harness: all API calls are intercepted, no real credentials or customer data.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { Location } from "./navigation";
import { CrmExperienceProvider } from "../../src/components/brokerage/CrmExperienceProvider";
import Home from "../../src/app/admin/brokerage/crm/page";
import Leads from "../../src/app/admin/brokerage/crm/leads/page";
import People from "../../src/app/admin/brokerage/crm/people/page";
import "../../src/app/admin/brokerage/crm/experience.css";
import "../../src/app/admin/brokerage/crm/unified.css";

const orgId = "11111111-1111-1111-1111-111111111111",
  personId = "22222222-2222-2222-2222-222222222222",
  leadId = "33333333-3333-3333-3333-333333333333",
  taskId = "44444444-4444-4444-4444-444444444444";
const companies = [
  {
    id: orgId,
    name: "Example Advisory",
    organization_type: "referral_source",
    city: "Atlanta",
    state: "GA",
    peopleCount: 2,
    health: "cooling",
    dealsReferredCount: 3,
    dealsReferredValue: 1750000,
    lastActivityAt: "2026-08-10T12:00:00Z",
    owner_clerk_user_id: "test-owner",
    tags: ["Referral partner"],
  },
  {
    id: "55555555-5555-5555-5555-555555555555",
    name: "Example Community Bank",
    organization_type: "lender",
    city: "Charlotte",
    state: "NC",
    peopleCount: 1,
    health: "active",
    dealsReferredCount: 0,
    dealsReferredValue: 0,
    lastActivityAt: "2026-09-01T12:00:00Z",
    tags: [],
  },
];
const person = {
  id: personId,
  first_name: "Alex",
  last_name: "Example",
  email: "alex@example.invalid",
  job_title: "Partner",
  contact_status: "active",
};
const leads: any[] = [
  {
    id: leadId,
    business_name: "Example Manufacturing",
    email: "borrower@example.invalid",
    status: "contacted",
    priority: "high",
    loan_amount_requested: 750000,
    next_action: "Schedule discovery call",
    next_action_due_at: "2026-09-04T12:00:00Z",
    owner_clerk_user_id: "test-owner",
  },
];
const activities: any[] = [
  {
    id: taskId,
    title: "Discuss the referral",
    kind: "task",
    due_at: "2026-09-01T12:00:00Z",
    happens_at: "2026-08-30T12:00:00Z",
    completed_at: null,
    target_organization_id: orgId,
    properties: { body: "Fictional test activity." },
  },
];
let failNextSave = false;
(window as any).crmFixture = {
  failNextSave() {
    failNextSave = true;
  },
  activities,
  leads,
};
window.fetch = async (input, init) => {
  const url = new URL(String(input), "https://fixture.invalid");
  const method = init?.method || "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  const path = url.pathname;
  if (method !== "GET" && failNextSave) {
    failNextSave = false;
    return Response.json({ ok: false }, { status: 500 });
  }
  if (path.endsWith("/activities")) {
    if (method === "PATCH") {
      const a = activities.find((a) => a.id === body.id);
      if (!a) return Response.json({ ok: false }, { status: 404 });
      if (body.action === "reschedule") a.due_at = body.dueAt;
      else
        a.completed_at =
          body.action === "complete" ? new Date().toISOString() : null;
      return Response.json({ ok: true, activity: a });
    }
    if (method === "POST") {
      const a = {
        id: crypto.randomUUID(),
        title: body.title,
        kind: body.kind,
        properties: body.properties,
        due_at: body.dueAt,
        happens_at: new Date().toISOString(),
        completed_at: null,
        target_organization_id: body.organizationId,
        target_person_id: body.personId,
        target_lead_id: body.leadId,
      };
      activities.unshift(a);
      return Response.json({ ok: true, activity: a });
    }
    const completed = url.searchParams.get("state") === "completed";
    const tasks = activities.filter(
      (a) => a.kind === "task" && !!a.completed_at === completed,
    );
    return Response.json({
      ok: true,
      tasks,
      total: tasks.length,
      pageSize: 100,
    });
  }
  if (path.endsWith("/search"))
    return Response.json({
      ok: true,
      organizations: companies.filter((o) =>
        o.name
          .toLowerCase()
          .includes((url.searchParams.get("q") || "").toLowerCase()),
      ),
      people: [person],
    });
  if (path.endsWith("/team"))
    return Response.json({
      ok: true,
      team: [
        { clerkUserId: "test-owner", firstName: "Jamie", lastName: "Example" },
      ],
    });
  if (path.endsWith("/organizations"))
    return Response.json({
      ok: true,
      organizations: companies,
      summary: { organizationCount: 2, contactCount: 3 },
      needsAttention: [companies[0]],
      recentActivity: activities.map((a) => ({
        ...a,
        organizationId: orgId,
        organizationName: companies[0].name,
      })),
      openTasks: activities
        .filter((a) => a.kind === "task" && !a.completed_at)
        .map((a) => ({
          ...a,
          organizationId: orgId,
          organizationName: companies[0].name,
        })),
    });
  if (path.includes("/organizations/"))
    return Response.json({
      ok: true,
      organization: companies.find((o) => path.endsWith(o.id)),
      activities,
      people: [person],
    });
  if (path.endsWith("/people"))
    return Response.json({ ok: true, people: [person] });
  if (path.includes("/people/"))
    return Response.json({ ok: true, person, activities });
  if (path.endsWith("/leads") && method === "POST") {
    const id = crypto.randomUUID();
    leads.push({
      id,
      business_name: body.businessName,
      email: body.email,
      status: "new",
    });
    return Response.json({ ok: true, leadId: id });
  }
  if (path.endsWith("/leads")) return Response.json({ ok: true, leads });
  if (path.includes("/leads/"))
    return Response.json({
      ok: true,
      lead: leads.find((l) => path.includes(l.id)),
      activities,
    });
  throw new Error(`Unexpected fixture request: ${method} ${path}`);
};
function App() {
  const [location, setLocation] = useState({
    pathname: "/admin/brokerage/crm",
    search: "",
  });
  const navigate = (href: string) => {
    const u = new URL(href, "https://fixture.invalid");
    setLocation({ pathname: u.pathname, search: u.search });
  };
  return (
    <Location.Provider value={{ ...location, navigate }}>
      <CrmExperienceProvider enabled>
        {location.pathname.endsWith("/leads") ? (
          <Leads />
        ) : location.pathname.endsWith("/people") ? (
          <People />
        ) : (
          <Home />
        )}
      </CrmExperienceProvider>
    </Location.Provider>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
