# Buddy Ledger (single source of truth)

| id | date | area | change | why | verify |
|---:|:-----|:-----|:-------|:----|:-------|
| 1 | 2025-12-28 | Borrower Portal | Replace icon text tokens with lucide components | Webfont/icon font brittle in prod; text tokens leaking | Visual: no tokens visible, icons render |
| 2 | 2025-12-28 | Borrower Portal | Isolate borrower route from internal chrome | Borrower UX should not show admin rails/topnav | Borrower route shows no admin chrome |
| 3 | 2025-12-28 | Borrower Portal | Responsive container + proper layout grid | Fix floating fixed-width canvas | Portal centers, scales to mobile/desktop |
| 4 | 2025-12-28 | Borrower Portal | Replace prototype controls with real toolbar | "remove 100% add", chevron text | Real buttons w/ icons + tooltips |
| 5 | 2025-12-28 | Borrower Portal | A11y + keyboard navigation | Production quality | tab order, aria, focus visible |
| 6 | 2025-12-28 | Borrower Portal | E2E smoke test | Prevent regression | Playwright check for icon tokens |
