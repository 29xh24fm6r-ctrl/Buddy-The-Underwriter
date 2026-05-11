# SPEC-<NAME> — <One-line description>

**Status:** Draft / Final.
**Branch:** `feat/<branch-name>` off `<base>`
**Workstream:** <which larger workstream this belongs to, or "Standalone">
**Estimate:** <time estimate>

---

## PIV (Problem, Invariant, Verification)

### Problem
<What's wrong. Be specific. Cite file paths, error messages, or behaviors.>

### Invariant
<Table of: surface | behavior after fix. One row per affected surface.>

### Verification (V-N)
<Numbered list of acceptance criteria. Each is independently testable.>

---

## §0 — Verify the problem still exists

**Mandatory for any spec motivated by a standing-memory item, a long-carried backlog entry, or a "queued" problem.**

Before writing any code, confirm the problem is present on current main HEAD via a direct, reproducible check. Examples:

- "CI red on main" → run `pnpm typecheck` (or whatever command), capture output, confirm it actually fails.
- "Stale data in <table>" → run a SQL count, confirm the stale rows are still there.
- "Bug in <file>" → read the file at HEAD via `git show main:<path>`, confirm the bug is still present.

If the check shows the problem is already resolved, STOP. Close the spec as "already-fixed" and update any standing-memory entry that motivated it. Do not write code against a no-op.

The cost of this section is ~30 seconds. The cost of skipping it and writing a spec against a stale problem is one full Claude Code session plus the human-review time on top.

This section is OPTIONAL for specs motivated by fresh observations (e.g. "I just hit this bug in dev five minutes ago"). It is MANDATORY for specs motivated by anything older than the current chat session.

---

## Scope

<Each deliverable as its own §N section. Verbatim code blocks for changes. Hard non-goals at the end.>

### Hard non-goals
<Bulleted list of explicit "don't touch" items.>

---

## Risk register

<Table: Risk | Likelihood | Impact | Mitigation>

---

## Hand-off commit message

```
<final commit message for the squash merge or feature commit>
```

---

## Addendum for Claude Code

**Read-before-coding checklist:**
<numbered list of files Claude Code must read before coding>

**Implementation order (mandatory):**
<numbered steps, with verification gates between each>

**AAR verification requirements (do not request approval without ALL of these):**
<numbered list of evidence Claude Code must produce>

---

**End of spec.** Copy everything above "End of spec" to Claude Code, starting with the PIV.
