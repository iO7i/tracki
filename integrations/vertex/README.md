# application ⇄ Tracki integration

Drop-in behavioral analytics for **example.com**, wired to the Tracki web stack.
Fires a typed, first-class event schema (no generic click capture), gates on
consent, feature-flags autonomous AI chat OFF, and never sends PII.

## Files

| File | Purpose |
|------|---------|
| `vertex-analytics.ts` | The typed client. Import it in the application app (Next.js/TS). |
| `example.html` | Zero-build static harness — the acceptance-test driver. |

## Install

### Next.js (App Router — how example.com ships)

1. Copy `vertex-analytics.ts` into `apps/web/src/lib/`.
2. Create a client provider that boots it once and fires page-level events:

```tsx
// apps/web/src/components/vertex-analytics-provider.tsx
"use client";
import { useEffect } from "react";
import VertexAnalytics from "@/lib/vertex-analytics";

export function VertexAnalyticsProvider() {
  useEffect(() => {
    VertexAnalytics.init({
      key: process.env.NEXT_PUBLIC_TRACKI_KEY!,
      endpoint: process.env.NEXT_PUBLIC_TRACKI_ENDPOINT!, // https://ingest.example.com/v1/events
      consent: "pending", // opt-in; call consent(true) from your banner
    });
    VertexAnalytics.landingViewed();
  }, []);
  return null;
}
```

3. Mount it in `apps/web/src/app/layout.tsx` (inside `<body>`).
4. When your cookie-consent banner resolves: `VertexAnalytics.consent(true|false)`.

### Plain `<script>` (no build step)

Use `example.html` as the reference — inject the snippet with
`data-key`, `data-endpoint`, `data-consent="pending"`, `data-chat="off"`, then
call `window.tracki.track(name, safeProps)`.

## Consent

- Default is **opt-in** (`pending`): nothing is transmitted until
  `VertexAnalytics.consent(true)`. Events fired meanwhile are held in memory and
  replayed on grant, or discarded on `consent(false)`.
- A browser Do-Not-Track / GPC signal forces denial unless explicitly granted.
- UTM/click-ids are captured **only** while consent is granted.

## Event → call-site map

Auto-fired by the provider: `landing_viewed` (mount), `language_changed` (locale
switch). Everything else is wired at the interaction that means it:

| Event | Where to call it |
|-------|------------------|
| `hero_cta_clicked` | hero CTA `onClick` — `heroCtaClicked(id)` |
| `pricing_viewed` / `feature_section_viewed` | IntersectionObserver on those sections |
| `pricing_plan_selected` | plan card select — `pricingPlanSelected(planId)` |
| `faq_opened` | FAQ accordion open — `faqOpened(id)` |
| `demo_store_opened` / `profit_analysis_clicked` | those CTAs |
| `booking_started` / `booking_completed` | booking widget open / success |
| `signup_completed` / `trial_started` | auth success callback |
| `platform_selected` / `zid_selected` / `salla_selected` | platform picker |
| `oauth_started` / `oauth_failed` / `store_connected` | OAuth initiate / error / success |
| `first_sync_completed` / `first_profit_report_viewed` | product activation hooks |
| `subscription_started` / `subscription_cancelled` | billing webhooks / UI |

> Product/activation events (`first_sync_completed`, `first_profit_report_viewed`,
> `subscription_*`) fire **inside the application product**, not the marketing site.
> application remains the source of truth for authenticated product/billing/revenue;
> Tracki owns behavioral + struggle detail. Call these from the product app (or a
> server→browser bridge) using the same client + the same project key.

## PII rules (enforced twice — client + ingest edge)

**Never pass** raw email, phone, name, OAuth tokens, order/customer/payment data,
session secrets, or full URLs with sensitive query strings. Pass only:

- surrogate IDs: `leadId`, `userId`, `orgId`, `storeId` (opaque, never email)
- codes/enums: `planId`, `plan`, `currency`, `errorCode`, `section`, `faqId`, `platform`
- coarse context: `language`, `deviceClass`, `country`, `region`, `platformInterest`
- acquisition (consent-gated): `utm*`, `clickId`, `referrerCategory`

Anything else is dropped at ingestion (`@tracki/shared` `sanitizeVertexTrack`),
and any email that leaks into a string prop is masked before storage.

## Identity

`identify(userId)` runs only inside the conversion methods
(`bookingCompleted`, `signupCompleted`, `trialStarted`) — a first-party
conversion. See `docs/vertex-identity.md` for the full anon→lead→user→org→store
contract. Email is never an identifier.

## Acceptance harness

```bash
# with the local stack up + application tenant seeded (prints the pk_ key):
open integrations/vertex/example.html?key=pk_...&endpoint=http://localhost:4000/v1/events
```

Grant consent, walk the buttons top→bottom, then verify the timeline/funnel in
the operator dashboard and confirm no PII in ClickHouse.
