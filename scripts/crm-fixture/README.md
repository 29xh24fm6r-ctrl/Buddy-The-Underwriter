# Offline CRM component harness

This is an isolated component test, not a preview deployment. It uses the real CRM UI with fictional data, test-only navigation/identity adapters, and a fetch implementation that rejects every unexpected request. No credentials are required. The adapters are only selected by the explicit esbuild aliases below and never imported by application code.

From the repository root:

```powershell
npx --yes esbuild@0.25.9 scripts/crm-fixture/index.tsx --bundle --outfile=scripts/crm-fixture/fixture.js --alias:next/link=./scripts/crm-fixture/navigation.tsx --alias:next/navigation=./scripts/crm-fixture/navigation.tsx --alias:@clerk/nextjs=./scripts/crm-fixture/clerk.ts --jsx=automatic
```

Open `index.html` with a browser that permits local-file assets. Generated JS/CSS are ignored. For agent-browser, use an isolated session and `--allow-file-access`; close that session after checking.

Coverage: Today, task inventory, companies, people, pipeline intake, and quick-record drawers. Other full-page destinations are not modeled. `window.crmFixture.failNextSave()` injects one failed mutation for draft-retention testing. This cannot verify production auth, backend policies, or durable persistence.
