# Buddy - The Private Supervisory Authority for Your Bank

## Positioning Statement

**Buddy is the first banking operating system that thinks like a regulator.**

Not "loan origination software."  
Not "underwriting automation."  
Not "document management."

Buddy is the governance infrastructure that separates banks regulators trust from banks they don't.

---

## The Problem (Real Talk)

### Banks face an impossible choice:

**Move fast** → Exception creep → Policy drift → Examiner criticism → Consent orders  
**Move slow** → Manual everything → Underwriter bottleneck → Profit erosion → Get acquired

### Traditional "solutions" make it worse:

- **LOS systems**: Track the loan, not the decision logic
- **Workflow tools**: Automate the wrong things
- **Document vaults**: Store files, not evidence
- **Dashboards**: Show metrics, not systemic risk

### What examiners actually want to see:

1. "Show me your credit policy" → **You produce a PDF from 2019**
2. "How do you enforce it?" → **You describe a manual checklist**
3. "Why did you approve this loan?" → **You forward an email thread**
4. "Who signed off?" → **You search Outlook for 'approved'**
5. "What happens under stress?" → **You... don't know**

**This is not a technology problem. It's an architecture problem.**

---

## What Buddy Actually Does

Buddy is not "AI underwriting."  
Buddy is **governance-grade decision infrastructure**.

### Three architectural principles:

#### 1. **AI explains, rules decide**
- AI generates explanations, confidence scores, and suggestions
- Deterministic code controls all decision logic
- No black boxes. No "the AI approved it."
- Examiners understand it instantly.

#### 2. **Everything is replayable**
- Every decision creates an immutable snapshot
- Hash-verified. Timestamped. Attested.
- You can replay any decision from 6 months ago
- You can replay it with different inputs ("what if")
- You can diff two decisions side-by-side

#### 3. **Micro → Macro supervision**
- Individual decisions roll up to portfolio risk
- Portfolio risk informs policy updates
- Policy updates prevent future exceptions
- The system becomes self-correcting

---

## The Buddy Stack (What You Actually Get)

### Decision OS (Micro-Level)
Every underwriting decision generates:
- **Evidence Catalog**: What documents were analyzed + quality scores
- **Policy Evaluation**: How inputs compare to stated policy
- **Decision Snapshot**: Immutable record with hash verification
- **Confidence Score**: AI-powered uncertainty quantification
- **Attestation Chain**: Multi-party signoff with role requirements
- **Regulator-Grade PDF**: Letterhead + hash + QR code verification
- **Regulator ZIP Bundle**: 7-file export for examination

### Governance System (Institutional-Level)
Banks define governance rules:
- **Attestation Policies**: Required signatories + roles (e.g., 3 signoffs: underwriter, credit chair, CRO)
- **Committee Policies**: Triggers for credit committee review (e.g., loan amount >$500K, DSCR <1.15)
- **Credit Committee Voting**: Real-time voting with quorum logic + veto power
- **Committee Minutes**: AI-generated meeting narratives (regulator-grade)
- **Dissent Capture**: Formal disagreement records (minority opinions)
- **Override Audit Trail**: Every policy exception documented + explained

### Macro-Prudential Intelligence (Systemic-Level)
System-wide risk monitoring:
- **Portfolio Aggregation**: Daily snapshot of total exposure, RWA, exception rates
- **Stress Testing**: Replay portfolio under shock scenarios (e.g., "DSCR -20%")
- **Policy Drift Detection**: Compare actual decisions to stated policy ("your bank behaves as if DSCR = 1.12, not 1.25")
- **Living Credit Policy**: AI suggests policy updates based on drift patterns
- **Counterfactual Decisions**: "What if we removed all exceptions?"
- **Board-Ready Quarterly Packs**: AI-generated board presentations

### Canonical Access Pages
Everything is one click from `/governance`:
- **/governance** → Governance hub (attestation status, committee roster, recent decisions)
- **/portfolio** → System-wide metrics, stress tests
- **/committee** → Voting center, dissent, minutes
- **/policy** → Living policy, extracted rules, drift indicators
- **/risk** → Behavioral patterns, early-warning signals
- **/examiner** → Read-only regulator view (yellow banner, QR exports)

---

## Who This Is For

### Not for:
- Banks that want "AI to do underwriting for us"
- Banks that think governance is a checkbox
- Banks that don't care what examiners think

### Built for:
- **Community banks** preparing for first examination
- **Regional banks** scaling beyond "everyone knows everyone"
- **SBA lenders** who live and die by policy compliance
- **Credit unions** tired of examiner findings about "informal processes"
- **De novos** who need governance from day one

---

## The Regulatory Moment

### Why now?

**2024-2025 regulatory environment:**
- FDIC/OCC increased scrutiny on "alternative data" and "AI models"
- Consent orders targeting "policy exceptions without documentation"
- Examiner training emphasizes "governance infrastructure," not "process compliance"
- Banks getting criticized for "can't demonstrate policy enforcement"

**What examiners want:**
- Replayable decisions
- Attestation chains
- Stress test results
- Policy drift reports
- Counterfactual analysis

**What traditional LOS provides:**
- Loan application PDFs
- Approval timestamps
- Email trails

**What Buddy provides:**
- Everything examiners want, out of the box

---

## Competitive Landscape

### Why banks can't replicate this:

**Not a feature problem. It's an architecture problem.**

Banks try to build this with:
- SharePoint + Docusign + Excel = "governance"
- LOS customization + PowerBI = "portfolio monitoring"
- Email threads + meeting minutes = "attestation chain"

**This doesn't work because:**
1. No immutable snapshots → Can't replay decisions
2. No hash verification → Can't prove integrity
3. No portfolio aggregation → Can't detect drift
4. No stress testing → Can't quantify risk
5. No canonical pages → Can't navigate the system

**Buddy is not "workflow automation."**  
**Buddy is decision infrastructure.**

You can't patch this onto an LOS.  
You can't build this with low-code tools.  
You can't hire your way out of missing architecture.

---

## Why This Exists

Founder story (if needed):

"I spent 3 years building credit risk models at [BANK_NAME].  
Every exam, same conversation:  
Examiner: 'Show me how you enforce your credit policy.'  
Us: 'Here's our manual checklist.'  
Examiner: 'How do you know it was followed?'  
Us: 'We... trust our underwriters.'

**Banks don't have a trust problem. They have a provability problem.**

Buddy makes decisions provable."

---

## Pricing Philosophy

**Not priced per loan. Priced per bank.**

Why?
- Governance is infrastructure, not transaction cost
- Encourages adoption (no "should we run this through Buddy?" questions)
- Aligns incentives (we want you to use it for everything)

**Pricing tiers:**
- **Community**: <$500M assets, 1-3 users, core Decision OS
- **Regional**: $500M-$5B assets, unlimited users, full governance stack
- **Enterprise**: >$5B assets, multi-bank, custom integrations

**All tiers include:**
- Decision OS (unlimited decisions)
- Governance system
- Canonical access pages
- Examiner mode
- Support

**Add-ons:**
- Macro-prudential intelligence ($X/month)
- Living credit policy ($X/month)
- Board-ready quarterly packs ($X/quarter)
- White-label deployment ($X setup + $X/month)

---

## The Demo (Regulator-First)

**Start with examiner mode.**

Not "here's how you upload documents."  
Not "here's how AI helps underwriters."

**Start with: "Here's what your examiner sees."**

1. Show `/examiner` page
   - Yellow banner (read-only)
   - Searchable decisions
   - Summary stats (final decisions, committee decisions, attestations)

2. Click a decision
   - Evidence catalog (what docs, quality scores)
   - Policy evaluation (inputs vs. thresholds)
   - Decision snapshot (hash-verified)
   - Attestation chain (who signed, when, role)

3. Download regulator ZIP
   - 7 files (snapshot, attestations, votes, minutes, dissent, hash, manifest)
   - Open `hash.txt` → Show SHA-256
   - Open `manifest.json` → Show integrity proof

4. Scan QR code
   - Links to public `/api/verify/{hash}`
   - Shows complete attestation chain
   - No login required (regulator-friendly)

5. **Then show banker view:**
   - `/governance` → Policy compliance dashboard
   - `/committee` → Real-time voting
   - `/policy` → Living credit policy with drift indicators
   - `/portfolio` → Stress test results

**The hook:**  
"This is what your next examiner will ask for. Can your current system do this?"

---

## Launch Narrative (Social/Email)

**Subject: We built the system regulators expect banks to have**

Banks spend millions on LOS, CRM, and core banking.  
But when examiners ask:  
- "How do you enforce your credit policy?"  
- "Show me your attestation chain"  
- "What happens to your portfolio under stress?"

Most banks forward email threads and Excel files.

**Buddy is different.**

We're not loan origination software.  
We're not underwriting automation.  
We're governance infrastructure.

Every decision creates:
- Immutable snapshot (hash-verified)
- Attestation chain (multi-party signoff)
- Evidence catalog (document quality + policy evaluation)
- Regulator-ready export (PDF + ZIP + QR verification)

Your portfolio aggregates into:
- Stress test results
- Policy drift detection
- Living credit policy (AI-suggested updates)
- Board-ready quarterly packs

Everything is replayable.  
Everything is auditable.  
Everything is defensible.

This is how supervisors think.  
Now it's how your bank operates.

**Buddy v1.0.0 is live.**

Book a demo: [LINK]  
See examiner mode: [LINK]  
Read the architecture: [LINK]

---

Built for banks regulators trust.

---

## FAQs

**Q: Is this AI underwriting?**  
A: No. AI generates explanations and confidence scores. Deterministic code controls all decision logic. "AI explains, rules decide."

**Q: Does this replace our LOS?**  
A: No. Buddy sits upstream of your LOS. We handle decision-making, governance, and attestation. Your LOS handles servicing and compliance.

**Q: What if we don't have a credit policy?**  
A: Buddy can extract rules from your existing policy documents (AI-powered). You approve the extracted rules, then Buddy enforces them.

**Q: How long does implementation take?**  
A: 1-2 weeks for core Decision OS. 2-4 weeks for full governance stack. We run migrations, configure policies, and train users.

**Q: What happens if we get examined tomorrow?**  
A: You activate examiner mode (`?examiner=true`), give the examiner read-only access, and they see every decision with full attestation chains. No scrambling.

**Q: Can we white-label this?**  
A: Yes. Enterprise tier includes white-label deployment (your domain, your branding).

**Q: Do you sell our data?**  
A: Never. Your decisions, your data, your governance. We don't train models on your portfolio.

---

## Call to Action

**For banks:**  
Book a demo → See examiner mode → Walk through governance flow → Get pricing

**For regulators/consultants:**  
Request access → See full system → Provide feedback → Pilot with client bank

**For investors:**  
Read the architecture docs → Understand the moat → See the roadmap → Let's talk

---

**Buddy v1.0.0 is live.**  
**The first bank to deploy this has a 3-year head start.**

https://github.com/29xh24fm6r-ctrl/Buddy-The-Underwriter
