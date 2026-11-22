# Mizan Finance V5 — English Edition

A responsive personal-finance web app, built for GitHub Pages and optional Supabase cloud authentication. This release keeps all V4 finance features and switches **every built-in screen, form, category, message, dashboard, report label, and app icon to English**. Currency: **Egyptian pounds (EGP)**. The interface uses **Plus Jakarta Sans** when an internet connection allows the font to load, and falls back to high-quality system fonts offline.

## What is included

- Dashboard with 12 configurable widgets: Safe to Spend, Quick Actions, Financial Overview, Income & Expense Trend, Spending Breakdown, Mizan Insights, Bills & Commitments, Budget Tracking, Money Envelopes, Savings Goals, Financial Calendar, Recent Transactions.
- Midnight / Light / Emerald themes, Glow / Grid / Simple backgrounds, privacy mode that masks amounts, show/hide/reorder dashboard widgets, mobile navigation, quick-entry button.
- Transactions: income, expenses, internal transfers, split expenses, search/filter/edit/delete, accounts with opening balances.
- Monthly category budgets and separate envelope allocations (neither is counted as a real expense).
- Recurring weekly/monthly income and expenses; payments post **only after your confirmation**. Debts and repayments tracked separately from income and expenses.
- Savings goals, annual and monthly reports, CSV transaction export, JSON backup/import, sample demo data.
- Cloud auth/sign-up/password reset and user-isolated Supabase persistence **after** you configure your own Supabase project and run schema.sql.

## Publish to GitHub Pages

1. Extract the ZIP archive.
2. Create or open your GitHub repository (public for the standard free GitHub Pages setup).
3. Upload **all extracted files into the repository root**. `index.html`, `v4.js`, `cloud.js`, `v4.css`, `english.css`, `config.js`, `manifest.webmanifest`, `sw.js`, and the icons need to remain at the same level. Do not upload only the ZIP file.
4. Commit the changes.
5. In repository **Settings → Pages**, choose **Deploy from a branch**, branch **main**, folder **/(root)**, and Save.
6. Open `https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/` once Pages finishes deployment.
7. To update an older V3/V4 deployment, **export a JSON backup first** and replace the old files with the V5 contents. The updated service worker uses a new cache name to avoid stale assets. Hard refresh if the browser still shows the old interface.

## Enable login and cloud sync with Supabase (not needed for local demo)

1. Create a Supabase project at `https://supabase.com/dashboard`.
2. Open **SQL Editor**, paste `schema.sql`, and run it. It creates per-user tables, permissions, and revision-protected sync functions. It can be rerun after making a database backup.
3. In the project's API settings, copy your **Project URL** and the **publishable / anon key** to `config.js`:

   ```js
   window.MIZAN_CONFIG = {
     supabaseUrl: 'https://YOUR-PROJECT.supabase.co',
     supabaseAnonKey: 'YOUR-PUBLISHABLE-KEY'
   };
   ```

4. In **Authentication → URL Configuration**, add your exact HTTPS GitHub Pages address as the Site URL and as an allowed Redirect URL (use the ending `/` appropriately). Email confirmation and password reset links need to return to your deployed site.
5. In **Authentication → Providers → Email**, configure the sign-up/confirmation policy you prefer. For real-world use, ensure the email service is configured and delivery works.
6. Commit the updated `config.js` (public key only) and visit the site to create your account, confirm your email if required, and sign in.

**Security:** Never put a `service_role`, `sb_secret_`, or database password into `config.js` or any public repository. The publishable/anon key is designed to be public **only with correctly configured RLS**. Review Supabase project security settings before using real financial data. This is a self-managed finance logger, not a bank connection. GitHub Pages hosts the static front-end only.

## Local demo and backups

If Supabase isn't configured, click **Try local demo**. Data is saved locally to that browser where localStorage is permitted. No other device can see it and it is not a cloud backup. Use **Settings → Export full backup (JSON)** regularly. A standalone HTML preview is also provided separately; browser restrictions may prevent persistent storage when opening HTML directly from the filesystem, so GitHub Pages is recommended for actual use.

To move from an older version, export JSON in the old version and import it in V5. Untouched built-in Arabic category and account labels from older data are automatically converted to English, while user-defined names and every transaction/amount stay unchanged. Importing a JSON backup replaces the existing dataset after your confirmation.

## Operational notes

- **Safe to Spend** is an estimate based on your recorded liquid accounts, unspent envelope allocations, scheduled bills, and due debts. It may omit unrecorded commitments. It is not a guarantee that an expense is affordable.
- Envelopes allocate a plan; category budgets set limits; account transfers move funds. None of these automatically creates a new expense.
- Recurring payments do not automatically charge accounts; you must confirm them.
- Privacy mode hides displayed monetary amounts, but does not encrypt local data. Device access controls are still important.
- The Supabase login, live email reset, and real multi-device synchronization require your project's credentials and a real integration test; they cannot be verified from the offline local demo.
- The bundled app icon uses an English **M**. The app UI is left-to-right and uses English date/month labels.

## Files

`index.html` (app), `v4.js` (dashboard functionality, retained filename for compatibility), `v4.css` + `english.css` (styles), `cloud.js` (login and sync), `config.js` (public cloud config), `schema.sql` (Supabase schema), `sw.js` + `manifest.webmanifest` (installable web app), and app icons.
