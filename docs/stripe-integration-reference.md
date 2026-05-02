# Trust Log Stripe Integration Reference

_Last updated: 2026-05-02_

## Product Context

**Trust Log** is a developer trust/safety tool for agent work. The local CLI should remain useful without a hosted account, while paid tiers can unlock cloud features:

- hosted receipt storage and sharing
- team workspaces
- compliance/audit retention
- webhook/API ingestion from CI or agent platforms
- usage-based receipt volume
- enterprise controls and SSO later

The Stripe integration should support a simple MVP now and leave room for usage-based billing later.

## Recommended MVP Billing Model

Start with **Stripe Checkout + Billing subscriptions + Customer Portal**.

Suggested tiers:

1. **Free / Local**
   - local receipts only
   - no Stripe customer required
   - optional anonymous npm usage, no account wall

2. **Pro** — monthly subscription
   - hosted receipts
   - private share links
   - API key
   - generous included receipt volume

3. **Team** — monthly subscription, seat or workspace based
   - team workspace
   - longer retention
   - CI/API ingestion
   - admin controls

4. **Enterprise later**
   - invoice/manual contract
   - SSO/SAML
   - custom retention
   - dedicated support

Avoid usage-based billing on day one unless receipt ingestion cost is already meaningful. Flat subscription is easier to explain and support. Add metered overages once there is real usage data.

## Stripe Objects

Core objects:

- **Customer**: one per Trust Log user or organization billing account.
- **Product**: `Trust Log Pro`, `Trust Log Team`.
- **Price**: recurring monthly/yearly prices.
- **Checkout Session**: hosted subscription checkout.
- **Subscription**: source of truth for paid access.
- **Customer Portal Session**: self-serve cancellation, payment method updates, invoices.
- **Webhook Events**: synchronize Stripe state into Trust Log DB.

For later metered billing:

- **Meter Events / usage reporting** depending on current Stripe Billing API path.
- Track billable unit as `hosted_receipt` or `receipt_ingested`.
- Keep local-only receipts non-billable.

## Architecture

Trust Log should separate three concerns:

### 1. Local CLI

Responsibilities:

- generate local receipts
- redact secrets before anything leaves the machine
- optionally upload receipt to Trust Log Cloud when authenticated
- read an API key/token from env/config

The CLI should never require Stripe directly. It should talk only to Trust Log backend APIs.

### 2. Trust Log Backend

Responsibilities:

- auth/account/workspace model
- create Stripe Checkout Sessions
- create Stripe Customer Portal Sessions
- receive Stripe webhooks
- maintain subscription/access state
- issue and revoke API keys
- receive uploaded receipts
- enforce plan limits

### 3. Stripe

Responsibilities:

- collect payment
- manage subscription lifecycle
- invoice/tax/payment method handling
- emit webhooks

## Data Model Sketch

Minimum backend tables/collections:

```text
users
- id
- email
- created_at

workspaces
- id
- name
- owner_user_id
- stripe_customer_id
- plan
- subscription_status
- subscription_id
- current_period_end
- receipt_limit_monthly
- created_at

api_keys
- id
- workspace_id
- key_hash
- name
- last_used_at
- revoked_at
- created_at

receipts
- id
- workspace_id
- source
- risk_level
- command_hash
- created_at
- storage_url/json

usage_counters
- workspace_id
- period_start
- period_end
- receipts_uploaded
```

Access should be based on local DB state synced from Stripe webhooks, not live Stripe API checks on every request.

## Checkout Flow

1. User signs in / creates workspace.
2. Backend creates or reuses a Stripe Customer.
3. Backend creates Checkout Session:
   - mode: `subscription`
   - customer: Stripe customer ID
   - line_items: selected recurring Price
   - success_url and cancel_url
   - metadata: `workspace_id`, `user_id`, selected plan
4. User completes hosted Checkout.
5. Stripe sends webhook events.
6. Backend marks workspace active after webhook confirms subscription/payment state.
7. UI shows API key setup and CLI command.

Important: do not grant paid access solely from the browser redirect success URL. Webhook confirmation is the reliable source.

## Customer Portal Flow

1. Authenticated user clicks “Manage billing”.
2. Backend creates Customer Portal Session for workspace Stripe customer.
3. User manages card, invoices, cancellation, subscription changes in Stripe-hosted portal.
4. Webhooks update local subscription state.

## Webhook Events to Handle

MVP events:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_succeeded`
- `invoice.payment_failed`

Optional/later:

- `customer.updated`
- `payment_method.attached`
- usage/meter-related events
- dispute/refund events if one-time purchases appear

Webhook requirements:

- verify Stripe signature using raw request body
- store processed event IDs for idempotency
- make handlers safe to run more than once
- return 2xx quickly; offload slow work if needed
- log failures clearly for replay/debugging

## API Key / License Strategy

For a CLI product, do **not** try to make npm install itself paid. Keep install friction low.

Use a cloud API key for paid hosted features:

```bash
trustlog login
# or
export TRUSTLOG_API_KEY=tl_live_...
trustlog run --upload -- codex "fix issue #12"
```

API key behavior:

- generated by backend after account/workspace creation
- stored locally in OS keychain or config file with strict permissions
- only hash stored server-side
- prefix identifies environment (`tl_test_`, `tl_live_`)
- key can be revoked/rotated
- every upload is associated with workspace

Plan enforcement happens server-side when API key is used.

## Usage-Based Billing Path

Usage-based billing is best as phase 2.

Potential billable metrics:

- uploaded receipts per month
- retained receipt-days / storage
- CI ingestion events
- team seats

Recommended path:

1. MVP: flat Pro/Team subscriptions with internal usage counters.
2. Add soft limits and admin emails when usage is high.
3. Once usage distribution is known, introduce metered overages or higher tier limits.
4. Report usage to Stripe only from server-side trusted counters, never from CLI directly.

## Security Notes

- Never send raw hidden reasoning / chain-of-thought to cloud by default.
- Redact secrets locally before upload.
- Treat receipts as sensitive: they may include filenames, command output, repo names, stack traces, and private URLs.
- Signed share links should be revocable and expire by default.
- Use least-privilege Stripe keys: secret key only on backend, never CLI/frontend.
- Webhook secret separate per environment.
- Use Stripe test mode and separate products/prices for dev/staging/prod.
- Store no card data directly; rely on Stripe-hosted Checkout/Portal.

## Local Development

Use Stripe test mode and Stripe CLI for webhook forwarding.

Typical loop:

```bash
stripe login
stripe listen --forward-to localhost:3000/api/stripe/webhook
stripe trigger checkout.session.completed
```

Keep environment variables explicit:

```bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_PRO_MONTHLY=price_...
STRIPE_PRICE_TEAM_MONTHLY=price_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

## MVP Implementation Checklist

- [ ] Create Stripe test products/prices for Pro and Team.
- [ ] Backend endpoint: create checkout session.
- [ ] Backend endpoint: create customer portal session.
- [ ] Backend endpoint: Stripe webhook with signature verification.
- [ ] DB fields for customer/subscription/plan/status.
- [ ] API key generation and hashed storage.
- [ ] CLI `trustlog login` or `TRUSTLOG_API_KEY` support.
- [ ] Server-side receipt upload endpoint with plan checks.
- [ ] Local redaction before upload.
- [ ] Hosted receipt share pages gated by plan.
- [ ] Test mode end-to-end flow with Stripe CLI.

## Recommended Initial Product Decision

Build Trust Log as **local-first open CLI + paid hosted trust receipts**.

This avoids the worst developer adoption trap: forcing payment before the user sees value. The CLI can become popular through npm/GitHub, while Stripe monetizes the cloud/team layer.
