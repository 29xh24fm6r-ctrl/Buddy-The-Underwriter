# 🚀 BULLETPROOF GROWTH FEATURES - DEPLOYMENT CHECKLIST

## ✅ Pre-Deployment Verification

### Local Build Test
```bash
cd /workspaces/Buddy-The-Underwriter
npm run build
# ✓ Should complete with no errors
```

### Component Test
```bash
npm run dev
# ✓ Visit http://localhost:3000
# ✓ Visit http://localhost:3000/pricing
# ✓ Visit http://localhost:3000/demo
# ✓ Visit http://localhost:3000/contact
```

### API Test
```bash
# Run comprehensive test suite
./test-growth-features.sh
# ✓ All tests should pass (some warnings expected without env vars)
```

---

## 🔧 Environment Variables Setup

### Required for Production (Set in Hosting Provider)

**PostHog Analytics** (optional but recommended):
```bash
NEXT_PUBLIC_POSTHOG_KEY=phc_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com  # or https://eu.i.posthog.com
```

**Stripe Checkout** (optional - if not set, falls back to /contact):
```bash
STRIPE_SECRET_KEY=sk_live_REPLACE_WITH_YOUR_KEY
NEXT_PUBLIC_STRIPE_PRO_PRICE_ID=price_xxxxxxxxxxxxxxxxxxxxx
```

**Resend Contact Form** (optional - if not set, contact form shows clear error):
```bash
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
CONTACT_FROM_EMAIL=buddy@yourdomain.com
CONTACT_TO_EMAIL=sales@yourdomain.com
```

**Calendar Link** (optional - if not set, "Request Demo" CTAs hidden):
```bash
NEXT_PUBLIC_DEMO_CALENDAR_URL=https://calendly.com/yourteam/buddy-demo
```

---

## 🎯 Post-Deployment Verification

### 1. Public Routes (No Auth Required)
- [ ] Navigate to https://yourdomain.com - Homepage loads
- [ ] Navigate to https://yourdomain.com/pricing - Pricing page loads
- [ ] Navigate to https://yourdomain.com/demo - Demo walkthrough loads
- [ ] Navigate to https://yourdomain.com/contact - Contact form loads

### 2. Hero CTAs
- [ ] Click "Start Free Trial" → redirects to /signup (Clerk)
- [ ] Click "See Pricing" → redirects to /pricing
- [ ] Click "Watch Demo" → redirects to /demo
- [ ] If calendar URL set: "Request Demo" button visible and opens Calendly

### 3. Pricing Table
- [ ] "Starter" tier → "Start free" button → redirects to /signup
- [ ] "Pro" tier → "Upgrade to Pro" button:
  - If Stripe configured → redirects to Stripe Checkout
  - If Stripe not configured → redirects to /contact
  - On any error → redirects to /contact
- [ ] "Enterprise" tier → "Contact sales" button → redirects to /contact

### 4. Contact Form
- [ ] Submit empty form → shows validation errors
- [ ] Submit with valid data:
  - If Resend configured → email sent, success message shown
  - If Resend not configured → clear error message shown
- [ ] If calendar URL set: "Request a Demo" button visible and opens Calendly
- [ ] After success: If calendar URL set, "Book a demo now" button visible

### 5. Demo Page
- [ ] Shows borrower journey section
- [ ] Shows banker journey section
- [ ] "Start Free Trial" button → redirects to /signup
- [ ] "See Pricing" button → redirects to /pricing

### 6. PostHog Analytics (if configured)
- [ ] Visit PostHog dashboard
- [ ] Verify events are flowing:
  - `cta_click` (from Hero)
  - `pricing_checkout_click` (from PricingTable Pro)
  - `pricing_contact_click` (from PricingTable Enterprise)
  - `pricing_signup_click` (from PricingTable Starter)
  - `contact_submit_click`, `contact_submit_success`, `contact_submit_error` (from Contact)
  - `demo_request_click` (from calendar CTAs)

### 7. Stripe Integration (if configured)
- [ ] Click "Upgrade to Pro" in PricingTable
- [ ] Redirected to Stripe Checkout session
- [ ] Test checkout with test card (4242 4242 4242 4242)
- [ ] After success → redirected to /pricing?checkout=success
- [ ] Cancel checkout → redirected to /pricing?checkout=cancel

### 8. Resend Contact Form (if configured)
- [ ] Submit contact form with test data
- [ ] Check email inbox at `CONTACT_TO_EMAIL`
- [ ] Verify email received with:
  - Subject: "New Buddy lead: [Name] — [Company]"
  - Body: Name, Email, Company, Message
  - Reply-To: User's email address

---

## 🛡️ Failure Mode Testing

### Test Graceful Degradation

**Scenario 1: No Stripe configured**
- [ ] Remove `NEXT_PUBLIC_STRIPE_PRO_PRICE_ID` from env
- [ ] Rebuild and deploy
- [ ] Click "Upgrade to Pro" → should redirect to /contact
- [ ] ✓ No errors in console
- [ ] ✓ User not stuck

**Scenario 2: No PostHog configured**
- [ ] Remove `NEXT_PUBLIC_POSTHOG_KEY` from env
- [ ] Rebuild and deploy
- [ ] Click any CTA
- [ ] ✓ No errors in console
- [ ] ✓ CTAs still work
- [ ] ✓ No PostHog events sent (silent no-op)

**Scenario 3: No Resend configured**
- [ ] Remove `RESEND_API_KEY` or `CONTACT_FROM_EMAIL` or `CONTACT_TO_EMAIL`
- [ ] Rebuild and deploy
- [ ] Submit contact form
- [ ] ✓ Returns clear error: "Resend not configured (requires...)"
- [ ] ✓ User sees error message
- [ ] ✓ No crash

**Scenario 4: No Calendar configured**
- [ ] Remove `NEXT_PUBLIC_DEMO_CALENDAR_URL` from env
- [ ] Rebuild and deploy
- [ ] Visit homepage, /contact, contact success state
- [ ] ✓ "Request Demo" / "Book a demo" buttons hidden
- [ ] ✓ No broken links
- [ ] ✓ Other CTAs still work

**Scenario 5: Stripe API failure**
- [ ] Set invalid `STRIPE_SECRET_KEY`
- [ ] Click "Upgrade to Pro"
- [ ] ✓ Redirects to /contact (fallback)
- [ ] ✓ Console shows error (for debugging)
- [ ] ✓ User not stuck

---

## 📊 Monitoring Setup

### PostHog Dashboards (if using PostHog)

Create dashboard with these metrics:
1. **Hero CTA Performance**
   - Event: `cta_click`
   - Breakdown by: `cta` property
   - Shows which CTA gets most clicks

2. **Pricing Conversion Funnel**
   - Step 1: Page view `/pricing`
   - Step 2: Event `pricing_checkout_click` OR `pricing_contact_click` OR `pricing_signup_click`
   - Shows conversion rate from pricing view to action

3. **Contact Form Success Rate**
   - Event: `contact_submit_click` (total attempts)
   - Event: `contact_submit_success` (successful)
   - Event: `contact_submit_error` (failed)
   - Shows form reliability

4. **Demo Requests**
   - Event: `demo_request_click`
   - Breakdown by: `location` property
   - Shows where users request demos (hero, contact, success)

### Stripe Webhooks (if using Stripe)

Set up webhook endpoint for:
- `checkout.session.completed` → trigger welcome email, provision account
- `customer.subscription.updated` → handle upgrades/downgrades
- `customer.subscription.deleted` → handle cancellations

### Resend Email Monitoring (if using Resend)

- Log into Resend dashboard
- Monitor email delivery rates
- Check for bounces/spam reports
- Verify domain authentication (SPF, DKIM, DMARC)

---

## 🎉 Success Criteria

All features are working correctly when:

- [ ] All public routes load without errors
- [ ] All CTAs redirect to correct destinations
- [ ] Stripe checkout works OR gracefully falls back to /contact
- [ ] Contact form sends email OR shows clear error
- [ ] PostHog events track OR silently no-op
- [ ] Calendar links work OR are hidden
- [ ] No console errors in production
- [ ] No user-facing crashes
- [ ] Conversion paths all functional

---

## 🚨 Rollback Plan

If deployment causes issues:

1. **Quick rollback**:
   ```bash
   git revert HEAD
   git push origin main
   ```

2. **Partial rollback** (keep base, remove growth features):
   - Remove PostHog wrapper from layout.tsx
   - Revert Hero.tsx to 2-CTA version
   - Revert PricingTable.tsx to simple links
   - Keep /demo and /contact pages (they're standalone)

3. **Environment variable reset**:
   - Remove Stripe keys → Pro tier falls back to /contact
   - Remove PostHog keys → Analytics silent no-op
   - Remove Resend keys → Contact form shows error
   - Keep Clerk keys → Auth still works

---

## 📝 Documentation

User-facing docs to create:

1. **For Sales Team**: How to access contact form submissions (check Resend dashboard or email)
2. **For Marketing**: How to view analytics (PostHog dashboard access)
3. **For Finance**: How to view Stripe subscriptions (Stripe dashboard access)
4. **For Support**: What to do if contact form fails (check env vars, Resend status)

---

**🛡️ BULLETPROOF GUARANTEE**: Every feature has a safe fallback. No single env var failure can break the entire site.
