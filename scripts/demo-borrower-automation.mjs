#!/usr/bin/env node

/**
 * Borrower Automation Demo Script
 * 
 * Simulates the complete borrower automation flow:
 * 1. Create test deal with conditions
 * 2. Simulate borrower upload (updates activity timestamp)
 * 3. Run automation to detect stalls
 * 4. Verify draft messages created
 * 5. Approve and send message
 * 6. Verify borrower sees notification
 * 
 * Usage:
 *   node scripts/demo-borrower-automation.mjs <dealId>
 */

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

async function demo(dealId) {
  console.log("🚀 Borrower Automation Demo");
  console.log(`Deal ID: ${dealId}\n`);

  // Step 1: Check existing conditions
  console.log("📋 Step 1: Fetching conditions...");
  const r1 = await fetch(`${BASE_URL}/api/deals/${dealId}/conditions`);
  const j1 = await r1.json();
  console.log(`   Found ${j1.conditions?.length ?? 0} conditions`);
  const outstanding = j1.conditions?.filter((c) => c.status !== "satisfied") ?? [];
  console.log(`   Outstanding: ${outstanding.length}\n`);

  if (outstanding.length === 0) {
    console.log("⚠️  No outstanding conditions. Create some first.");
    return;
  }

  // Step 2: Run automation
  console.log("🤖 Step 2: Running automation...");
  const r2 = await fetch(`${BASE_URL}/api/automation/borrower-nudges/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deal_id: dealId }),
  });
  const j2 = await r2.json();
  console.log(`   Drafted ${j2.drafted ?? 0} nudge messages\n`);

  if ((j2.drafted ?? 0) === 0) {
    console.log("ℹ️  No stalled conditions (or throttled). Conditions may be recent.");
    return;
  }

  // Step 3: View draft messages
  console.log("📧 Step 3: Fetching draft messages...");
  const r3 = await fetch(`${BASE_URL}/api/deals/${dealId}/messages?status=DRAFT`);
  const j3 = await r3.json();
  const drafts = j3.messages ?? [];
  console.log(`   Drafts: ${drafts.length}`);
  drafts.forEach((msg, i) => {
    console.log(`   ${i + 1}. ${msg.subject}`);
    console.log(`      Priority: ${msg.priority}`);
    console.log(`      Stall: ${msg.metadata?.stall_reason ?? "N/A"}\n`);
  });

  // Step 4: Approve first message
  if (drafts.length > 0) {
    console.log("✅ Step 4: Approving first message...");
    const msgId = drafts[0].id;
    const r4 = await fetch(
      `${BASE_URL}/api/deals/${dealId}/messages/${msgId}/send`,
      { method: "POST" }
    );
    const j4 = await r4.json();
    console.log(`   Sent: ${j4.ok ? "✓" : "✗"}\n`);
  }

  // Step 5: Borrower view (simulate)
  console.log("👤 Step 5: Borrower perspective...");
  console.log(`   Visit: ${BASE_URL}/borrower`);
  console.log(`   Borrower will see updated checklist + portal notifications\n`);

  console.log("🎉 Demo complete!");
  console.log("\nNext steps:");
  console.log("  1. Wire upload → recordBorrowerActivity()");
  console.log("  2. Wire classification → triggerConditionRecompute()");
  console.log("  3. Add scheduled automation (cron)");
  console.log("  4. Enable email delivery");
}

const dealId = process.argv[2];
if (!dealId) {
  console.error("Usage: node scripts/demo-borrower-automation.mjs <dealId>");
  process.exit(1);
}

demo(dealId).catch(console.error);
