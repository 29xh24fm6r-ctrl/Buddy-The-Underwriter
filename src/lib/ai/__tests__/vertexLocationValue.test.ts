import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_VERTEX_LOCATION,
  normalizeVertexLocation,
  resolveVertexLocation,
} from "@/lib/ai/vertexLocationValue";

test("defaults missing and blank locations to the supported regional endpoint", () => {
  assert.equal(normalizeVertexLocation(undefined), DEFAULT_VERTEX_LOCATION);
  assert.equal(normalizeVertexLocation(null), DEFAULT_VERTEX_LOCATION);
  assert.equal(normalizeVertexLocation("   "), DEFAULT_VERTEX_LOCATION);
});

test("rejects multi-region and global values that cannot form regional hostnames", () => {
  for (const value of ["us", "US", "eu", "EU", "global", "GLOBAL"]) {
    assert.equal(
      normalizeVertexLocation(value),
      DEFAULT_VERTEX_LOCATION,
      `${value} must fail safely to the supported region`,
    );
  }
});

test("rejects malformed and zonal values before endpoint construction", () => {
  for (const value of ["us_central1", "us-central1-a", "not-a-region", "123"]) {
    assert.equal(
      normalizeVertexLocation(value),
      DEFAULT_VERTEX_LOCATION,
      `${value} must not be interpolated into an API hostname`,
    );
  }
});

test("normalizes valid regional locations", () => {
  assert.equal(normalizeVertexLocation(" US-EAST1 "), "us-east1");
  assert.equal(normalizeVertexLocation("europe-west4"), "europe-west4");
  assert.equal(
    normalizeVertexLocation("northamerica-northeast1"),
    "northamerica-northeast1",
  );
});

test("GOOGLE_CLOUD_LOCATION takes precedence when it is nonblank", () => {
  assert.equal(
    resolveVertexLocation("europe-west4", "us-east1"),
    "europe-west4",
  );
});

test("a blank location falls through to GOOGLE_CLOUD_REGION", () => {
  assert.equal(resolveVertexLocation("  ", "us-east1"), "us-east1");
});

test("an invalid higher-priority location fails closed instead of bypassing to region", () => {
  assert.equal(
    resolveVertexLocation("us", "europe-west4"),
    DEFAULT_VERTEX_LOCATION,
  );
});
