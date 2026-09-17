import { test, expect, type Page } from "@playwright/test";
import { buildGuidedSnapshot } from "../../src/lib/borrower/guidedPackage/questions";
async function setup(page: Page) {
  const facts: Record<string, any> = { package_answers: {} };
  const rows: Record<string, any[]> = { deals: [{}], deal_loan_requests: [{}] };
  const snapshot = () => ({
    ...buildGuidedSnapshot({ rows, facts, revision: null }),
    form722: { posterAvailable: true, acknowledged: false },
  });
  const calls: string[] = [];
  let failNext = false;
  let helperCreated = false;
  let helperRevoked = false;
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1") return route.abort("blockedbyclient");
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const body = route.request().postDataJSON();
    calls.push(body?.action ?? url.pathname);
    const respond = (json: unknown, status = 200) =>
      route.fulfill({ status, json });
    if (url.pathname === "/api/brokerage/concierge") {
      if (body?.action === "guided_answer") {
        if (failNext) {
          failNext = false;
          return respond(
            { ok: false, error: "Simulated save interruption" },
            503,
          );
        }
        const q = snapshot().questions.find((q) => q.id === body.questionId)!;
        if (q.value !== body.expectedValue)
          return respond(
            { ok: false, error: "Answer changed in another session" },
            409,
          );
        if (q.field)
          rows.deal_loan_requests[0][q.field.registryEntry.sourceColumn] =
            body.value;
        else facts.package_answers[body.questionId] = { value: body.value };
      }
      if (url.searchParams.get("view") === "schedules")
        return respond({ ok: true, owners: [], schedules: {} });
      return respond({ ok: true, dealId: "test-deal", snapshot: snapshot() });
    }
    if (url.pathname.endsWith("/share-links")) {
      if (route.request().method() === "POST") {
        helperCreated = true;
        return respond({
          ok: true,
          shareUrl: "/portal/share/test-scoped-link",
        });
      }
      if (route.request().method() === "DELETE") {
        helperRevoked = true;
        return respond({ ok: true });
      }
      return respond({
        ok: true,
        items: [{ id: "business-returns", title: "Business tax returns" }],
        links: helperCreated
          ? [
              {
                id: "helper-link",
                recipient_name: "Alex’s accountant",
                checklist_item_ids: ["business-returns"],
                expires_at: "2099-01-01",
                revoked: helperRevoked,
              },
            ]
          : [],
      });
    }
    if (url.pathname.endsWith("/documents"))
      return respond({ ok: true, documents: [] });
    if (url.pathname.endsWith("/assumptions"))
      return respond({
        ok: true,
        assumptions: null,
        revision: null,
        status: "draft",
      });
    if (url.pathname.endsWith("/package-status"))
      return respond({ ok: true, bundle: null });
    if (url.pathname.endsWith("/owners"))
      return respond({ ok: true, owners: [], summary: null });
    return respond({
      ok: true,
      sealed: false,
      canSeal: false,
      gateReasons: ["Identity review needed"],
      forms: [],
      requests: [],
      documents: [],
    });
  });
  await page.goto("/");
  return {
    calls,
    fail: () => {
      failNext = true;
    },
    facts,
  };
}
test("goal-first journey saves, resumes, keeps drafts and does not call models", async ({
  page,
}) => {
  const fixture = await setup(page);
  await expect(
    page.getByRole("heading", { name: "What’s next for your business?" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Buy a business", exact: true })
    .click();
  await page.getByRole("button", { name: "Save answer", exact: true }).click();
  await expect(
    page.getByText("Saved to your application.", { exact: true }),
  ).toBeVisible();
  expect(fixture.calls).not.toContain("guided_review");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("textbox", {
      name: "What do you want this financing to help you accomplish?",
    })
    .fill("Acquire a local repair business");
  await page.getByRole("button", { name: /STEP 2 Your business/ }).click();
  await page.getByRole("button", { name: /STEP 1 Your plan/ }).click();
  await expect(
    page.getByRole("textbox", {
      name: "What do you want this financing to help you accomplish?",
    }),
  ).toHaveValue("Acquire a local repair business");
  fixture.fail();
  await page.getByRole("button", { name: "Save answer", exact: true }).click();
  await expect(page.getByText("Simulated save interruption")).toBeVisible();
  await expect(
    page.getByRole("textbox", {
      name: "What do you want this financing to help you accomplish?",
    }),
  ).toHaveValue("Acquire a local repair business");
  await page.getByRole("button", { name: "Save answer", exact: true }).click();
  await expect(
    page.getByText("Saved to your application.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "Where are you in your business journey?",
    }),
  ).toBeVisible();
  expect(fixture.calls).not.toContain("guided_review");
  await page.screenshot({
    path: `/tmp/buddy-journey-${test.info().project.name}.png`,
    fullPage: true,
  });
});
test("options are educational; documents and manual financial review are reachable", async ({
  page,
}) => {
  const fixture = await setup(page);
  await page
    .getByRole("button", { name: "Buy or improve property", exact: true })
    .click();
  await page.getByRole("button", { name: "Save answer", exact: true }).click();
  await expect(
    page.getByText("Saved to your application.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Explore financing options" }).click();
  await expect(
    page.getByRole("heading", { name: "SBA 504", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("These are paths to explore, not a qualification result.", {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: /STEP 3 Your numbers/ }).click();
  await expect(
    page.getByRole("heading", { name: "Bring what you have.", exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: /STEP 4 Your application/ }).click();
  await page
    .getByRole("button", { name: "Enter assumptions myself — no AI needed" })
    .click();
  await expect(page.getByText("Revenue", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /STEP 1 Your plan/ }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Save your current protected answer or financial draft",
  );
  await page.getByRole("button", { name: "Discard unsaved changes" }).click();
  await expect(
    page.getByRole("button", {
      name: "Enter assumptions myself — no AI needed",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: /STEP 5 Review/ }).click();
  await expect(page.getByText("Internal error", { exact: true })).toHaveCount(
    0,
  );
  expect(fixture.calls).not.toContain("draft-assumptions");
  expect(fixture.calls).not.toContain("build-package");
});
test("public welcome reflows and provides options without account or model calls", async ({
  page,
}) => {
  let external = 0;
  await page.route("**/*", (route) => {
    if (new URL(route.request().url()).hostname !== "127.0.0.1") {
      external++;
      return route.abort();
    }
    return route.continue();
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?welcome");
  await page
    .getByRole("button", { name: "Buy equipment", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "SBA 504", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `/tmp/buddy-welcome-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Build my plan" }).click();
  await expect(
    page.getByRole("heading", { name: "Let’s save your place." }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  expect(external).toBe(0);
});

test("accountant help requires a selected scope and confirmation and can be revoked", async ({
  page,
}) => {
  const fixture = await setup(page);
  await page.getByRole("button", { name: /STEP 3 Your numbers/ }).click();
  await page
    .getByText("Have an accountant or bookkeeper help", { exact: true })
    .click();
  await page.getByLabel("Who will help?").fill("Alex’s accountant");
  await expect(
    page.getByRole("button", { name: "Create upload link", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Business tax returns", { exact: true }).check();
  await expect(
    page.getByRole("button", { name: "Create upload link", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel(
      "I want to create a link for this person to see these requests and upload documents.",
    )
    .check();
  await page
    .getByRole("button", { name: "Create upload link", exact: true })
    .click();
  await expect(page.getByLabel("Private upload link")).toHaveValue(
    /\/portal\/share\/test-scoped-link$/,
  );
  await expect(
    page.getByText("Nothing has been sent.", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Revoke link for Alex’s accountant" })
    .click();
  await expect(page.getByText("Revoked", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Private upload link")).toHaveCount(0);
  expect(fixture.calls).not.toContain("guided_review");
});
