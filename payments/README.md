# RSVP Reader — Lemon Squeezy payments

This directory contains the payment button glue for the RSVP Reader PWA.
It is **hidden by default** in v1.0 per the monetization decision in
`V1_0_DECISION.md` §4 (ship free for 30 days, then re-evaluate). The
founder flips it on after day 30 by setting a single localStorage key.

The product is a **single PWYW tip** (no subscription, no plan gating).
The checkout is hosted entirely by Lemon Squeezy, so the buyer never
creates an RSVP-side account and we never store a payment state.

## Why Lemon Squeezy (per GTM_PLAYBOOK)

- **5% + 50¢** per transaction. At a $5 ARPU that fits.
- **Merchant of Record** — Lemon Squeezy collects US sales tax and EU
  VAT and remits on the founder's behalf. No tax paperwork for us.
- **Hosted checkout** — one script-tag embed or a direct URL. The buyer
  can pay without creating any RSVP-side account.
- **Stripe Connect payouts** — the founder's bank receives funds via
  Stripe; no separate payout setup.

## Founder setup (do this once, ~10 min)

1. **Sign up** at <https://www.lemonsqueezy.com> and complete the
   Stripe Connect onboarding so payouts are enabled. (Lemon Squeezy
   will ask for your legal name, address, and bank account / routing
   numbers. They send a 1099-NEC to US-based sellers who cross the IRS
   reporting threshold; otherwise you self-report.)
2. **Create a store** named `zipang` (or anything — the slug is the
   `zipang` in `https://zipang.lemonsqueezy.com/...`). The slug appears
   in the placeholder URL in `lemon-squeezy-config.json`.
3. **Create a product**:
   - Name: "RSVP Reader tip"
   - Type: **Pay what you want** (single product, no variants)
   - Minimum price: **$5 USD** (Lemon Squeezy requires you to set a
     minimum — a true $0 tip is not possible. Flagged below.)
   - Suggested prices: `$5`, `$20`, `$50`
   - License: Single-user (no license keys; we're not gating features)
   - Tax category: "Digital goods / Software"
4. **Copy the checkout URL**. In the dashboard:
   *Product → Share → Copy checkout link*. It looks like
   `https://zipang.lemonsqueezy.com/checkout/buy/abc-123-def`.
5. **Paste the URL** into `payments/lemon-squeezy-config.json`,
   replacing the `RSVP-PRODUCT-ID` placeholder in `checkoutUrl`.
   Validate with:
   ```
   cat payments/lemon-squeezy-config.json | python3 -m json.tool
   ```
6. **Test locally before flipping the flag**:
   - Open the app, open browser devtools, and run:
     ```js
     localStorage.setItem('rsvp-payments-enabled', '1');
     location.reload();
     ```
   - Open the in-reader settings sheet (long-press on mobile, the
     `Hold settings` hint on the reader). The "Optional support"
     section should appear with a button labelled
     `Pay what you want ($5+)`.
   - Open the library. Below the action buttons, a small
     `Pay what you want` link should appear.
   - Click either — it should log `[rsvp-pay] click { ... }` in the
     console and open Lemon Squeezy's hosted checkout (or the overlay
     modal, if `assets.lemonsqueezy.com/lemon.js` loads).
7. **Ship the flag after day 30**. The button is hidden behind a
   single key. To turn it on in production for everyone, you have two
   options — pick one:
   - **Quick (kills the §4 "re-evaluate" requirement early):** edit
     `reader-app.js` so the flag default is on. Search for
     `rsvp-payments-enabled` and add a fallback like
     `localStorage.setItem('rsvp-payments-enabled','1')` near
     `mountPaymentUI()`. Commit, deploy, done.
   - **Hammer the user with the localStorage dance** (the original
     v1.0 plan): set the key on your own browser only and re-evaluate
     at day 30 with real engagement data.
8. **Taxes**: Lemon Squeezy is the MoR for US sales tax and EU VAT —
   nothing for the founder to do there. **Income tax is the founder's
   responsibility** in their jurisdiction. US-based sellers receive a
   1099 from Lemon Squeezy once they cross the reporting threshold;
   non-US sellers self-report per local rules. (Talk to an accountant.)
9. **Payouts**: Stripe Connect deposits to the founder's bank on a
   rolling schedule (set in the Lemon Squeezy dashboard, default ~7
   days after the sale).

## Files in this directory

- `lemon-squeezy-config.json` — store slug, product slug, checkout URL,
  minimum/suggested prices, license mode, and the env var name. Edit
  this file (not the JS) when the founder rotates the product id.
- `payment-button.mjs` — the ES module. Exports `mountPaymentButton`,
  `isPaymentsEnabled`, `loadConfig`, and `DEFAULT_CONFIG`. Logs every
  click with the `[rsvp-pay]` prefix.

## How the button is wired

- `index.html`:
  - In the settings sheet, a `<div id="paymentSection" class="hidden"
    hidden>` contains the button.
  - In the library action row, a hidden `<a id="librarySupportLink"
    class="lib-action-btn lib-support-link hidden" hidden>Pay what you
    want</a>` sits beside the existing action buttons.
- `reader-app.js`:
  - Imports `mountPaymentButton`, `isPaymentsEnabled`, `loadConfig`
    from `./payments/payment-button.mjs`.
  - `mountPaymentUI()` runs once at startup. If the flag is set, it
    un-hides both affordances, wires the settings-sheet button to the
    overlay/hosted checkout, and routes the library footer link to the
    same flow.

## UX concern: PWYW minimum

**Lemon Squeezy requires you to set a minimum price on a PWYW product
(at the time of writing, the dashboard does not offer a $0 floor on
PWYW).** The default $5 minimum in `lemon-squeezy-config.json` matches
the GTM_PLAYBOOK's $5 ARPU target — anything lower would be eaten by
the 5% + 50¢ fee and would not be worth the founder's Stripe payout
processing overhead. The button label `Pay what you want ($5+)` makes
the floor visible to the user. If the founder wants a true $0 floor in
the future, they would need to switch providers (Gumroad's PWYW allows
$0; Stripe + a custom checkout would also work but adds integration
cost).

## Verification

```
# Syntax check
node --check payments/payment-button.mjs && node --check test/payment.test.mjs && echo OK

# JSON valid
cat payments/lemon-squeezy-config.json | python3 -m json.tool

# Tests
npm test

# HTML is hidden
grep "paymentSection" index.html
```
