import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  classifyOfficialCapture,
  isLikelySearchFormUrl,
  isPdfContentType,
  SEARCH_FORM_LIMITATION,
} from "@/lib/research/officialSourceCapture";

/**
 * SPEC-BIE-COMMITTEE-ACTION-CENTER-AND-OFFICIAL-PDF-CAPTURE-1 — Phase 1
 * Pure classification of official-source captures (HTML/PDF) vs Buddy receipts,
 * incl. the Secretary-of-State "search form, not detail page" rule.
 */

describe("isLikelySearchFormUrl", () => {
  it("flags the Oklahoma SOS search form", () => {
    assert.equal(isLikelySearchFormUrl("https://www.sos.ok.gov/corp/corpInquiryFind.aspx"), true);
  });
  it("flags generic search/inquiry/find/lookup forms", () => {
    assert.equal(isLikelySearchFormUrl("https://example.gov/business/search"), true);
    assert.equal(isLikelySearchFormUrl("https://example.gov/corp/inquiry?x=1"), true);
    assert.equal(isLikelySearchFormUrl("https://example.gov/entity/lookup"), true);
  });
  it("does NOT flag an entity detail/result page", () => {
    assert.equal(isLikelySearchFormUrl("https://www.sos.ok.gov/corp/corpInformation.aspx?id=123456"), false);
    assert.equal(isLikelySearchFormUrl("https://example.gov/entity/123456/details"), false);
  });
  it("is false for empty/garbage", () => {
    assert.equal(isLikelySearchFormUrl(null), false);
    assert.equal(isLikelySearchFormUrl(""), false);
  });
});

describe("isPdfContentType", () => {
  it("detects application/pdf and .pdf URLs", () => {
    assert.equal(isPdfContentType("application/pdf"), true);
    assert.equal(isPdfContentType("text/html", "https://x.gov/file.pdf?v=2"), true);
    assert.equal(isPdfContentType("text/html", "https://x.gov/page"), false);
  });
});

describe("classifyOfficialCapture", () => {
  it("SOS search-form URL is NEVER available, even with content (must attach detail page)", () => {
    const c = classifyOfficialCapture({
      sourceType: "secretary_of_state",
      sourceUrl: "https://www.sos.ok.gov/corp/corpInquiryFind.aspx",
      contentType: "text/html",
      hasContent: true,
    });
    assert.equal(c.official_capture_available, false);
    assert.equal(c.official_capture_status, "search_form_only");
    assert.ok(c.official_capture_limitations.includes(SEARCH_FORM_LIMITATION));
  });

  it("SOS entity detail page with HTML content is a usable official capture", () => {
    const c = classifyOfficialCapture({
      sourceType: "secretary_of_state",
      sourceUrl: "https://www.sos.ok.gov/corp/corpInformation.aspx?id=99",
      contentType: "text/html; charset=utf-8",
      hasContent: true,
    });
    assert.equal(c.official_capture_available, true);
    assert.equal(c.official_capture_format, "html");
    assert.equal(c.official_capture_status, "captured");
  });

  it("native PDF content is captured as pdf", () => {
    const c = classifyOfficialCapture({
      sourceType: "government_data",
      sourceUrl: "https://x.gov/record.pdf",
      contentType: "application/pdf",
      hasContent: true,
    });
    assert.equal(c.official_capture_available, true);
    assert.equal(c.official_capture_format, "pdf");
  });

  it("no retained content → not_retained, not available (receipt only)", () => {
    const c = classifyOfficialCapture({
      sourceType: "borrower_official_website",
      sourceUrl: "https://borrower.com",
      contentType: "text/html",
      hasContent: false,
    });
    assert.equal(c.official_capture_available, false);
    assert.equal(c.official_capture_status, "not_retained");
    assert.equal(c.official_capture_format, "none");
  });

  it("failed fetch → fetch_failed, not available", () => {
    const c = classifyOfficialCapture({
      sourceType: "trade_publication",
      sourceUrl: "https://x.com/a",
      contentType: null,
      hasContent: false,
      fetchOk: false,
    });
    assert.equal(c.official_capture_available, false);
    assert.equal(c.official_capture_status, "fetch_failed");
  });
});
