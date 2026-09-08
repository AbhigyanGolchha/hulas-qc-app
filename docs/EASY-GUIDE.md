# The Easy Guide — Hulas QC App

*How to change the app, and how to connect it to SAP. No hard words.*

---

## Part 1 — How the app is put together

Think of the app like a restaurant:

- **The database** (`prisma/dev.db`) is the **storeroom**. Every report, batch,
  user, and signature is kept in this one file.
- **The pages** (`src/app/`) are the **dining room**. Each folder is one page of
  the website. For example `src/app/qc/` is the Product QC page.
- **The brain** (`src/lib/`) is the **kitchen**. It has the rules: how specs
  pass or fail, how dates convert between AD and BS, how SAP messages are built.

```
hulas-qc-app/
├── prisma/          the storeroom (database + seed data)
├── src/app/         the pages you see in the browser
├── src/lib/         the rules (specs, dates, SAP, signatures)
└── scripts/         helper tools (SAP setup, SAP practice test)
```

---

## Part 2 — How to develop (change the app)

### Step 1. Start the app in "watch me" mode

```bash
cd hulas-qc-app
npm run dev
```

Open **http://localhost:3000**. This mode is magic: when you save a code file,
the page in the browser updates **by itself**. You do not restart anything.

### Step 2. Make a change

1. Find the page you want to change inside `src/app/`.
   (Example: the login page is `src/app/login/`.)
2. Edit the file. Save it.
3. Look at the browser. Your change is already there.

The easiest way: **ask Claude Code to make the change for you**, then just check
the browser to see if you like it.

### Step 3. If you change the database shape

Only needed when you add a NEW kind of data (a new column or table):

```bash
npm run db:push
```

### Step 4. Start testing from zero (keep the setup, throw away the reports)

```bash
npm run db:reset
```

This deletes every report, batch, signature and every user except `admin`,
but keeps mills, products, spec limits, suppliers, SAP and email settings.
Admin is asked to choose a new password at the next sign-in.

### Step 5. Broke everything? Fresh demo

This erases ALL data and gives you a fresh demo with demo logins. Only do
this on a practice computer, never on the real plant server:

```bash
rm prisma/dev.db
npm run setup:demo
```

(`npm run setup` without `:demo` gives a clean install with only master data
and one admin account — that is what the plant server should get.)

---

## Part 2b — People, passwords and emails

- **Accounts** are made in **Admin → Users**. Fill name, username, email and
  role, press *Create account*. The app shows a temporary password **once**
  (and emails it if the person has an email). They pick their own password
  the first time they sign in.
- **Forgot password?** Admin → Users → open the person → *Reset password*.
- **Locked out?** After 5 wrong passwords an account locks for 15 minutes.
  Admin → Users → *Unlock now* if they can't wait.
- **Emails** go out through **Admin → Notifications**. Fill in the SMTP
  server (for Microsoft 365: `smtp.office365.com`, port 587, the mailbox
  login; for Gmail: `smtp.gmail.com`, port 587, an *App password*), tick
  *Send emails*, press *Send test*. Then tick, per event, which roles should
  be told (managers get "submitted", the preparer always gets "approved" /
  "rejected", admins get "SAP failed", and so on). Until email is switched
  on, the log at the bottom still shows what *would* have been sent.
- Every person can mute events and set their own email on **My profile**.

### The golden rule

- **Practice on your laptop.** Change things, break things, it's fine.
- **The plant server is the real one.** Only copy changes there after they work
  on your laptop. On the server, run the "always on" mode:

```bash
npm run build
npm run start
```

---

## Part 3 — SAP (Business One) — currently switched OFF

Since 2026-09-08 the app does **not** send anything to SAP. Approved reports
stay in the app. The only SAP feature in use is **Pull suppliers from SAP**
(Admin → SAP Business One), which keeps the supplier list the same as B1's.

If one day you want approved reports to land in SAP again: Admin → SAP
Business One → tick **Post approved reports to SAP** → Save. Then the rest of
this part applies.

The app already knows how to talk to SAP. Think of it like a **post office**:

1. When a manager **approves** a report, the app writes a letter (a small
   packet of data) and puts it in the **outbox**.
2. The post office (the connector) **delivers** each letter to SAP.
3. If SAP is asleep or says no, the app **tries again** — up to 5 times. After
   that the letter is marked **FAILED** with a Retry button, so nothing is
   ever lost silently.

You can watch the outbox any time: **log in as admin → Admin → Integration
outbox**.

### Step 1. Ask IT for three things

Send this exact message to the SAP/IT person:

> "Please give me for SAP Business One:
> 1. the **Service Layer URL** (looks like `https://our-b1-server:50000`),
> 2. the **Company database name**,
> 3. a **technical user + password** that is allowed to create documents."

You cannot skip this step. Without these three things, nothing connects.

### Step 2. Type them into the app

1. Log in as **admin**.
2. Go to **Admin → SAP connection**.
3. Pick profile **b1**, fill in the URL, company DB, and user.
4. Press **Test connection**. Green = good. Red = the message tells you what's
   wrong (usually a typo in the URL or a wrong password).

### Step 3. Run the one-time setup

This creates the app's own little table inside SAP (called `HULAS_QC`) where
QC reports will land. Run it **once**, with a superuser login:

```bash
npm run b1:provision
```

### Step 4. Turn on auto-send

In **Admin → SAP connection**, switch **auto-send** ON and keep production
mode on **udo** (the simple mode — it works even before SAP items are mapped).

That's it. From now on, every approved report flies into SAP by itself.

### Optional Step 5. Keep a delivery robot running

If you want deliveries retried around the clock even when nobody opens the
app, keep this running on the server:

```bash
npm run sap:worker
```

---

## Part 4 — Practice SAP without real SAP

You don't need the real SAP to practice! The app ships with a **pretend SAP**
(a toy server that answers like the real one). Run:

```bash
npm run b1:test
```

You should see lines ending in `ok: true` and then `cleaned up`. That means
the whole connection dance works. (Verified working on 2026-07-26.)

---

## Part 5 — When something goes wrong

| Problem | What to do |
|---|---|
| Page shows an error | Look at the terminal where `npm run dev` runs — the real error is printed there. Copy it to Claude Code. |
| SAP row says FAILED | Admin → Integration outbox → read the error → fix (usually password/URL) → press **Retry**. |
| "Test connection" is red | Check the URL has `https://` and port `:50000`, and the password is right. |
| Forgot a password | Log in as `admin` and reset the user in Admin → Users. |
| Account locked | Wait 15 minutes, or Admin → Users → Unlock now. |
| Emails not arriving | Admin → Notifications → *Test SMTP login*; read the red error; check the person has an email address and hasn't muted the event on their profile. |
| Production report says recovery is over 100% | The "Semi-finished" column is only for product **not yet packed**. Don't type the packed weight there again — the pack columns already count it (as bags). |
| App won't start | `npm install` again, then `npm run dev`. |

---

## Cheat sheet — every command on one line each

```bash
npm run dev          # develop: start app, auto-reloads on save
npm run build        # server: prepare the fast version
npm run start        # server: run the fast version
npm run setup        # FRESH database: master data + one admin (clean install)
npm run setup:demo   # FRESH database + demo logins + demo reports (practice only)
npm run db:reset     # wipe reports/users, KEEP master data + SAP/email settings
npm run db:push      # apply database shape changes
npm run b1:test      # practice SAP with the pretend server
npm run b1:provision # one-time real-SAP setup (needs superuser)
npm run sap:worker   # delivery robot: keeps retrying SAP sends
npm run mail:worker  # email robot: keeps retrying queued emails
```
