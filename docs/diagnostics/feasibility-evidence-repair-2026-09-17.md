# Feasibility evidence and repair recovery

Production test bundle `f9e6b755-bc79-4b56-a9ea-b854a413a297` failed on 2026-09-17 after saving five of six files. The feasibility reviewer correctly rejected invented managers, competitors, geography and financial claims. Both full-document repair requests exhausted their 75-second deadlines. No final package was published.

## Causes verified in code and production

- All seven initial feasibility prompts repeated a concrete fictional Flowery Branch demographic example. Several sections lacked borrower identity and management context.
- Raw research prose was repeatedly promoted to factual authority, while the reviewer used the deterministic study and projection evidence.
- Initial generation selected the latest assumptions without requiring confirmed status or matching the projection package's assumptions ID.
- A broad review could request seven long section rewrites in one response; retrying the same oversized task hit the same deadline.
- The repair exception was swallowed, leaving only content findings visible in the failure message.

## Changes

- Every section receives one common set of borrower identity, management, deterministic dimensions, flags and financial inputs. Remove sample facts and raw research-prose promotion; retained research-derived evidence comes through the calculated dimensions. Missing evidence stays missing. Do not invent citations.
- Prefer the borrower application's legal name for initial narratives and PDF rendering. Give the reviewer that identity, industry and deal location as well.
- Use confirmed assumptions bound to the selected projection package; only fall back to latest confirmed when no assumptions ID exists.
- Limit feasibility rewrites to two sections per request with shorter output. Await every batch and independently review the assembled document. Keep the existing three review/repair cycles and one transient retry per request.
- If any batch fails or violates its section contract, publish no partial rewrite, retain the last reviewed prose, persist a critical repair-failure finding and include it in the bundle error.

## Acceptance and limits

Regression tests cover shared evidence for every section, exclusion of irrelevant research examples, canonical identity in review, bounded repair batches, full-artifact re-review and all-or-nothing timeout recovery. Existing critical review and citation gates remain in place.

Deployment and another live generation are required to prove model behavior and complete the six-file package. This change cannot guarantee a model never invents facts; independent review remains mandatory. No production loan data or schema changes are required. Saved file presence is not a PDF layout, signature or lender-approval check.
