# Stripe checkout trust boundary — 2026-08-30

## Scope

Buddy The Underwriter pricing-to-Stripe Checkout flow only.

## Evidence

- The public pricing component submitted a browser-visible price id.
- The server accepted any supplied Stripe price without authentication.
- Redirect URLs trusted the caller-controlled Origin header.
- Stripe exception messages were returned to the caller.
- Checkout sessions were not bound to Buddy's canonical actor identity.

## Repair

- Require the bounded Clerk-to-profile actor context before Stripe access.
- Select the Pro price only from server deployment configuration.
- Reject conflicting caller-supplied prices during compatibility rollout.
- Use the configured Buddy public origin for success and cancellation.
- Bind the canonical actor id into Checkout and subscription metadata.
- Bound request bodies at 8 KiB.
- Require an HTTPS Checkout URL and return deterministic safe failures.
- Send signed-out pricing users to the normal sign-in path.

## Regression coverage

Behavioral route tests cover authentication, configured price enforcement, actor metadata, hostile Origin input, body limits, safe provider failures, HTTPS URL proof, and missing configuration.

## Production closure

After merge, verify one authorized Stripe test-mode Checkout session carries the expected actor and plan metadata, uses the configured Pro price, and returns only to www.buddysba.com. Never create a live charge during commissioning.
