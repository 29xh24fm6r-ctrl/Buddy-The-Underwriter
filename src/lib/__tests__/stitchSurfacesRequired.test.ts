import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { STITCH_SURFACES } from "@/stitch/stitchSurfaceRegistry";

test("required Stitch surfaces reference StitchSurface", () => {
  const required = STITCH_SURFACES.filter((s) => s.required);

  for (const surface of required) {
    assert.ok(surface.pagePath, `${surface.key} missing pagePath in registry`);
    const absolute = path.resolve(process.cwd(), surface.pagePath!);
    assert.ok(fs.existsSync(absolute), `${surface.key} pagePath missing: ${surface.pagePath}`);
    const content = fs.readFileSync(absolute, "utf8");
    assert.ok(
      content.includes("StitchSurface"),
      `${surface.key} does not reference StitchSurface`,
    );
  }
});
