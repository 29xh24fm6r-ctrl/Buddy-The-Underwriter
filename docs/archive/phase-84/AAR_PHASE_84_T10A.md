# AAR — Phase 84 T-10A — Root hygiene + file archival

**Date:** 2026-04-20
**Ticket:** T-10A (Wave 4 housekeeping)
**Commit:** `6893bb60`
**Completion event:** `buddy_system_events` id `4731646c-3eb2-4fe9-94d9-15a79d3303ac`

## 1. Scope

Archive 100+ root-level markdown files into two purpose-named subdirectories; remove 3 zero-byte artifacts; keep only the 5 canonical operational docs at root.

## 2. Before / after counts (verbatim)

**Before (Step A1):**
```
Total root .md files:        115
Phase-specific (A1b exact):   25   (AAR_PHASE_*, AAR_PHASES_*, PHASE_*_SPEC, _TICKETS, _LAUNCHER, _PART2)
Phase-orphan (A5 catch-all):   5   (PHASE_81_A_PLUS_CERTIFICATION, PHASE_81_CLASSIFICATION_SUPREMACY,
                                    PHASE_82_JOINT_FILER_INTELLIGENCE, PHASE_82_PROOF_OF_TRUTH,
                                    PHASE_83_IGNITE_WIZARD_FINAL)
Operational .md:              80
Keep list .md:                 5
PHASE_4_FILES.txt (non-.md):   1   (separately swept)
Zero-byte artifacts:           3   (funnel, node, buddy-the-underwriter@0.1.0)
```

Spec expected ~113 root .md / ~26 phase-specific / ~82 operational / 3 zero-byte. Actuals within tolerance. The 5 orphans (Phase 81-83) have a different suffix pattern than the 25 strict matches; the Step A5 catch-all `git mv PHASE_*.md` swept them correctly.

**After (Step A8):**
```
Root .md files:                    5  (exactly the keep list)
  README.md
  BUDDY_PROJECT_ROADMAP.md
  BUDDY_BUILD_RULES.md
  DEPLOYMENT.md
  HOTFIX_LOG.md

docs/archive/phase-pre-84/:       31  (30 phase markdowns + PHASE_4_FILES.txt)
docs/archive/operational-pre-84/: 80
Zero-byte artifacts at root:       0  (all 3 removed)
```

Reconciliation: 5 + 31 + 80 = 116 entries. Minus PHASE_4_FILES.txt (1, non-.md) = 115 .md source count. Matches Step A1 total exactly.

## 3. Keep-list (unchanged at root)

- `README.md`
- `BUDDY_PROJECT_ROADMAP.md`
- `BUDDY_BUILD_RULES.md`
- `DEPLOYMENT.md`
- `HOTFIX_LOG.md`

## 4. Archive structure created

- `docs/archive/phase-pre-84/` — phase AARs, specs, tickets, launchers (31 files: 30 .md + 1 .txt)
- `docs/archive/operational-pre-84/` — operational runbooks, audits, quickstarts (80 files)

## 5. Zero-byte artifacts removed

- `funnel` (0 bytes)
- `node` (0 bytes)
- `buddy-the-underwriter@0.1.0` (0 bytes)

## 6. References preserved

`git mv` used throughout — file history is preserved at new paths. `git log --follow` works against the archived files.

Step A3 grep confirmed **zero in-flight references** from `src/` or `scripts/` or any JSON/YAML/TOML config to root-level markdown filenames that moved. Archival does not break any runtime imports or CI config.

## 7. Follow-up

T-09 will update `BUDDY_PROJECT_ROADMAP.md` to cite archived files at their new `docs/archive/phase-pre-84/` paths where needed. No other in-flight references to moved files were found during pre-work grep.

## 8. Spec deviations

One minor observation, not a deviation: Step A1's strict-pattern grep (A1b) under-counts by 5 because 5 Phase 81-83 files use descriptive suffixes (`_A_PLUS_CERTIFICATION`, `_CLASSIFICATION_SUPREMACY`, `_JOINT_FILER_INTELLIGENCE`, `_PROOF_OF_TRUTH`, `_IGNITE_WIZARD_FINAL`) instead of the 4 anchor suffixes (`_SPEC`, `_TICKETS`, `_LAUNCHER`, `_PART2`). Step A5's catch-all `git mv PHASE_*.md` handled them correctly — no code change needed. Flagged here so future similar tickets can count accurately on first pass.
