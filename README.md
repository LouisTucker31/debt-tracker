# Debt Tracker

A no-frills PWA for tracking credit card balances, payments and payoff dates.
Runs entirely in your browser — no server, no account, no tracking. Your data
is stored only in that browser's local storage on that device.

## Deploy to GitHub Pages

1. Create a new GitHub repo (e.g. `debt-tracker`) and push these files
   (`index.html`, `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png`)
   to the root of the `main` branch.
2. In the repo, go to **Settings → Pages**, set **Source** to
   `Deploy from a branch`, branch `main`, folder `/ (root)`. Save.
3. Wait a minute, then your app is live at
   `https://<your-username>.github.io/<repo-name>/`.

## Add to your phone's Home Screen

**iPhone (Safari):** open the link above → tap the Share icon → **Add to
Home Screen**.

**Android (Chrome):** open the link above → tap the **⋮** menu → **Add to
Home screen** / **Install app**.

Once added, it opens full-screen like a native app and works offline after
the first load.

## How the numbers work

- **Current balance** updates using daily-compounded interest (balance ×
  `(1 + APR/100/365)` per day) from the card's last update to today, so it's
  always live, not a snapshot from when you added the card.
- **Payoff date / interest remaining** is a forward projection: it assumes
  you pay the monthly payment you've set, every month, until the balance
  hits zero, with interest still compounding daily in between. If a payment
  wouldn't even cover a month's interest, the app flags it instead of
  showing a payoff date.
- **Make a payment** reduces the balance (use it for a normal payment, an
  extra lump sum, or — with "Pay off in full" — clearing the whole balance
  at once).
- **Add a charge** increases the balance, for new spending on the card.

## Changing the currency

The app defaults to GBP (£). To change it, open `index.html`, find this
line near the top of the `<script>`:

```js
var CURRENCY = 'GBP';
var LOCALE = 'en-GB';
```

and swap in your currency/locale, e.g. `'USD'` / `'en-US'`, `'EUR'` /
`'en-IE'`.

## Notes

- All data lives in that one browser's storage — clearing your browser data,
  using a different browser, or switching phones starts you fresh. There's
  no export/import built in (by request), so if you ever want a backup
  route added later, that's a small addition.
- Interest calculations are a planning estimate, not a substitute for your
  actual statement — real issuers vary in exactly how and when they apply
  interest and payments.
