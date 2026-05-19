import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BorrowerChecklistSection } from "@/components/borrower/BorrowerChecklistSection";
import { BorrowerEmptyState } from "@/components/borrower/BorrowerEmptyState";
import { BorrowerHeroStatus } from "@/components/borrower/BorrowerHeroStatus";
import { BorrowerPrimaryActionCard } from "@/components/borrower/BorrowerPrimaryActionCard";
import { BorrowerProgressRail } from "@/components/borrower/BorrowerProgressRail";
import { BorrowerShell } from "@/components/borrower/BorrowerShell";
import { BorrowerTrustFooter } from "@/components/borrower/BorrowerTrustFooter";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../..");

function read(relPath: string) {
  return fs.readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("borrower shell primitives render the guided portal foundation", () => {
  const html = renderToStaticMarkup(
    React.createElement(BorrowerShell, {
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
      children: React.createElement(BorrowerEmptyState, {
        title: "No documents uploaded yet",
        message: "Once you add documents, Buddy will organize them here.",
      }),
    }),
  );

  assert.match(html, /What Buddy needs next/);
  assert.match(html, /Secure SBA document portal/);
  assert.match(html, /No documents uploaded yet/);
  assert.match(html, /xl:grid-cols-\[minmax\(0,1fr\)_320px\]/);
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
  assert.match(source, /BorrowerPrimaryActionCard/);
  assert.match(source, /BorrowerTrustFooter/);
  assert.match(source, /Let's finish your SBA package/);
  assert.match(source, /PERSONAL_FINANCIAL_STATEMENT/);
  assert.match(source, /Business Tax Returns/);
  assert.match(source, /Voided Business Check/);
  assert.match(source, /title="Completed"/);
  assert.ok(!source.includes("Portal error"));
  assert.ok(!source.includes("Review extracted data"));
  assert.ok(!source.includes("signed URL"));
  assert.ok(!source.includes("upload flow: use /upload/[token]"));
  assert.ok(!source.includes("{item.code}"));
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
