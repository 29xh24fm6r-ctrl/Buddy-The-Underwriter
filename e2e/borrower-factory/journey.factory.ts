import { packageRecoveryItems } from "../../src/lib/borrower/guidedPackage/packageRecovery";
import { test, expect, type Page } from "@playwright/test";
import { buildGuidedSnapshot, parseAnswer } from "../../src/lib/borrower/guidedPackage/questions";
import { LENDER_PACKAGE_FILES } from "../../src/lib/brokerage/lenderPackageFiles";
import { borrowerPackageFailure, packageFailureForCurrentCapacity } from "../../src/lib/borrower/guidedPackage/completion";
async function setup(page: Page, preparePackage = false, testCompletion = false, testRecovery = false, packageState?: { released?: boolean; complete?: boolean; missingFile?: boolean; capacity?: boolean; check?: string; stale?: boolean; operationalRecovery?: boolean; capacityFailure?: "preparation" | "bundle" }) {
  const facts: Record<string, any> = { package_answers: {} };
  const rows: Record<string, any[]> = { deals: [{}], deal_loan_requests: [{}] };
  let posterAcknowledged = false;
  let revision = 0;
  const snapshot = () => ({
    ...buildGuidedSnapshot({ rows, facts, revision: String(revision) }),
    form722: { posterAvailable: true, acknowledged: posterAcknowledged },
  });
  const calls: string[] = [];
  let failNext = false;
  let helperCreated = false;
  let helperRevoked = false;
  let preparation: null | { id: string; status: string; stage: string; message?: string } = null;
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1") return route.abort("blockedbyclient");
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const body = route.request().postDataJSON();
    calls.push(body?.action ?? url.pathname);
    const respond = (json: unknown, status = 200) =>
      route.fulfill({ status, json });
    if (url.pathname === "/api/brokerage/concierge") {
      if (body?.action === "guided_help") return respond({ok:true,buddyResponse:"A prepared package is not approval or submission. Your saved answers have not changed."});
      if (body?.action === "guided_ack_722" && body.confirmed === true) posterAcknowledged = true;
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
        revision++;
        if (q.field)
          rows.deal_loan_requests[0][q.field.registryEntry.sourceColumn] =
            body.value;
        else facts.package_answers[body.questionId] = { value: parseAnswer(body.value, q.type) };
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
        assumptions: preparePackage ? { revenueStreams: [], ...(packageState?.operationalRecovery ? {costAssumptions:{plannedHires:[],fixedCostCategories:[]},managementTeam:[]} : {}) } : null,
        revision: packageState?.stale ? "2026-09-23T12:00:00Z" : null,
        status: preparePackage ? "confirmed" : "draft",
      });
    if (url.pathname.endsWith("/package-status") && testRecovery) {
      const label="Your funding totals $1,200,000 and your project costs total $950,000. Review costs paid with your contribution.";
      return respond({ok:true,bundle:{status:"failed",generation_error:"Review the final check findings."},preparation:null,
        recoveryItems:[{id:"site",label:"Confirm the proposed operating location and trade area.",questionId:"B04"}],
        readiness:{readyToPrepare:false,readyToGenerate:false,blockers:[label],
          completionItems:[{id:"budget",questionId:"loan.use_of_proceeds",label}],warnings:[],packageFiles:[],
          budget:{totalSources:1200000,totalUses:950000,difference:250000,balanced:false,message:label}}});
    }
    if (url.pathname.endsWith("/package-status") && testCompletion) {
      const missing = snapshot().questions.filter(q => q.id === "loan.agent_used" && q.state !== "saved");
      const completionItems = missing.map(q => ({id:q.id,questionId:q.id,label:q.question}));
      if (!posterAcknowledged) completionItems.push({id:"form722",questionId:"",label:"Review the SBA equal opportunity poster below and acknowledge receipt."});
      return respond({ok:true,bundle:null,preparation,readiness:{readyToPrepare:completionItems.length===0,readyToGenerate:false,blockers:completionItems.map(i=>i.label),completionItems,warnings:[],packageFiles:[]}});
    }
    if (url.pathname.endsWith("/check-package")) return respond({ok:true,check:{
      status:packageState?.check ?? "passed",checkedAt:"2026-09-23T12:00:00Z",recoveryItems:packageState?.check === "blocked" ? packageRecoveryItems("feasibility_data_completeness_below_70_percent operational_readiness.staffingReadiness operational_readiness.managementExperience") : [],
      message: packageState?.check === "not_checked" ? "Financial validation and business research must finish first." : "Saved calculations passed. Generated documents have not been verified.",
    }});
    if (url.pathname.endsWith("/package-status")) {
      const failureMessage = packageFailureForCurrentCapacity(borrowerPackageFailure("budget_unavailable"), {available:packageState?.capacity !== false,message:null});
      return respond({ ok: true, bundle: packageState?.capacityFailure === "bundle" ? {id:"bundle",status:"failed",generation_error:failureMessage} : packageState?.complete ? {id:"bundle",status:"succeeded",generation_completed_at:"2026-09-23T11:00:00Z"} : null,
        release:{released:packageState?.released === true},preparation:packageState?.capacityFailure === "preparation" ? {id:"preparation",status:"failed",stage:"checking",message:failureMessage} : preparation, readiness: {
        capacity: {available:packageState?.capacity !== false,message:packageState?.capacity === false ? "Processing capacity is unavailable. You can check saved evidence without AI." : null},
        readyToPrepare: preparePackage && preparation?.status !== "running" && packageState?.capacity !== false,
        readyToGenerate: false, blockers: [], warnings: [], packageFiles: packageState?.complete ? LENDER_PACKAGE_FILES.map((f,i)=>({key:f.column,label:f.label,ready:!(packageState.missingFile && i===0)})) : [],
      } });
    }
    if (url.pathname.endsWith("/build-package")) {
      preparation = { id: "preparation", status: "running", stage: "research" };
      return respond({ ok: true, preparationId: preparation.id }, 202);
    }
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
    failPreparation: () => {
      preparation = { id: "preparation", status: "failed", stage: "research", message: "Business research could not be completed. Review your business details and retry preparation." };
    },
  };
}
test("eligibility recovery saves explicit receipts and selected franchise without claiming submission", async ({ page }) => {
  const fixture = await setup(page);
  let selected = false;
  await page.route("**/seal-status", route => route.fulfill({ json: {
    ok: true, sealed: false, canSeal: false, gateReasons: ["Average annual receipts and franchise evidence need review."],
    score: { isFranchise: true, eligibilityUnresolved: [{ check: "size_standard", nextAction: "Provide average annual receipts, including any affiliates." }], topWeaknesses: ["Downside debt coverage is weak"] },
  } }));
  await page.route("**/api/brokerage/franchise", route => {
    if (route.request().method() === "PATCH") {
      expect(route.request().postDataJSON()).toEqual({ brand_id: "brand-7-brew" });
      selected = true;
    }
    return route.fulfill({ json: { ok: true, brandId: selected ? "brand-7-brew" : null, brandName: selected ? "7 BREW" : null } });
  });
  await page.route("**/api/franchise/search?*", route => route.fulfill({ json: { brands: [{ id: "brand-7-brew", brand_name: "7 BREW", sba_certification_status: "certified" }] } }));
  await page.getByRole("button", { name: /MISSION 5 Make it ready/ }).click();
  await page.getByRole("textbox", { name: "Search for your franchise brand" }).fill("7 Brew");
  await page.getByRole("button", { name: /7 BREW/ }).click();
  expect(selected).toBe(true);
  await expect(page.getByText(/Brand selection is saved/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit for lender matching", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Review average annual receipts", exact: true }).click();
  await page.getByRole("textbox", { name: /average annual receipts for SBA size evaluation/ }).fill("0");
  await page.getByRole("button", { name: "Save and continue", exact: true }).click();
  expect(fixture.facts.package_answers.B13.value).toBe(0);
  await page.getByRole("button", { name: /MISSION 5 Make it ready/ }).click();
  await page.getByRole("button", { name: "Review receipts calculation and affiliates", exact: true }).click();
  await page.getByRole("textbox", { name: /Explain the receipts calculation period/ }).fill("Pre-opening; no receipts from the applicant or affiliates. Supporting records supplied.");
  await page.getByRole("button", { name: "Save and continue", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: /MISSION 5 Make it ready/ }).click();
  await page.getByRole("button", { name: "Review average annual receipts", exact: true }).click();
  await expect(page.getByRole("textbox", { name: /average annual receipts for SBA size evaluation/ })).toHaveValue("0");
  expect(fixture.calls.filter(call => /\/(build-package|seal)$/.test(call))).toHaveLength(0);
});
for (const released of [false,true]) test(`completed package uses safe file status with release ${released}`, async ({page}) => {
  await setup(page,true,false,false,{complete:true,released});
  await page.getByRole("button",{name:/MISSION 4 Prepare your package/}).click();
  const download = page.getByRole("link",{name:"Download your application documents"});
  if (released) {
    await expect(download).toBeVisible();
    await expect(download).toHaveAttribute("href", /\/trident\/download\/complete_package\?redirect=1$/);
    await expect(page.getByText(/your uploaded source documents from this preparation run/)).toBeVisible();
  }
  else {
    await expect(page.getByText(/Your documents are prepared for lender review/)).toBeVisible();
    await expect(download).toHaveCount(0);
  }
});
for (const source of ["preparation", "bundle"] as const) test(`capacity recovery reconciles ${source} history and current controls without starting work`, async ({page}) => {
  const state = {capacity:false,capacityFailure:source};
  const fixture = await setup(page,true,false,false,state);
  await page.getByRole("button",{name:/MISSION 4 Prepare your package/}).click();
  const retry = page.getByRole("button",{name:"Retry package preparation",exact:true});
  await expect(retry).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText("previous preparation attempt stopped");
  state.capacity = true;
  await page.getByRole("button",{name:"Refresh status",exact:true}).click();
  await expect(retry).toBeEnabled();
  await expect(page.getByRole("heading",{name:"Initial preparation requirements complete",exact:true})).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Capacity is available now");
  await expect(page.getByText(/wait for capacity to reset/i)).toHaveCount(0);
  await expect(page.getByRole("link",{name:"Download your application documents"})).toHaveCount(0);
  state.capacity = false;
  await page.getByRole("button",{name:"Refresh status",exact:true}).click();
  await expect(retry).toBeDisabled();
  await expect(page.getByText(/Capacity is available now/)).toHaveCount(0);
  expect(fixture.calls.filter(call=>/\/(build-package|draft-assumptions)$/.test(call))).toHaveLength(0);
});
for (const state of [{missingFile:true},{stale:true}]) test(`incomplete or stale package never offers download ${JSON.stringify(state)}`,async({page})=>{
  await setup(page,true,false,false,{complete:true,released:true,...state});
  await page.getByRole("button",{name:/MISSION 4 Prepare your package/}).click();
  await expect(page.getByText("Assumptions confirmed",{exact:true})).toBeVisible();
  await expect(page.getByRole("link",{name:"Download your application documents"})).toHaveCount(0);
});
test("paused capacity allows explicit no-AI checks and editing clears the result",async({page})=>{
  const fixture=await setup(page,true,false,false,{capacity:false});
  await page.getByRole("button",{name:/MISSION 4 Prepare your package/}).click();
  await expect(page.getByRole("button",{name:"Prepare lender package",exact:true})).toBeDisabled();
  await page.getByRole("button",{name:"Check saved package evidence — no AI",exact:true}).click();
  await expect(page.getByText("Saved evidence check passed",{exact:true})).toBeVisible();
  await page.getByText("Revenue",{exact:true}).click();
  await page.getByRole("button",{name:"Add item",exact:true}).first().click();
  await expect(page.getByText("Saved evidence check passed",{exact:true})).toHaveCount(0);
  expect(fixture.calls.filter(call=>call.endsWith("/check-package"))).toHaveLength(1);
  expect(fixture.calls.filter(call=>/\/(build-package|draft-assumptions)$/.test(call))).toHaveLength(0);
});
test("pending validation and research never appear as a passed check",async({page})=>{
  await setup(page,true,false,false,{capacity:false,check:"not_checked"});
  await page.getByRole("button",{name:/MISSION 4 Prepare your package/}).click();
  await page.getByRole("button",{name:"Check saved package evidence — no AI",exact:true}).click();
  await expect(page.getByText("Saved evidence check is incomplete",{exact:true})).toBeVisible();
  await expect(page.getByText("Saved evidence check passed",{exact:true})).toHaveCount(0);
});
test("completed inputs start preparation while research is missing, resume progress, and allow retry", async ({ page }) => {
  const fixture = await setup(page, true);
  await page.getByRole("button", { name: /MISSION 4 Prepare your package/ }).click();
  const prepare = page.getByRole("button", { name: "Prepare lender package", exact: true });
  await expect(prepare).toBeEnabled();
  await prepare.click();
  await expect(page.getByText("Preparing research for your business plan", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Buddy is preparing your package…", exact: true })).toBeDisabled();
  await page.reload();
  await page.getByRole("button", { name: /MISSION 4 Prepare your package/ }).click();
  await expect(page.getByText("Preparing research for your business plan", { exact: true })).toBeVisible();
  fixture.failPreparation();
  await page.getByRole("button", { name: "Refresh status", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Business research could not be completed");
  await expect(page.getByRole("button", { name: "Retry package preparation", exact: true })).toBeEnabled();
  expect(fixture.calls.filter(call => call.endsWith("/build-package"))).toHaveLength(1);
});
test("goal-first journey saves, resumes, keeps drafts and does not call models", async ({
  page,
}) => {
  const fixture = await setup(page);
  await expect(
    page.getByText("What’s next for your business?", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Buy a business", exact: true })
    .click();
  await page.getByRole("button", { name: "Save activity and continue", exact: true }).click();
  await expect(
    page.getByText("Nice work—your plan just got clearer.", { exact: true }),
  ).toBeVisible();
  expect(fixture.calls).not.toContain("guided_review");
  await page.getByRole("button", { name: /MISSION 1 Shape your idea/ }).click();
  await page
    .getByRole("textbox", {
      name: "What are we helping you make happen?",
    })
    .fill("Acquire a local repair business");
  await page.getByRole("button", { name: /MISSION 2 Tell your story/ }).click();
  await page.getByRole("button", { name: /MISSION 1 Shape your idea/ }).click();
  await expect(
    page.getByRole("textbox", {
      name: "What are we helping you make happen?",
    }),
  ).toHaveValue("Acquire a local repair business");
  fixture.fail();
  await page.getByRole("button", { name: "Save activity and continue", exact: true }).click();
  await expect(page.getByText("Simulated save interruption")).toBeVisible();
  await expect(
    page.getByRole("textbox", {
      name: "What are we helping you make happen?",
    }),
  ).toHaveValue("Acquire a local repair business");
  await page.getByRole("button", { name: "Save activity and continue", exact: true }).click();
  await expect(page.getByText("Nice work—your plan just got clearer.")).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Where are you in your business journey?", { exact: true }),
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
  await page.getByRole("button", { name: "Save activity and continue", exact: true }).click();
  await expect(page.getByText("Nice work—your plan just got clearer.")).toBeVisible();
  await page.getByRole("button", { name: "Explore financing options" }).click();
  await expect(
    page.getByRole("heading", { name: "SBA 504", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("These are paths to explore, not a qualification result.", {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: /MISSION 3 Build your budget/ }).click();
  await expect(
    page.getByRole("heading", { name: "Bring what you have.", exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: /MISSION 4 Prepare your package/ }).click();
  await page
    .getByRole("button", { name: "Enter assumptions myself — no AI needed" })
    .click();
  await expect(page.getByText("Revenue", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /MISSION 1 Shape your idea/ }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Save your current protected answer or financial draft",
  );
  await page.getByRole("button", { name: "Discard unsaved changes" }).click();
  await expect(
    page.getByRole("button", {
      name: "Enter assumptions myself — no AI needed",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: /MISSION 5 Make it ready/ }).click();
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
  await page.getByRole("button", { name: /MISSION 3 Build your budget/ }).click();
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

test("borrower clarifies a document and Buddy resumes processing without staff", async ({ page }) => {
  await setup(page);
  let saved = false;
  let submitted: unknown = null;
  await page.route("**/api/borrower/portal/test-deal/documents**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/process")) {
      const body = route.request().postDataJSON();
      if (body.documentId) { submitted = body; saved = true; }
      return route.fulfill({ json: { ok: true, queued: body.documentId ? 1 : 0 } });
    }
    return route.fulfill({ json: { ok: true, documents: [{
      id: "00000000-0000-4000-8000-000000000001", filename: "Opening balance sheet.pdf", label: "Opening balance sheet.pdf",
      status: saved ? "queued" : "classified", processingComplete: false,
      canClarify: !saved, canRetry: false, suggestedType: "BALANCE_SHEET", taxYear: null,
      actionMessage: saved ? null : "Buddy needs one detail: what kind of document is this?",
    }] } });
  });
  await page.getByRole("button", { name: /MISSION 3 Build your budget/ }).click();
  await expect(page.getByText("Buddy needs one detail: what kind of document is this?")).toBeVisible();
  const save = page.getByRole("button", { name: "Save detail and let Buddy continue" });
  await expect(save).toBeDisabled();
  await page.getByRole("combobox", { name: "Statement period for Opening balance sheet.pdf" }).selectOption("CURRENT");
  await save.click();
  await expect(page.getByText("Buddy is reading and organizing this document…")).toBeVisible();
  await expect(page.getByText("Processed by Buddy — added to your application")).toHaveCount(0);
  expect(submitted).toEqual({ documentId: "00000000-0000-4000-8000-000000000001", clarification: { doc_type: "BALANCE_SHEET", tax_year: null, statement_period: "CURRENT" } });
});

 test("preparation links to missing answers and requires poster receipt before starting", async ({page}) => {
  const fixture = await setup(page, true, true);
  await page.getByRole("button", {name:/MISSION 4 Prepare your package/}).click();
  await expect(page.getByRole("button", {name:"Prepare lender package",exact:true})).toBeDisabled();
  await page.getByRole("button", {name:"Answer this question",exact:true}).click();
  await expect(page.getByRole("heading", {name:"Are you paying an agent or packager for help with this application?",exact:true})).toBeVisible();
  await page.getByRole("group", {name:"Are you paying an agent or packager for help with this application?",exact:true}).getByRole("button",{name:"No",exact:true}).click();
  await page.getByRole("button",{name:"Save and continue",exact:true}).click();
  await expect(page.getByRole("button",{name:"Answer this question",exact:true})).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Prepare lender package",exact:true})).toBeDisabled();
  await expect(page.getByRole("link", {name:"Open the poster",exact:true})).toHaveAttribute("href", "/sba-templates/SBA_722.pdf");
  await page.getByRole("button",{name:"I have received and reviewed this poster",exact:true}).click();
  await expect(page.getByText("Receipt acknowledged",{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Prepare lender package",exact:true})).toBeEnabled();
  expect(fixture.calls.filter(call=>call.endsWith("/build-package"))).toHaveLength(0);
});


test("package recovery shows the funding gap and returns to saved project costs without starting paid work", async ({page}) => {
  const fixture=await setup(page,true,false,true);
  await page.getByRole("button",{name:/MISSION 4 Prepare your package/}).click();
  await expect(page.getByText("What the last preparation found",{exact:true})).toBeVisible();
  await expect(page.getByText("Confirm the proposed operating location and trade area.",{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Retry package preparation",exact:true})).toBeDisabled();
  await page.getByRole("button",{name:"Answer this question",exact:true}).click();
  await expect(page.getByRole("heading",{name:"What will your entire project cost?",exact:true})).toBeVisible();
  await expect(page.getByText(/Include every project cost, whether paid by the loan/)).toBeVisible();
  expect(fixture.calls.filter(call=>call.endsWith("/build-package"))).toHaveLength(0);
});


test("evidence recovery opens the actual staffing and management inputs without running AI", async ({page}) => {
  const state = {check:"blocked",operationalRecovery:true};
  const fixture = await setup(page,true,false,false,state);
  await page.getByRole("button",{name:/MISSION 4 Prepare your package/}).click();
  await page.getByRole("button",{name:"Check saved package evidence — no AI",exact:true}).click();
  await expect(page.getByText("Saved evidence needs attention",{exact:true})).toBeVisible();
  await expect(page.getByRole("heading",{name:"Initial preparation requirements complete",exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:"Review costs and staffing",exact:true}).click();
  await expect(page.getByRole("group",{name:"Planned Hires",exact:true})).toBeVisible();
  await expect(page.getByText(/Planned hires add payroll to fixed expenses/)).toBeVisible();
  await page.getByRole("button",{name:"Review management",exact:true}).click();
  await expect(page.getByRole("group",{name:"Management Team",exact:true})).toBeVisible();
  state.check = "passed";
  await page.getByRole("button",{name:"Check saved package evidence — no AI",exact:true}).click();
  await expect(page.getByText("Saved evidence check passed",{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Review costs and staffing",exact:true})).toHaveCount(0);
  expect(fixture.calls.filter(call=>/\/(build-package|draft-assumptions)$/.test(call))).toHaveLength(0);
});

 test("optional Ask Buddy questions use read-only help", async ({ page }) => {
  const app = await setup(page);
  await page.getByRole("button", { name: "Ask Buddy", exact: true }).click();
  await page.getByRole("textbox", { name: "Ask Buddy anything…", exact: true }).fill("Am I approved? Do not change my answers.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("A prepared package is not approval or submission.");
  expect(app.calls).toContain("guided_help");
  expect(app.calls).not.toContain("confirm_assumptions");
  expect(app.calls).not.toContain("guided_answer");
});
