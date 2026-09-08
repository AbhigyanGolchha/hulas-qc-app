# Hulas Khadya QC & Production Reporting

Digital replacement for the paper QC and production forms at **Hulas Khadya Udyog Pvt. Ltd.**
(Nepalgunj) — four mills (Roller Flour, Chakki Atta, Chiura, Bhuja), three report types:

1. **Spot Analysis** (raw material intake — Wheat ⚙ / Paddy 📖 / Rice 📖 templates)
2. **Finished Product QC** (Maida, Mill Atta + fortification check, Suji, Chakki Atta, Chiura, Bhuja)
3. **Daily Production Report** (input → shift ops → output by pack size → yield → downtime)

Everything is template-driven master data: products, parameters, spec limits (versioned),
suppliers, pack sizes, users. Standalone today, **SAP-ready by design** (optional SAP codes on
master data, UUID keys, structured specs, `/api/export` + `integration_outbox` queue).

## Run it

```bash
npm install
npm run setup   # prisma db push + seed master data + ONE admin account (temp password printed)
npm run dev     # http://localhost:3000
```

Sign in as `admin` with the printed temporary password — you are asked to choose your own
on first sign-in. Then create everyone else in **Admin → Users** (each gets a one-time
temporary password, emailed if they have an address). Set `ADMIN_PASSWORD=…` before
`npm run setup` to pick the admin password yourself.

**Demo data is opt-in**: `npm run setup:demo` (or `SEED_DEMO=1 npm run db:seed`) also creates
the demo logins (`gm`, `poonam`, `godown`, `sup.rfm` … password `hulas123`) and batch
**RFM-193** (16-Apr-2026 / Miti 3-1-2083) populated from the real scanned forms — wheat
intake, production DP-2083-0001 (38,542 kg net input, 75.29% main yield), QC sheets for
Maida/Mill Atta/Suji — plus small demo batches for the other mills.

**Start real testing from zero**: `npm run db:reset` wipes every report, batch, signature,
SAP/mail queue row, audit row and non-admin user, but keeps master data, suppliers (including
the ones pulled from SAP), mill batch counters, approval flow and all settings (SAP, email).

Set a long random `SESSION_SECRET` in `.env` (already generated for this machine).
Timezone: the whole process is pinned to **Asia/Kathmandu (GMT+5:45)** in `next.config.mjs`;
every timestamp on screen, in prints and in emails shows Nepal time ("NPT").

## How it works

- **Workflow**: Draft → Submitted → Approved/Rejected. Required-field checks run at Submit,
  not while drafting. Approved records are read-only; Manager/Admin can *Unlock* (audited).
  Every approval also drops a SAP-shaped JSON payload into the integration outbox.
- **Spec engine** (`src/lib/spec.ts`): operators LTE/LT/GTE/GT/RANGE/NIL/RECORD/TEXT_MATCH.
  `"< 0.0%"` on the paper forms = NIL (result must be exactly 0). Blank = "not tested" — never
  a fail, never coerced to 0. Live green/red as you type; server re-evaluates on save.
- **Spec versioning**: editing a limit in Admin creates a new `SpecVersion`; every result row
  pins the version in force when tested, so old reports always print their original spec.
  ⚙ = Hulas internal limit, 📖 = seeded from published standards (FSSAI/FCI/NIFTEM) — verify
  against Nepal NS/DFTQC before relying on 📖 values (the admin editor reminds you).
- **Dual calendar**: enter AD or BS anywhere, the other converts live (`nepali-date-converter`).
  Report numbering uses the BS year (SA-2083-0001); batch numbers per mill (RFM-193 → RFM-194).
- **3-sample averaging**: moisture rows take 3 samples + an IR instrument reading; Result
  Obtained auto-averages, typing a result manually overrides (flagged).
- **Production maths** (Section C): pack columns take the **number of bags/packets**; the app
  converts to kg from the pack size (350 × 50 kg bora = 17,500 kg, shown under the cell).
  **Semi-finished** is product still loose in bins (not packed yet) — never the packed
  weight again. Row total = semi-finished + packed kg. Total recovery = all output ÷ net
  input; main-product yield excludes by-products. Net input = kanta − bora per line (a
  bora heavier than its kanta blocks submit). Breakdown minutes = Σ downtime log unless the
  supervisor ticks *edit* and overrides (the override now survives reloads). Efficiency =
  (shift − breakdown) ÷ shift, clamped at 0.
- **Yield warnings**: per-mill sanity bands (admin-editable) — e.g. Roller total recovery
  98–103%, Chiura main yield 60–70%. Soft warnings only, never blocking; submitting outside
  the band also emails the managers (event *Production yield outside the expected band*).
- **Autosave**: forms save ~1.2 s after you stop typing; safe to walk away mid-entry.
- **Digital sign-offs (no paper signatures)**: each user draws their signature once on
  `/profile` (mouse/finger/stylus — works on the gate tablet). Submitting a report signs the
  submitter's slot automatically, Approve signs the manager slot, and co-signers (godown
  keeper on intake) sign with one tap on the record's *Digital sign-offs* panel. Every
  signature stores a point-in-time image snapshot + name + timestamp, writes an audit row,
  and *unlocking voids all signatures* — after edits, everyone signs again. While a report is
  still editable a signer can **remove their own signature** (Manager/Admin: anyone's) from the
  sign-off panel and sign again — audited as UNSIGN. Approval signatures are only undone by
  Reject/Unlock. On `/profile` a signature can be replaced or removed at any time.
- **Printing**: every report has a paper-style print view (`/print/<type>/<id>`) — use the
  browser's Print → Save as PDF. Prints show the digital signature images with
  "Digitally signed <time> NPT" — nothing left to sign by hand.
- **Exports**: CSV of any filtered list (`Export CSV` on list pages); SAP-shaped JSON per
  record (`Export JSON`), also queued in Admin → Integration outbox. The **Weekly Production
  Report** exports as CSV (`/api/csv?type=weekly&start=…`) and as PDF via its print view
  (`/print/weekly?start=…`).
- **Login system**: accounts exist only via Admin → Users (no self-signup, no demo logins on
  the login page). New accounts and admin resets get a one-time temporary password and must
  choose their own (≥ 8 chars, letters + a number) before doing anything else. 5 wrong
  passwords lock the account for 15 minutes (Admin can unlock). Every sign-in, failure,
  sign-out, password change and reset is in the audit log under *Sign-ins & passwords*.
  Users can be deactivated (kept for the audit trail) and reactivated.
- **Email notifications** (Admin → Notifications): every module raises events —
  *submitted* (to the role that must approve the current step), *approval step done*,
  *fully approved* / *rejected* / *unlocked* (to the preparer + signers), *QC FAIL*,
  *lot rejected / deduction at the gate*, *yield outside band*, *SAP delivery failed*,
  plus account invites/resets. Admin picks which roles (and extra addresses) get each
  event; supervisors only hear about their own mill; nobody is emailed about their own
  action; each user can mute events on `/profile`. Delivery is SMTP (`nodemailer`) — works
  with Microsoft 365 / Google Workspace app passwords; `SMTP_PASSWORD` env var wins over
  the stored one. Every email is queued in the Notification table first: with email switched
  off rows show as SKIPPED (so you can see what would go out), failures retry 5× then park
  as FAILED with a Retry button; `npm run mail:worker` retries in the background.

## SAP Business One integration — switched OFF by default

**Decision 2026-09-08:** posting QC/production records into B1 brings no benefit
yet, so the integration is off. Approvals are not queued or sent anywhere; the
SAP cards, the *Export JSON (SAP)* button and the batch "SAP order no." field
are hidden. What still works and is useful: **Pull suppliers from SAP** (Admin →
SAP Business One) so the intake supplier list matches B1's vendor master.

To turn posting back on: Admin → SAP Business One → tick *Post approved reports
to SAP* → Save. Everything below then applies unchanged (the connector code,
provisioned `HULAS_QC` UDO and worker are kept dormant, not deleted). The one
integration that would genuinely save work later is **documents mode** —
posting each approved daily production report as Issue + Receipt for
Production, so inventory in B1 moves without re-typing. That needs item codes
on products and a production order per batch first.

Hulas Group runs **SAP B1**, and the connector (`src/lib/connector.ts`) is built
for its Service Layer. When posting is on, every approval queues a document in `integration_outbox`;
delivery happens on approval (auto-send toggle), via **Sync now**, or through the
polling worker `npm run sap:worker`. Rows retry up to 5 times then park as
FAILED with the error and a per-row Retry button; B1 document numbers are
written back to the queue. Profiles `mock` (simulated delivery, for demos) and
`s4hana` remain available in Admin → SAP connection.

How records land in B1 (no QM module exists there):

| App record | B1 target |
|---|---|
| Spot analysis (intake) | `HULAS_QC` UDO row (`U_RecType=INTAKE`, decision, full JSON in `U_Payload`) |
| Product QC sheet | `HULAS_QC` UDO row (`U_RecType=PRODUCT_QC`, PASS/FAIL) |
| Daily production — **udo mode** (default) | `HULAS_QC` UDO row — works before any item mapping |
| Daily production — **documents mode** | Issue for Production (`InventoryGenExits`) + Receipt from Production (`InventoryGenEntries`), lines based on the batch's production order (BaseType 202), optional `BatchNumbers` |

Go-live steps:
1. From IT: Service Layer URL (`https://<b1-server>:50000`), CompanyDB name, and
   a technical user with a Service Layer-capable licence.
2. Enter them in **Admin → SAP connection** (profile is already `b1`); prefer
   `SAP_PASSWORD` as an env var over storing the password.
3. Run **`npm run b1:provision`** once (superuser) — creates the `HULAS_QC`
   user table, fields, and UDO. Then **Test connection** should go green.
4. Start with production mode **udo** + auto-send. Everything flows into B1
   immediately and is queryable/reportable there.
5. To upgrade production posting to real inventory documents: fill B1
   **ItemCodes** on products (Admin → Master data) and supplier **CardCodes**,
   put the production order **DocEntry** on each batch page, then switch
   production mode to **documents**. Check "batch-managed" if your finished
   items track batches in B1 (they should, for food traceability).
6. Agree UoM with the B1 consultant — the app posts quantities in **kg**; item
   masters in B1 must use kg (or a middleware conversion) for documents mode.

Partial-failure note (documents mode): if the Issue posts but the Receipt is
rejected, the queue row shows exactly what posted — reconcile in B1 before
hitting Retry, otherwise the issue would double-post.

**Testing without a real B1**: `npm run b1:test` runs the whole connector
(login/session, UDO rows for intake/QC/production, Issue+Receipt documents)
against a bundled fake Service Layer (`scripts/fake-b1-server.mjs`) and cleans
up after itself.

## Stack & layout

Next.js 14 (App Router) + TypeScript + Tailwind + Prisma/SQLite (switch `datasource` to
`postgresql` for production). Cookie-session auth (scrypt + HMAC), no external services.

```
prisma/schema.prisma      data model (SQLite: enums→String, JSON→String columns)
prisma/seed.ts            master data + admin; demo batches only with SEED_DEMO=1
scripts/reset-transactions.ts   npm run db:reset — wipe reports/users, keep master data + settings
src/lib/                  spec engine, BS↔AD dates (+ fmtNpt), calc, auth (lockout), audit,
                          numbering, workflow (submit/approve/reject/unlock), sign (+unsign),
                          notify (events → recipients → templates), mail (SMTP queue), weekly
src/app/api/records/...   autosave PATCH + workflow POST (submit/approve/reject/unlock/sign/unsign/delete)
src/app/{intake,qc,production,batches,reports,admin,profile,print}/
src/components/           the three big client forms, charts, shell, sign-off panel
```

## Notes

- Timezone is Asia/Kathmandu (GMT+5:45) for everything — `next.config.mjs` sets `process.env.TZ`;
  the workers set it too. Calendar dates are stored as local midnight.
- To reset to demo data: `rm prisma/dev.db && npm run setup:demo`. To wipe real test data but
  keep master data and settings: `npm run db:reset`.
- Server-side PDF (Playwright print) can be added later; the print views are already
  paper-shaped so it's a drop-in.
