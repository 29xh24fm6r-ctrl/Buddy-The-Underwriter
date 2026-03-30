import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

describe("Cockpit structure — phantom panel guard", () => {
  it("cockpit/page.tsx does not directly import DealHealthPanel", () => {
    const content = fs.readFileSync(
      path.resolve("src/app/(app)/deals/[dealId]/cockpit/page.tsx"),
      "utf-8",
    );
    const importLines = content.split("\n").filter(
      (l) => l.includes("import") && !l.trim().startsWith("//") && !l.trim().startsWith("*"),
    );
    assert.ok(
      !importLines.some((l) => l.includes("DealHealthPanel")),
      "cockpit/page.tsx must not import DealHealthPanel — canonical home is StoryPanel",
    );
  });

  it("cockpit/page.tsx does not directly import BankerVoicePanel", () => {
    const content = fs.readFileSync(
      path.resolve("src/app/(app)/deals/[dealId]/cockpit/page.tsx"),
      "utf-8",
    );
    const importLines = content.split("\n").filter(
      (l) => l.includes("import") && !l.trim().startsWith("//") && !l.trim().startsWith("*"),
    );
    assert.ok(
      !importLines.some((l) => l.includes("BankerVoicePanel")),
      "cockpit/page.tsx must not import BankerVoicePanel — canonical home is StoryPanel",
    );
  });

  it("StoryPanel still contains DealHealthPanel", () => {
    const content = fs.readFileSync(
      path.resolve("src/components/deals/cockpit/panels/StoryPanel.tsx"),
      "utf-8",
    );
    assert.ok(
      content.includes("DealHealthPanel"),
      "StoryPanel must retain DealHealthPanel as its canonical home",
    );
  });

  it("StoryPanel still contains BankerVoicePanel", () => {
    const content = fs.readFileSync(
      path.resolve("src/components/deals/cockpit/panels/StoryPanel.tsx"),
      "utf-8",
    );
    assert.ok(
      content.includes("BankerVoicePanel"),
      "StoryPanel must retain BankerVoicePanel as its canonical home",
    );
  });
});
