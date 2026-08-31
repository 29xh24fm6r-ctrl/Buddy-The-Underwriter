# Commissioning records

Each commissioning change gets its own file. The shared ledger is an
append-only historical record, not the place to write new work.

## Adding a record

Create one file:

```
docs/commissioning/arcs/<YYYY-MM-DD>-<short-slug>.md
```

One file per PR. Do not add a matching section to
`BUDDY_CONTINUOUS_COMMISSIONING_LEDGER.md` — that duplication is what this
convention exists to stop (see below).

Structure the file the way the existing arcs do:

```markdown
# <Title> — <YYYY-MM-DD>

Scope: Buddy The Underwriter production only.

## Evidence and root cause
## Repair
## Regression coverage
```

## Why not the ledger

The ledger is one file that every PR appended a section to, at the end. Git
sees two branches adding different text at the same final line as a conflict,
so every merge to `main` made every other open PR unmergeable — even though no
two PRs ever disagreed about anything. Each one then had to be resolved by
hand, and merging any of those resolutions re-broke the rest.

Across one batch of 19 PRs that cascade fired six times and produced roughly
eighty hand-resolved conflicts. Every single one was two sides adding, never
two sides changing the same text.

A per-PR file has no shared final line, so it cannot collide. The 40+ files
already in `arcs/` never conflicted once during that batch. Only the ledger
did.

## The ledger today

`BUDDY_CONTINUOUS_COMMISSIONING_LEDGER.md` keeps its existing history — nothing
was migrated out of it, because rewriting it would have conflicted with every
PR then in flight. It is now closed to new entries.

`.gitattributes` marks it `merge=union` so that any straggler appends from
branches opened before this convention merge cleanly instead of blocking.
That is a safety net for the transition, not a licence to keep appending: a
union-merged file never reports a conflict, so two branches revising the same
historical entry would be silently duplicated rather than flagged.

Two follow-ups were deliberately left out of the change that introduced this
file, and are worth doing once the in-flight batch has drained:

- A CI guard failing any PR that adds a `##` section to the ledger. It was not
  added immediately because every open PR at the time still carried one, so the
  guard would have turned a documentation change into a wall of red checks.
- Migrating the ledger's existing sections into `arcs/` and reducing it to an
  index. Same reason: a wholesale rewrite conflicts with everything open.

Five older records sit directly in `docs/commissioning/` rather than in
`arcs/`. They are left where they are; new ones go in `arcs/`.
