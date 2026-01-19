# Underwrite Preview Runbook

## Purpose
Quickly locate the correct Vercel preview URL for the current branch and validate that `/underwrite/[dealId]` auto-initializes intake + checklist.

## Get the latest preview URL

```
pnpm -s vercel:preview:url
```

If Vercel CLI is not installed or not authenticated, install/login and re-run:

```
vercel login
```

## Verify underwrite auto-init

```
DEAL_ID="<deal-id>" pnpm -s verify:underwrite
```

### Optional (authenticated preview)
If the preview requires auth, pass a session cookie:

```
DEAL_ID="<deal-id>" BUDDY_AUTH_COOKIE="<cookie>" pnpm -s verify:underwrite
```

## Expected output
- Underwrite request returns a non-error HTTP status.
- Context endpoint responds (status 200).
- Checklist count becomes > 0 within the retry window.

## Troubleshooting
- If the preview URL is wrong, run `pnpm -s vercel:preview:url` again and confirm the branch matches.
- If checklist remains empty, check the `underwrite.entry.*` ledger events and builder signals.
