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
npm run setup   # prisma db push + seed (SQLite, demo data included)
npm run dev     # http://localhost:3000
```

**Demo logins** (password `hulas123`): `admin`, `gm` (Manager), `poonam` (QC analyst),
`godown`, `sup.rfm` / `sup.cam` / `sup.chm` / `sup.bjm` (per-mill supervisors).

Seeded demo: batch **RFM-193** (16-Apr-2026 / Miti 3-1-2083) fully populated from the real
scanned forms — wheat intake SA-2083-0001, production DP-2083-0001 (38,542 kg net input,
75.29% main yield, 93.75% efficiency), QC sheets for Maida/Mill Atta/Suji — plus small demo
batches for the Chakki (CAM-87, submitted → try approving), Chiura (CHM-41) and Bhuja
(BJM-28, draft → try editing) mills.

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
- **Yield warnings**: per-mill sanity bands (admin-editable) — e.g. Roller total recovery
  98–103%, Chiura main yield 60–70%. Soft warnings only, never blocking.
- **Autosave**: forms save ~1.2 s after you stop typing; safe to walk away mid-entry.
- **Digital sign-offs (no paper signatures)**: each user draws their signature once on
  `/profile` (mouse/finger/stylus — works on the gate tablet). Submitting a report signs the
  submitter's slot automatically, Approve signs the manager slot, and co-signers (godown
  keeper on intake) sign with one tap on the record's *Digital sign-offs* panel. Every
  signature stores a point-in-time image snapshot + name + timestamp, writes an audit row,
  and *unlocking voids all signatures* — after edits, everyone signs again. Demo users get
  seeded cursive signatures; real users replace them on first sign.
- **Printing**: every report has a paper-style print view (`/print/<type>/<id>`) — use the
  browser's Print → Save as PDF. Prints show the digital signature images with
  "Digitally signed <time> NPT" — nothing left to sign by hand.
- **Exports**: CSV of any filtered list (`Export CSV` on list pages); SAP-shaped JSON per
  record (`Export JSON`), also queued in Admin → Integration outbox.

## SAP Business One integration

Hulas Group runs **SAP B1**, and the connector (`src/lib/connector.ts`) is built
for its Service Layer. Every approval queues a document in `integration_outbox`;
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
prisma/seed.ts            all master data + demo batches (idempotent per fresh db)
src/lib/                  spec engine, BS↔AD dates, calc, auth, audit, numbering, SAP payloads
src/app/api/records/...   autosave PATCH + workflow POST (submit/approve/reject/unlock)
src/app/{intake,qc,production,batches,admin,print}/
src/components/           the three big client forms, charts, shell
```

## Notes

- Timezone is Asia/Kathmandu for "today"; dates are stored as calendar dates.
- To reset demo data: `rm prisma/dev.db && npm run setup`.
- Server-side PDF (Playwright print) can be added later; the print views are already
  paper-shaped so it's a drop-in.
