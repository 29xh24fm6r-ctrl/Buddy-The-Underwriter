import React from "react";
import { createRoot } from "react-dom/client";
import { GuidedPackageWorkspace } from "../../src/components/borrower/intake/GuidedPackageWorkspace";
import { BorrowerWelcome } from "../../src/components/borrower/intake/BorrowerWelcome";
const welcome = new URLSearchParams(location.search).has("welcome");
createRoot(document.getElementById("root")!).render(
  <div className="mx-auto max-w-[1240px] px-4 py-6">
    <a href="/?welcome" className="text-xl font-semibold text-sky-900">
      Buddy
    </a>
    {welcome ? (
      <BorrowerWelcome onGoal={() => {}}>
        <p>Email verification is stubbed in this isolated fixture.</p>
      </BorrowerWelcome>
    ) : (
      <GuidedPackageWorkspace
        dealId="test-deal"
        borrowerName="Alex"
        onSaved={() => {}}
      />
    )}
  </div>,
);
