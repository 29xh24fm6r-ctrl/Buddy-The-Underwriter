# SBA God Mode — Quick Reference

## 🚀 Quick Start

### Execute Agents for a Deal

```typescript
import { orchestrator } from '@/lib/agents';

const result = await orchestrator.executeSBAUnderwritingPipeline({
  deal_id: 'deal-uuid',
  bank_id: 'bank-uuid',
  force_refresh: true, // Skip cache
});
```

### Add UI to Page

```tsx
import AgentCockpit from '@/components/agents/AgentCockpit';

<AgentCockpit dealId={dealId} />
```

---

## 📡 API Endpoints

### Execute Agents
```bash
POST /api/deals/:dealId/agents/execute
Body: { "force_refresh": true }
```

### Get Status
```bash
GET /api/deals/:dealId/agents/status
```

### Get Findings
```bash
GET /api/deals/:dealId/agents/findings?agent=sba_policy
```

---

## 🤖 Available Agents

| Agent | Status | Purpose |
|-------|--------|---------|
| `sba_policy` | ✅ Ready | SBA SOP 50 10 compliance checker |
| `eligibility` | ✅ Ready | SBA eligibility gatekeeper |
| `cash_flow` | ✅ Ready | DSCR calculator with add-backs |
| `risk` | ✅ Ready | Risk synthesizer (orchestrator) |
| `credit` | 🔄 Phase 2 | Credit analysis |
| `collateral` | 🔄 Phase 2 | Collateral analysis |
| `management` | 🔄 Phase 2 | Management experience |
| `narrative` | 🔄 Phase 2 | Credit memo writer |
| `evidence` | 🔄 Phase 2 | Claim verification |
| `banker_copilot` | 🔄 Phase 2 | UX helper |

---

## 🧬 Agent Output Types

### SBA Policy Agent
```typescript
{
  rule_id: "SOP_50_10_6_B_2",
  requirement: string,
  status: "pass" | "fail" | "conditional",
  citation: string,
  explanation: string,
  confidence: number
}[]
```

### Eligibility Agent
```typescript
{
  checks: EligibilityFinding[],
  overall_eligible: boolean,
  fatal_issues: string[]
}
```

### Cash Flow Agent
```typescript
{
  years: CashFlowFinding[],
  global_dscr: number,
  pass: boolean,
  summary: string
}
```

### Risk Synthesis Agent
```typescript
{
  overall_risk: "low" | "moderate" | "high" | "severe",
  top_5_risks: { risk: string, severity: string }[],
  recommend_approve: boolean,
  conditions: string[],
  executive_summary: string,
  agent_consensus: { agent_name, vote, confidence }[]
}
```

---

## 🎨 Confidence Scoring

- **0.90 - 1.00** → Green (high confidence)
- **0.70 - 0.89** → Yellow (medium confidence)
- **0.00 - 0.69** → Red (low confidence, review required)

---

## 🔧 Creating Custom Agents

```typescript
import { Agent } from '@/lib/agents';

class MyAgent extends Agent<MyInput, MyOutput> {
  name = 'my_agent';
  version = 'v1';
  description = 'What this agent does';
  
  validateInput(input: MyInput) {
    return { valid: true };
  }
  
  async execute(input: MyInput, context: AgentContext): Promise<MyOutput> {
    // Your logic here
    return output;
  }
  
  calculateConfidence(output: MyOutput, input: MyInput): number {
    return 0.95;
  }
  
  requiresHumanReview(output: MyOutput): boolean {
    return false;
  }
  
  protected getFindingType(output: MyOutput) {
    return 'requirement';
  }
  
  protected getFindingStatus(output: MyOutput) {
    return 'pass';
  }
}

// Register
import { agentRegistry } from '@/lib/agents';
agentRegistry.register(new MyAgent());
```

---

## 🗄️ Database Queries

### Get Latest Findings
```typescript
import { supabaseAdmin } from '@/lib/supabase/admin';

const sb = supabaseAdmin();
const { data } = await sb
  .from('agent_findings')
  .select('*')
  .eq('deal_id', dealId)
  .eq('bank_id', bankId)
  .order('created_at', { ascending: false });
```

### Filter by Agent
```typescript
.eq('agent_name', 'sba_policy')
```

### Get Findings Requiring Review
```typescript
.eq('requires_human_review', true)
```

---

## 🧪 Testing

### Run Test Script
```bash
./scripts/test-sba-god-mode.sh
```

### Test API Endpoint
```bash
curl -X POST http://localhost:3000/api/deals/DEAL_ID/agents/execute \
  -H "Content-Type: application/json" \
  -d '{"force_refresh": true}'
```

---

## 📊 Agent Dependencies

```
Layer 1 (Independent):
  sba_policy, eligibility, credit, management

Layer 2 (Dependent):
  cash_flow → [credit]
  collateral → [eligibility]

Layer 3 (Synthesis):
  risk → [all Layer 1 + 2]
  narrative → [risk + all]
  evidence → [narrative]

Layer 4:
  banker_copilot → [all]
```

**Orchestrator auto-resolves dependencies via topological sort.**

---

## 🔒 Security Checklist

- ✅ All findings scoped to `bank_id`
- ✅ RLS enabled (deny-all policy)
- ✅ Server-side execution only
- ✅ Audit trail for overrides
- ✅ No client-side agent access

---

## 📚 Documentation

- **Complete Guide:** `SBA_GOD_MODE_COMPLETE.md`
- **Phase 1 Summary:** `SBA_GOD_MODE_PHASE_1_SHIPPED.md`
- **Migration:** `supabase/migrations/20251227000001_create_agent_findings.sql`

---

**Need help?** See [SBA_GOD_MODE_COMPLETE.md](./SBA_GOD_MODE_COMPLETE.md) for detailed docs.
