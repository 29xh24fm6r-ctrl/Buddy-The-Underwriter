import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BorrowerChecklistSection } from "@/components/borrower/BorrowerChecklistSection";
import { BorrowerEmptyState } from "@/components/borrower/BorrowerEmptyState";
import { BorrowerExpectationCard } from "@/components/borrower/BorrowerExpectationCard";
import { BorrowerHeroStatus } from "@/components/borrower/BorrowerHeroStatus";
import { BorrowerHelpContactCard } from "@/components/borrower/BorrowerHelpContactCard";
import { BorrowerProgressConfidence } from "@/components/borrower/BorrowerProgressConfidence";
import { BorrowerProgressTimeline } from "@/components/borrower/BorrowerProgressTimeline";
import { BorrowerPrimaryActionCard } from "@/components/borrower/BorrowerPrimaryActionCard";
import { BorrowerProgressRail } from "@/components/borrower/BorrowerProgressRail";
import { BorrowerReviewActivity } from "@/components/borrower/BorrowerReviewActivity";
import { BorrowerReviewStatusCard } from "@/components/borrower/BorrowerReviewStatusCard";
import { BorrowerReviewWindow } from "@/components/borrower/BorrowerReviewWindow";
import { BorrowerSecurityNotice } from "@/components/borrower/BorrowerSecurityNotice";
import { BorrowerShell } from "@/components/borrower/BorrowerShell";
import { BorrowerTrustFooter } from "@/components/borrower/BorrowerTrustFooter";
import { BorrowerWaitingState } from "@/components/borrower/BorrowerWaitingState";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../..");

function read(relPath: string) {
  return fs.readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("borrower shell primitives render the guided portal foundation", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      BorrowerShell,
      {
        hero: React.createElement(BorrowerHeroStatus, {
          eyebrow: "Buddy SBA concierge",
          title: "Let's finish your SBA package.",
          summary: "Buddy is waiting on one more document.",
          badge: "Documents still needed",
          tone: "progress",
          meta: [
            { label: "Business", value: "Demo Deal" },
            { label: "Documents received", value: "2 of 3" },
            { label: "Current focus", value: "Add requested documents" },
          ],
        }),
        primary: React.createElement(BorrowerPrimaryActionCard, {
          title: "Add year-end business financials",
          description: "Buddy needs one more file to keep the package moving.",
          ctaLabel: "Add requested document",
        }),
        rail: React.createElement(BorrowerProgressRail, {
          progressLabel: "Package in progress",
          progressValue: 67,
          checklistSummary: "2 of 3 requested items are already in your package.",
          timeline: [
            { id: "upload", title: "Add documents", subtitle: "Upload the files Buddy requested.", state: "current" },
            { id: "review", title: "Buddy review", subtitle: "Buddy organizes your package.", state: "upcoming" },
          ],
        }),
        footer: React.createElement(BorrowerTrustFooter),
      },
      React.createElement(BorrowerEmptyState, {
        title: "No documents uploaded yet",
        message: "Once you add documents, Buddy will organize them here.",
      }),
    ),
  );

  assert.match(html, /What Buddy needs next/);
  assert.match(html, /Secure SBA document portal/);
  assert.match(html, /No documents uploaded yet/);
  assert.match(html, /xl:grid-cols-\[minmax\(0,1fr\)_320px\]/);
});

test("progress transparency primitives render borrower-safe review language", () => {
  const children = [
    React.createElement(BorrowerReviewStatusCard, {
      key: "status",
      title: "Buddy is reviewing your package",
      summary: "Buddy is checking your latest files.",
      statusLabel: "Buddy reviewing your package",
      timing: "Buddy usually reviews new uploads within 1 business day.",
      nextStep: "If anything else is needed, the next request will appear here.",
    }),
    React.createElement(BorrowerProgressTimeline, {
      key: "timeline",
      title: "Documents received",
      summary: "Safe borrower progress only.",
      steps: [
        { key: "getting_started", title: "Getting started", detail: "Buddy is setting up your package.", state: "done" as const },
        { key: "documents_received", title: "Documents received", detail: "Buddy received your upload.", state: "current" as const },
      ],
    }),
    React.createElement(BorrowerReviewActivity, {
      key: "activity",
      items: [
        {
          id: "1",
          title: "Buddy received your document",
          detail: "Your file was added to the secure SBA package.",
          createdAt: new Date().toISOString(),
          kind: "upload" as const,
        },
      ],
    }),
    React.createElement(BorrowerWaitingState, {
      key: "waiting",
      title: "You're waiting on Buddy, not stuck",
      summary: "There is nothing you need to do right now.",
      expectation: "Expected next step: Buddy reviews the latest package update.",
    }),
  ];
  const html = renderToStaticMarkup(React.createElement("div", null, ...children));

  assert.match(html, /Buddy is reviewing your package/);
  assert.match(html, /Documents received/);
  assert.match(html, /Buddy received your document/);
  assert.match(html, /waiting on Buddy, not stuck/);
});

test("trust and reassurance primitives render safe expectation language", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      "div",
      null,
      React.createElement(BorrowerReviewWindow, {
        title: "Review periods are normal in SBA preparation",
        summary: "SBA loan preparation can take several days depending on the documents still needed.",
        windowLabel: "Buddy usually reviews new uploads within 1 business day.",
      }),
      React.createElement(BorrowerExpectationCard, {
        title: "What happens while you wait",
        points: [
          "Buddy will update this portal if anything else is needed.",
          "You do not need to take action right now unless a new item appears in your checklist.",
        ],
      }),
      React.createElement(BorrowerSecurityNotice),
      React.createElement(BorrowerHelpContactCard, {
        title: "Questions about your checklist?",
        body: "Need help finding a document or understanding your checklist?",
        actionLabel: "Open secure help",
        actionHref: "/start",
      }),
      React.createElement(BorrowerProgressConfidence, {
        title: "Your package is moving forward.",
        tone: "review",
        bullets: [
          "Buddy has received your recent uploads.",
          "Buddy usually reviews new uploads within 1 business day.",
        ],
      }),
    ),
  );

  assert.match(html, /Review periods are normal in SBA preparation/);
  assert.match(html, /Buddy usually reviews new uploads within 1 business day/);
  assert.match(html, /Secure SBA document portal/);
  assert.match(html, /Open secure help/);
  assert.match(html, /Your package is moving forward/);
});

test("guided checklist section prioritizes required items and separates completed ones", () => {
  const outstandingHtml = renderToStaticMarkup(
    React.createElement(BorrowerChecklistSection, {
      title: "Financial documents",
      summary: "2 still needed in this section.",
      emptyTitle: "Done",
      emptyMessage: "Nothing left.",
      items: [
        {
          id: "1",
          title: "Personal Financial Statement",
          description: "Buddy needs this to complete the guarantor profile.",
          statusLabel: "Needs another file",
          statusTone: "required",
          required: true,
          completedLabel: null,
          helper: {
            why: "Buddy needs this to complete the guarantor profile.",
            formats: "PDF is best.",
            examples: "Signed bank PFS form.",
            scans: "Scans are okay.",
          },
        },
      ],
    }),
  );

  const completedHtml = renderToStaticMarkup(
    React.createElement(BorrowerChecklistSection, {
      title: "Completed",
      summary: "Already received.",
      emptyTitle: "Nothing completed yet",
      emptyMessage: "Waiting on first upload.",
      collapsible: true,
      items: [
        {
          id: "2",
          title: "Business Tax Returns",
          description: "Already reviewed.",
          statusLabel: "Looks good",
          statusTone: "complete",
          required: true,
          completedLabel: "Completed Apr 3",
          helper: {
            why: "Buddy uses this to review historical results.",
            formats: "PDF is best.",
            examples: "Filed 1120 return.",
            scans: "Scans are okay.",
          },
        },
      ],
    }),
  );

  assert.match(outstandingHtml, /Required/);
  assert.match(outstandingHtml, /Needs another file/);
  assert.match(completedHtml, /Completed Apr 3/);
  assert.match(completedHtml, /Looks good/);
});

test("portal client uses borrower-safe shell and avoids signed URL language", () => {
  const source = read("src/components/borrower/PortalClient.tsx");

  assert.match(source, /BorrowerShell/);
  assert.match(source, /BorrowerChecklistSection/);
  assert.match(source, /BorrowerReviewStatusCard/);
  assert.match(source, /BorrowerReviewWindow/);
  assert.match(source, /BorrowerExpectationCard/);
  assert.match(source, /BorrowerSecurityNotice/);
  assert.match(source, /BorrowerHelpContactCard/);
  assert.match(source, /BorrowerProgressConfidence/);
  assert.match(source, /BorrowerProgressTimeline/);
  assert.match(source, /BorrowerReviewActivity/);
  assert.match(source, /BorrowerWaitingState/);
  assert.match(source, /BorrowerPrimaryActionCard/);
  assert.match(source, /BorrowerTrustFooter/);
  assert.match(source, /Let's finish your SBA package/);
  assert.match(source, /PERSONAL_FINANCIAL_STATEMENT/);
  assert.match(source, /Business Tax Returns/);
  assert.match(source, /Voided Business Check/);
  assert.match(source, /title="Completed"/);
  assert.match(source, /Getting started/);
  assert.match(source, /Documents requested/);
  assert.match(source, /Documents received/);
  assert.match(source, /Buddy reviewing your package/);
  assert.match(source, /Additional items needed/);
  assert.match(source, /Ready for SBA review/);
  assert.match(source, /Buddy usually reviews new uploads within 1 business day/);
  assert.match(source, /SBA loan preparation can take several days/);
  assert.match(source, /You do not need to take action right now/);
  assert.match(source, /Email your loan officer/);
  assert.ok(!source.includes("Portal error"));
  assert.ok(!source.includes("Review extracted data"));
  assert.ok(!source.includes("signed URL"));
  assert.ok(!source.includes("upload flow: use /upload/[token]"));
  assert.ok(!source.includes("{item.code}"));
  assert.ok(!source.includes("Underwriting"));
  assert.ok(!source.includes("approval"));
  assert.ok(!source.includes("closing"));
  assert.ok(!source.includes("underwriting scores"));
  // A mailto: to the borrower's actual assigned banker (fetched dynamically
  // from /api/portal/[token]/context, never hardcoded) is now intentional —
  // see BorrowerHelpContactCard usage below. The old blanket "no mailto/
  // email pattern at all" check predates that fix, when any email string
  // here would have been a leaked internal placeholder.
  assert.ok(!source.includes("@buddy.com"));
  assert.ok(!source.includes("slack"));
  assert.ok(!source.includes("guaranteed by"));
});

test("portal client sanitizes raw provider and token failures before rendering", () => {
  const source = read("src/components/borrower/PortalClient.tsx");

  assert.match(source, /sanitizeBorrowerError/);
  assert.match(source, /no longer active/);
  assert.match(source, /secure document portal/);
  assert.ok(!source.includes("alert(e?.message"));
});

test("borrower shell supports mobile sticky CTA rendering", () => {
  const source = read("src/components/borrower/BorrowerShell.tsx");
  assert.match(source, /fixed inset-x-0 bottom-0/);
  assert.match(source, /sm:hidden/);
});

test("start page uses the new premium borrower foundation copy", () => {
  const source = read("src/app/(borrower)/start/page.tsx");

  assert.match(source, /Build your SBA package with guidance, not guesswork/);
  assert.match(source, /BorrowerTrustFooter/);
  assert.ok(!source.includes("Get a real SBA loan, on your terms."));
});

test("trident preview failure copy stays borrower-safe", () => {
  const source = read("src/components/borrower/TridentPreviewCard.tsx");

  assert.match(source, /secure preview service needs another try/);
  assert.ok(!source.includes("state.bundle?.generationError"));
});

test("upload page uses borrower-safe state copy and hides raw upload failures", () => {
  const source = read("src/app/(borrower)/upload/[token]/client.tsx");

  assert.match(source, /Uploading\.\.\./);
  assert.match(source, /Buddy is reviewing this file/);
  assert.match(source, /Needs another file/);
  assert.match(source, /Files encrypted in transit/);
  assert.match(source, /safeUploadError/);
  assert.ok(!source.includes("setErr(e?.message"));
});

test("portal activity route filters to borrower-safe package updates", () => {
  const source = read("src/app/api/portal/[token]/activity/route.ts");

  assert.match(source, /Buddy received your document/);
  assert.match(source, /Additional document requested/);
  assert.match(source, /SBA package progressing/);
  assert.ok(!source.includes("provider failures"));
  assert.ok(!source.includes("retry queue"));
  assert.ok(!source.includes("banker notes"));
});

test("trust layer avoids fake promises or underwriting predictions", () => {
  const source = read("src/components/borrower/PortalClient.tsx");

  assert.ok(!source.includes("guaranteed"));
  assert.ok(!source.includes("approved"));
  assert.ok(!source.includes("will fund"));
  assert.ok(!source.includes("underwriting prediction"));
  assert.ok(!source.includes("banker@"));
  assert.ok(!source.includes("lender@"));
});
