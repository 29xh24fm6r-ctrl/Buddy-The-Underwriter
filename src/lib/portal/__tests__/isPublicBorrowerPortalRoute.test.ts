import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isPublicBorrowerPortalRoute } from "../isPublicBorrowerPortalRoute";

describe("isPublicBorrowerPortalRoute — borrower magic-link portal auth gate", () => {
  it("matches the borrower portal token route", () => {
    assert.equal(isPublicBorrowerPortalRoute.test("/portal/abc123token"), true);
  });

  it("matches borrower portal token subroutes", () => {
    assert.equal(isPublicBorrowerPortalRoute.test("/portal/abc123token/apply"), true);
    assert.equal(isPublicBorrowerPortalRoute.test("/portal/abc123token/request"), true);
  });

  it("does not match the bare banker /portal AppShell route", () => {
    assert.equal(isPublicBorrowerPortalRoute.test("/portal"), false);
    assert.equal(isPublicBorrowerPortalRoute.test("/portal/"), false);
  });

  it("does not match banker /portal/deals subroutes", () => {
    assert.equal(isPublicBorrowerPortalRoute.test("/portal/deals/deal-123"), false);
  });

  it("does not match banker /portal/documents", () => {
    assert.equal(isPublicBorrowerPortalRoute.test("/portal/documents"), false);
  });

  it("does not match /portal/owner or /portal/share (already publicly matched separately)", () => {
    assert.equal(isPublicBorrowerPortalRoute.test("/portal/owner/tok"), false);
    assert.equal(isPublicBorrowerPortalRoute.test("/portal/share/tok"), false);
  });

  it("still matches a token that merely starts with a reserved word", () => {
    assert.equal(isPublicBorrowerPortalRoute.test("/portal/dealsomething"), true);
    assert.equal(isPublicBorrowerPortalRoute.test("/portal/ownersville"), true);
  });
});
