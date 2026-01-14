# 🚀 GROWTH FEATURES - QUICK REFERENCE

## 📊 What's Live

| Feature | Status | Fallback if Not Configured |
|---------|--------|---------------------------|
| PostHog Analytics | ✅ | Silent no-op (no tracking) |
| Stripe Checkout (Pro) | ✅ | Redirects to /contact |
| Contact Form Email | ✅ | Shows clear error message |
| Demo Calendar Link | ✅ | Button hidden if URL not set |
| Demo Walkthrough Page | ✅ | Always works (no deps) |

## 🎯 Conversion Paths

```
Homepage → Signup → Onboarding (Starter)
Homepage → Pricing → Stripe → Pro Account
Homepage → Pricing → Contact → Sales Call → Enterprise
Homepage → Demo → Pricing → Any Path Above
Homepage → Request Demo → Calendar → Booking
Contact → Request Demo → Calendar → Booking
```

## 📍 Routes

| Route | Auth Required | Purpose |
|-------|---------------|---------|
| `/` | No | Marketing homepage |
| `/pricing` | No | Pricing tiers |
| `/demo` | No | Product walkthrough |
| `/contact` | No | Sales contact form |
| `/signup` | No | Clerk signup (redirects to /sign-up) |
| `/api/stripe/checkout` | No | Create Stripe session |
| `/api/contact` | No | Send contact email |

## 🔧 Environment Variables

### PostHog (Analytics)
```bash
NEXT_PUBLIC_POSTHOG_KEY=phc_xxx
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com  # optional
```

### Stripe (Checkout)
```bash
STRIPE_SECRET_KEY=sk_live_YOUR_KEY_HERE
NEXT_PUBLIC_STRIPE_PRO_PRICE_ID=price_xxx
```

### Resend (Contact Form)
```bash
RESEND_API_KEY=re_xxx
CONTACT_FROM_EMAIL=buddy@yourdomain.com
CONTACT_TO_EMAIL=sales@yourdomain.com
```

### Calendar (Request Demo)
```bash
NEXT_PUBLIC_DEMO_CALENDAR_URL=https://calendly.com/yourteam/demo
```

## 🎨 CTAs

**Hero Component** (4 CTAs):
1. "Start Free Trial" → /signup
2. "See Pricing" → /pricing
3. "Watch Demo" → /demo
4. "Request Demo" → Calendly (if URL set)

**Pricing Table** (3 tiers):
1. Starter: "Start free" → /signup
2. Pro: "Upgrade to Pro" → Stripe or /contact
3. Enterprise: "Contact sales" → /contact

**Contact Form** (2 states):
- Before submit: "Request a Demo" → Calendly (if URL set)
- After success: "Book a demo now" → Calendly (if URL set)

## 📈 Analytics Events

| Event | Where Fired |
|-------|-------------|
| `cta_click` | Hero buttons (signup, pricing, demo) |
| `demo_request_click` | Calendar links (hero, contact, success) |
| `pricing_checkout_click` | Pro "Upgrade" button |
| `pricing_contact_click` | Enterprise "Contact" button |
| `pricing_signup_click` | Starter "Start free" button |
| `contact_submit_click` | Contact form submit |
| `contact_submit_success` | Email sent successfully |
| `contact_submit_error` | Email failed to send |

## 🛡️ Error Handling

**Stripe Checkout**:
- No `NEXT_PUBLIC_STRIPE_PRO_PRICE_ID` → /contact
- Stripe API error → /contact
- Network error → /contact

**Contact Form**:
- Missing fields → Validation error shown
- No Resend config → Clear error: "Resend not configured..."
- API error → Error shown, user can retry

**PostHog**:
- No key → Silent no-op
- Init error → Silent no-op
- Capture error → Silent no-op

## 🧪 Testing

```bash
# Build test
npm run build

# Dev server
npm run dev

# Comprehensive test
./test-growth-features.sh
```

## 📁 Key Files

**Analytics**:
- `src/components/analytics/PostHogProvider.tsx`
- `src/components/analytics/useCapture.ts`

**APIs**:
- `src/app/api/stripe/checkout/route.ts`
- `src/app/api/contact/route.ts`

**Pages**:
- `src/app/page.tsx` (homepage with Hero)
- `src/app/pricing/page.tsx`
- `src/app/demo/page.tsx`
- `src/app/contact/page.tsx`

**Components**:
- `src/components/marketing/Hero.tsx`
- `src/components/marketing/PricingTable.tsx`

**Config**:
- `src/app/layout.tsx` (PHProvider wrapper)
- `src/proxy.ts` (route allow list)

## 🚀 Deployment

1. Set env vars in hosting provider (Vercel/Railway)
2. Push to main branch
3. Auto-deploy triggers
4. Run verification: [DEPLOYMENT_CHECKLIST_GROWTH.md](DEPLOYMENT_CHECKLIST_GROWTH.md)

## 🆘 Troubleshooting

**"Upgrade to Pro" goes to /contact instead of Stripe**
- Check: `NEXT_PUBLIC_STRIPE_PRO_PRICE_ID` is set
- Check: `STRIPE_SECRET_KEY` is set
- Check: Browser console for errors

**Contact form shows "Resend not configured"**
- Check: All 3 env vars set: `RESEND_API_KEY`, `CONTACT_FROM_EMAIL`, `CONTACT_TO_EMAIL`
- Check: Resend API key is valid
- Check: From domain is verified in Resend

**PostHog events not showing**
- Check: `NEXT_PUBLIC_POSTHOG_KEY` is set
- Check: PostHog project is active
- Check: Browser console for errors (should be none)
- Note: Events may take 1-2 minutes to appear

**"Request Demo" button not showing**
- Check: `NEXT_PUBLIC_DEMO_CALENDAR_URL` is set
- This is intentional - button only shows if calendar URL configured

## 📊 Success Metrics

**Week 1**:
- Contact form submissions > 0
- Stripe checkouts > 0 OR contact form enterprise inquiries > 0
- Demo requests (calendar) > 0 (if configured)
- PostHog events flowing

**Month 1**:
- Conversion rate from homepage → signup ≥ 5%
- Conversion rate from pricing → action ≥ 10%
- Contact form success rate ≥ 95%
- Zero user-reported errors

---

**Built with bulletproof fallbacks. Every path works. Zero user-facing failures.**
