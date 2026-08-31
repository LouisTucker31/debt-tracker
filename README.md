# Debt Tracker

A vanilla HTML, CSS and JavaScript PWA for tracking credit card balances,
payments and payoff dates. Runs entirely in your browser, no server, no
account, no tracking. Your data is stored only in that browser's local
storage on that device.

Built to the project's Apple-platform HTML build standards: native form
controls, an accessible `<dialog>` for confirmations, a strict Content
Security Policy, 44px touch targets, and no framework or build step.

## Folder structure

```
project-root/
├── index.html
├── sw.js
├── manifest.webmanifest
├── css/
│   └── styles.css
├── js/
│   └── main.js
└── assets/
    ├── icon-192.png
    └── icon-512.png
```

`pages/` is omitted since this build is a single screen. Add it if a
second screen is introduced later.

## Deploy to GitHub Pages

1. Create a repo (e.g. `debt-tracker`) and push the entire contents of
   `project-root/` to the root of the `main` branch, keeping the folder
   structure intact (`index.html` stays in the root; `css/`, `js/` and
   `assets/` stay as subfolders).
2. In the repo, go to **Settings → Pages**, set **Source** to
   `Deploy from a branch`, branch `main`, folder `/ (root)`. Save.
3. Your app is live at `https://<your-username>.github.io/<repo-name>/`.

## Add to your phone's Home Screen

**iPhone (Safari):** open the link above, tap the Share icon, then
**Add to Home Screen**.

**Android (Chrome):** open the link above, tap the **⋮** menu, then
**Add to Home screen** or **Install app**.

Once added, it opens full-screen and works offline after the first load.

## How the numbers work

- **Current balance** updates using daily-compounded interest (balance
  multiplied by `(1 + APR/100/365)` per day) from the card's last update
  to today, so it stays live rather than a snapshot from when the card
  was added.
- **Payoff date, interest remaining** is a forward projection: it assumes
  the monthly payment you've set is paid every month until the balance
  reaches zero, with interest still compounding daily in between. If a
  payment would not even cover a month's interest, the card is flagged
  rather than shown a payoff date.
- **Make a payment** reduces the balance, for a normal payment, an extra
  lump sum, or, with "Pay off in full", clearing the whole balance at
  once.
- **Add a charge** increases the balance, for new spending on the card.
- Editing a card's APR or monthly payment only affects the balance going
  forward. Past history entries are never recalculated.

## Changing the currency

The app defaults to GBP (£). To change it, open `js/main.js` and find:

```js
var CURRENCY = 'GBP';
var LOCALE = 'en-GB';
```

Swap in your currency and locale, for example `'USD'` and `'en-US'`.

## Lock screen

The app shows a code entry screen on launch. To set your code, open
`js/main.js` and find:

```js
var ACCESS_CODE = 'CHANGE-ME';
```

Replace `'CHANGE-ME'` with whatever you want, in quotes. Unlocking lasts
until you close the app or browser tab; reopening it asks again.

This is a local deterrent against a casual glance at your phone, not
real security. The code sits in plain text in a file anyone can open
in a browser's dev tools, and the underlying balance data in local
storage is never encrypted regardless of the lock screen. If you ever
need this to actually be secure against someone with access to the
device, that needs real authentication with a backend, which a static
site like this one cannot provide.

## Notes on this build

- **Data storage.** All data lives in that one browser's storage.
  Clearing browser data, switching browsers, or switching phones starts
  you fresh. There is no export or import, by request, so there is no
  built-in backup route.
- **Security headers.** `index.html` sets a Content Security Policy via
  a meta tag, which covers script and style sources. `style-src` allows
  `'unsafe-inline'` for one reason: the credit-utilisation bar's fill
  width is a per-card computed percentage, so it needs an inline style
  rather than a fixed CSS class. `script-src` stays strict with no
  `'unsafe-inline'`, which is the directive that actually matters for
  XSS protection, since inline styles cannot execute script. Two extra
  headers the guidelines call for, `X-Content-Type-Options: nosniff` and
  a `Referrer-Policy`, cannot be set from a meta tag; they need to come
  from the hosting server. GitHub Pages does not currently offer a way
  to set custom response headers, so those two headers will not be
  present on a GitHub Pages deployment. Flagging this rather than
  silently skipping it: if that matters for your use case, hosting on
  Cloudflare Pages, Netlify or Vercel (all free tiers) would let you add
  a `_headers` file to set them.
- **Dark mode.** The project's default guidance is to support both light
  and dark appearance via `prefers-color-scheme`. This build is forced
  to light-only (`color-scheme: light`), which is a deliberate deviation
  made earlier in this build to fix a dark-background rendering bug in
  a preview tool. Say so if you would like dark mode added back.
- **Pinch-to-zoom** is intentionally left enabled. An earlier version of
  this build disabled it; that has been reversed, since disabling pinch
  zoom removes an accessibility feature relied on by low-vision users.
  Double-tap-to-zoom is still suppressed as a minor UX nicety, which is
  unrelated to pinch zoom and does not affect accessibility.
- Interest calculations are a planning estimate, not a substitute for an
  actual statement. Real card issuers vary in exactly how and when they
  apply interest and payments.
