# Buddy - Examiner Demo Script

## Overview
This is the regulator-first demo. Start with what examiners want to see, then show banker workflows.

**Duration**: 15-20 minutes  
**Audience**: Bank executives, compliance officers, or actual examiners  
**Objective**: Prove Buddy provides what regulators expect banks to have

---

## Pre-Demo Setup

### Test Data Required:
- 1 test bank with letterhead uploaded
- 3-5 final decisions with attestation chains
- 1 decision that required committee vote
- 1 decision with dissent opinion
- Attestation policy configured (e.g., 3 signoffs required)
- Committee policy configured (e.g., loans >$500K)

### URLs to Have Ready:
- `/examiner` - Examiner homepage
- `/deals/{dealId}/decision?examiner=true` - Sample decision in examiner mode
- `/api/verify/{hash}` - Public verification endpoint
- `/governance` - Governance dashboard
- `/portfolio` - Portfolio metrics

---

## Part 1: The Examiner's View (7 minutes)

### Script:

**"Let me show you what your examiner will see."**

#### 1.1 Examiner Mode Entry (1 min)

Navigate to: `/examiner`

**Point out:**
- Yellow banner: "Examiner Mode — Read-only snapshot view"
- Summary stats:
  - X final decisions
  - Y committee decisions
  - Z total attestations
- Searchable decision list

**Say:**  
*"This is the entry point for examiners. No login required if we give them a direct link. Everything is read-only. No actions permitted."*

---

#### 1.2 Individual Decision View (3 min)

Click any decision → redirects to `/deals/{dealId}/decision?examiner=true`

**Point out:**
1. **Yellow examiner banner** (confirms read-only mode)
2. **Evidence Catalog**:
   - "Here's every document we analyzed"
   - Quality scores (text layer, table detection)
   - Upload timestamps
3. **Policy Evaluation**:
   - "Here's how the borrower's numbers compare to our stated policy"
   - DSCR, LTV, loan amount thresholds
   - Policy compliance indicators
4. **Decision Badge**:
   - Approve/Decline/Conditional
   - Confidence score (AI-generated)
5. **Attestation Status**:
   - "3 of 3 required signoffs complete"
   - Attestation timestamps
   - Signatory roles (underwriter, credit chair, CRO)

**Say:**  
*"This is a complete audit trail. Every input, every document, every signoff. Immutable. Hash-verified. Timestamped."*

---

#### 1.3 Regulator ZIP Export (2 min)

Click "Download Regulator ZIP"

**Open the ZIP and show:**
1. **decision_snapshot.json**: Complete decision record
2. **attestations.json**: All signatories with timestamps
3. **committee_votes.json**: Individual votes (if applicable)
4. **committee_minutes.txt**: AI-generated meeting narrative
5. **dissent.json**: Minority opinions (if applicable)
6. **hash.txt**: SHA-256 integrity hash
7. **manifest.json**: Export metadata + verification URL

**Say:**  
*"This is what we hand to examiners. Everything in one ZIP. No scrambling. No email threads. No 'let me find that.'"*

**Open `hash.txt`:**  
*"This SHA-256 hash proves the decision hasn't been tampered with. Cryptographic integrity."*

**Open `manifest.json`:**  
*"Here's the verification URL. Anyone can verify this decision without logging in."*

---

#### 1.4 QR Code Verification (1 min)

**In the decision PDF:**  
Show QR code in footer

**Scan with phone:**  
Links to: `/api/verify/{hash}`

**Browser opens, shows:**
- ✅ Valid decision snapshot
- Verified at: [timestamp]
- Snapshot summary (deal name, decision, date)
- Complete attestation chain
- Chain of custody (who attested, when, role)

**Say:**  
*"The QR code links to a public verification endpoint. No login. No portal. Just proof. Examiners can verify this on their phone."*

---

## Part 2: The Banker's View (8 minutes)

**"Now let me show you how bankers actually use this."**

### 2.1 Governance Dashboard (2 min)

Navigate to: `/governance`

**Point out:**
1. **Attestation Policy Status**:
   - Required count: 3
   - Required roles: underwriter, credit chair, CRO
2. **Committee Policy Status**:
   - Enabled: Yes
   - Trigger rules: 4 defined (loan amount, DSCR, LTV, etc.)
3. **Committee Roster**:
   - X active members
4. **Recent Decisions**:
   - Last 10 decisions with status badges

**Say:**  
*"This is the governance hub. Everything is one click from here. Policy status, committee roster, recent decisions."*

---

### 2.2 Credit Committee Center (2 min)

Navigate to: `/committee`

**Point out:**
1. **Active Decisions Awaiting Vote**:
   - Decisions that triggered committee review
   - "Awaiting Vote" badges
2. **Committee Roster**:
   - All voting members displayed
3. **Recent Committee Decisions**:
   - Historical votes with outcomes

**Click a decision requiring committee:**

**Show:**
- Real-time vote tallies
- Individual votes (approve/conditional/decline)
- Comments from voters
- Quorum status
- Outcome (approve/decline/pending)

**Say:**  
*"Committee members vote here. Real-time tallies. Quorum logic. Veto power for declines. Everything documented."*

---

### 2.3 Living Credit Policy (2 min)

Navigate to: `/policy`

**Point out:**
1. **Active Committee Policy**:
   - Trigger rules displayed
   - Policy status (enabled/disabled)
2. **Active Attestation Policy**:
   - Required signatories
   - Required roles
3. **AI-Extracted Policy Rules**:
   - Rules extracted from uploaded policy PDFs
   - Pending approval vs. approved
   - Rationale for each rule

**Say:**  
*"We extract enforceable rules from your policy documents. AI suggests rules, you approve them. Then Buddy enforces them automatically."*

**Show pending suggestion:**
- Rule key: `dscr_min`
- Current value: `1.25`
- Suggested change: `1.20`
- Rationale: "15% of decisions violate current threshold. Suggests threshold may be too strict for actual risk appetite."

**Say:**  
*"This is the 'living' part. Buddy detects when your actual behavior drifts from stated policy. Then suggests updates. You decide whether to accept them."*

---

### 2.4 Portfolio Risk Dashboard (2 min)

Navigate to: `/portfolio` (or show risk page if Stitch design isn't ready)

**Point out:**
1. **Key Metrics**:
   - Total exposure: $X.XM
   - Risk-weighted assets: $X.XM
   - Exception rate: X.X%
   - Committee override rate: X.X%
2. **Concentration Analysis**:
   - By loan size (bar chart or table)
   - By decision type (approve/decline)
3. **Stress Test Results** (if available):
   - Recent scenario: "20% DSCR deterioration"
   - Approvals flipped to decline: X
   - Capital at risk: $X.XM

**Say:**  
*"This is the macro view. System-wide risk. Stress tests. Policy drift. This is how supervisors think about your bank."*

---

## Part 3: The "Aha" Moment (3 minutes)

### Script:

**"Let me tie this together."**

**Pull up two screens side-by-side:**
1. Left: Examiner mode (`/examiner`)
2. Right: Banker view (`/governance`)

**Point out:**
- **Same data, different permissions**
- Examiner sees everything (read-only)
- Banker can act (vote, attest, configure)
- No "export for examiner" step
- No "prepare for exam" scramble

**Say:**  
*"When you get examined, you don't export anything. You just give the examiner a link. They see everything. Immutable. Hash-verified. Attested. Defensible."*

---

### Key Questions to Ask:

**"Can your current system do this?"**
- Show replayable decisions?
- Prove attestation chain?
- Generate regulator ZIP?
- Verify with QR code?
- Detect policy drift?
- Run stress tests?

**"How do you currently answer these questions?"**
- "Show me your credit policy" → ?
- "How do you enforce it?" → ?
- "Why did you approve this loan?" → ?
- "Who signed off?" → ?
- "What happens under stress?" → ?

---

## Part 4: The Close (2 minutes)

### Script:

**"Three things set Buddy apart:"**

1. **Architecture, not features**
   - Not "workflow automation"
   - Not "AI underwriting"
   - This is governance infrastructure
   - Banks can't replicate this with customization

2. **Regulator-first design**
   - Built for what examiners actually ask for
   - Not built for bankers who ignore examiners
   - Examiner mode, attestation chains, stress tests
   - This is what regulators expect banks to have

3. **You're not buying software. You're buying 3 years of head start.**
   - First bank to deploy this has a competitive moat
   - Examiner credibility
   - Faster approvals (less manual process)
   - Scalable governance (doesn't break at 100 decisions)

---

### Call to Action:

**"Next steps:"**

1. **Technical diligence** (2 weeks)
   - Deploy to staging
   - Run 10 test decisions
   - Walk through governance flow
   - Review database schema

2. **Policy configuration** (1 week)
   - Upload credit policy PDFs
   - Approve extracted rules
   - Configure attestation policy
   - Configure committee policy

3. **Pilot with real deals** (4 weeks)
   - 10-20 real decisions
   - Real committee votes
   - Real attestations
   - Collect feedback

4. **Go-live** (1 week)
   - Train all users
   - Migrate historical decisions (optional)
   - Deploy to production
   - Monitor for 30 days

**Total time to production: 6-8 weeks**

---

## Common Objections & Responses

### Objection: "We already have an LOS"
**Response:**  
*"Buddy doesn't replace your LOS. We sit upstream. You make the decision in Buddy. You service the loan in your LOS. Think of it as decision infrastructure, not loan servicing."*

---

### Objection: "Our underwriters won't trust AI"
**Response:**  
*"Good. They shouldn't. AI doesn't make decisions in Buddy. AI generates explanations and confidence scores. Deterministic code controls all decision logic. 'AI explains, rules decide.'"*

---

### Objection: "This looks complicated"
**Response:**  
*"It's not complicated. It's comprehensive. The complexity is hidden from underwriters. They see a simple decision form. The governance infrastructure runs in the background. Examiners see the full audit trail. Users see simplicity."*

---

### Objection: "Can't we build this internally?"
**Response:**  
*"You could. Most banks try. They fail because this isn't a feature problem. It's an architecture problem. You can't patch this onto an LOS. You can't build immutable snapshots with SharePoint. You can't build stress testing with Excel. This took us 2 years. You want to spend 2 years before your next exam?"*

---

### Objection: "What if we're not examined this year?"
**Response:**  
*"Then you're ahead. When you do get examined, you'll be the only bank that shows up with this. While competitors scramble with email threads, you hand over a regulator ZIP. That's examiner credibility. That's how you get 'well-controlled.'"*

---

## Demo Tips

### Do:
- Start with examiner mode (not banker features)
- Show QR verification on your phone (tangible proof)
- Open the regulator ZIP and walk through files
- Use real-looking test data (not "John Doe")
- Ask "can your current system do this?" repeatedly

### Don't:
- Don't lead with AI (regulators are skeptical)
- Don't show code (keep it black-box)
- Don't promise "faster underwriting" (governance takes time)
- Don't skip the attestation chain (it's the key differentiator)
- Don't oversell (let the system speak for itself)

---

## Post-Demo Follow-Up

### Email Template:

**Subject: Buddy Demo Follow-Up - Regulator-Ready Governance**

Hi [Name],

Thanks for the demo today. As promised, here are the key links:

**Examiner Mode:**  
[Link to /examiner with sample decisions]

**Sample Regulator ZIP:**  
[Attached or download link]

**QR Code Verification:**  
[Link to /api/verify/{hash}]

**Architecture Overview:**  
[Link to GitHub or documentation]

**Next Steps:**
1. Review the regulator ZIP structure
2. Share with compliance/credit team
3. Schedule technical diligence call (2 hours)
4. Propose pilot timeline (6-8 weeks)

**Questions?**  
[Your contact info]

**The first bank to deploy this infrastructure has a 3-year head start.**

Best,  
[Name]

---

## Success Metrics

**Demo is successful if:**
- [ ] They say "can we verify that QR code right now?"
- [ ] They download and open the regulator ZIP
- [ ] They ask "can this replace our current process?"
- [ ] They mention upcoming examination
- [ ] They schedule technical diligence call

**Demo failed if:**
- They say "we already have this"
- They focus on "AI underwriting" benefits
- They want feature parity with their LOS
- They don't understand the governance value prop

---

**Remember: This is not loan software. This is governance infrastructure.**

**Banks buy this to survive examinations, not to "move faster."**

**Sell credibility, not efficiency.**
