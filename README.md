# SaaS School ERP

One project: **React (Vite) + Tailwind** UI, **Node/Express (TypeScript)** API, **Prisma + PostgreSQL**.
Multi-tenant (every row carries `school_id`), UHF RFID gate attendance, single-screen fee collection.
No Docker, no Redis, no socket.io / bullmq / node-cache: native `Map`, native SSE, and a PostgreSQL `JobQueue` table.

## Layout
    prisma/            schema.prisma, seed.ts
    server/src/        Express API (routes, middleware, lib: scanCache, sse, jobQueue, time)
    client/src/        React app (pages, components)
    scripts/dev.mjs    runs API + UI together
    .env.example

## First run (one install, one env file)
    1. Create an empty PostgreSQL database named school_erp
    2. cp .env.example .env          (Windows: copy .env.example .env) and edit DATABASE_URL, JWT_SECRET
    3. npm install                   (also runs prisma generate)
    4. npm run db:migrate            (creates tables)
    5. npm run seed
    6. npm run dev                   UI http://localhost:5173  |  API http://localhost:4000

Logins: super@saas.com / 123456 (platform)   admin@demo.com / 123456 (Demo School)

## Production (single port, single process)
    npm install
    npm run db:deploy
    npm run build                    builds API to dist/server and UI to client/dist
    npm start                        Express serves API + React on http://localhost:4000

Run it from the project root (it looks for ./client/dist). Keep it alive with PM2 (`pm2 start npm --name school-erp -- start`).

## Commands
| Command | What it does |
|---|---|
| npm run dev | API + UI with hot reload |
| npm run build | Production build of API and UI |
| npm start | Run the production build |
| npm run db:migrate | Create/apply migrations (dev) |
| npm run db:deploy | Apply migrations (production) |
| npm run seed | Demo school, 20 students, fee structure Class 1-12 |

## UHF reader -> server
    POST /api/attendance/scan
    Header: x-reader-key: <READER_API_KEY>
    Body:   {"rfid_uid":"RFID-0001","timestamp":"2026-10-02T08:15:00+05:30"}

Test without hardware:
    curl -X POST http://localhost:4000/api/attendance/scan -H "Content-Type: application/json" -H "x-reader-key: change-me-reader-key" -d '{"rfid_uid":"RFID-0001"}'

Same card within 60 s is ignored. Live feed: `new EventSource('/api/attendance/live-stream?token=<jwt>')`.
Bulk upload sample: sample-students.csv

## Fees module (sub menu: Collect Fee, Fee Records, Fee Reports, Fee Heads, Fee Structure, Custom Fees, Discounts, Discount Report, Fee Collectors)
- **Fee Heads** (admin): create any head - Tuition, Transport, Library, Exam, Lab ... Mark a head "transport only" to charge just students who use transport.
- **Fee Structure** (admin edits, collector views): per class, per head: an amount, **Monthly** or **Yearly**. Empty class shows "No fee is set for Class X. Add a fee structure first."
- **Collect Fee**: enter the unique no (or RFID / phone); the student's fee record shows automatically. **Monthly** is selected by default (pay N months); **Yearly** pays the whole remaining balance. Already-paid months are deducted: Rs 2400/year with 2 months paid (Rs 400) shows Rs 2000 left.
- **Billing month**: billing starts at the student's admission month (April, July, August ...) and always ends in March (financial year April-March). A July admission with Rs 200/month is billed 9 months = Rs 1800. Yearly amounts are pro-rated the same way. Students with no admission date are billed from April.
- **Discounts** (admin): create percent or flat discounts and assign them to students. A collector can also give an **other discount** on the spot per fee head (a reason is required). **Discount Report** lists both kinds: who assigned/gave, when, student, amount.
- **Custom Fees** (admin): a special fee for ONE student per fee head. It replaces the class amount for that student only (empty = class fee, 0 = exempt). A reason is required; who set it and when is kept. Collect Fee marks such rows "Custom fee".
- **Fee Records**: every submitted receipt. Filters: today / yesterday / this week / this month / custom dates, class, payment mode, collector, search (name, unique no, receipt no). Click a column header to sort. **Reprint** opens the receipt marked "DUPLICATE COPY" and counts each reprint. Reprint is also on each row of the student's payment history in Collect Fee.
- **Fee Reports**: collected amount, receipts and students for the chosen period, then class-wise, fee-wise, payment-mode and day-wise tables (sortable). Fee collectors see only their own collections in Records and Reports; the admin sees everyone's.
- **Students who left school**: Students > Edit > untick "Studying in this school". Collect Fee then refuses the payment ("This student has left the school. Fees cannot be collected.") on the screen and on the server. Old receipts can still be viewed and reprinted.
- **Students screen** opens on class-wise counts; choose a class (or search) to see its students. Status filter: Studying / Left school / All.
- Role `FEES_COLLECTOR` sees only the Fees module (Collect Fee + Fee Structure view). Seed login: collector@demo.com / 123456.
- Students: add/edit **admission date** and **uses transport** (admin). CSV columns: unique_no, rfid_uid, name, class, parent_phone, section, uses_transport (yes/no), admission_date (YYYY-MM-DD).
- Present count fixed: active students only, each counted once, DATE compared as DATE.

Upgrading an existing database
    npm run db:migrate        (adds new tables/columns; old tables are kept, nothing is dropped)
    npm run dev               on start the server converts old class fees -> fee heads and old payments -> receipt lines (one time, safe to repeat)
Then open Fees > Fee Structure to check amounts, and Students > Edit to set admission dates (needed for mid-year admissions).


## Latest update

**Packages** - react-router-dom ^7.18.4, tailwindcss ^4.3.3 (with @tailwindcss/vite), vite ^8.3.2 (with @vitejs/plugin-react ^6). Node 20.19+ or 22.12+ is required by Vite 8. Tailwind 4 reads the theme from `client/src/index.css` (`@theme`) instead of `tailwind.config.cjs`; every color, font and grey is pinned to the old values, so the screens look the same. multer was moved to 2.x (the 1.x line has known vulnerabilities).

**Late students** - the Dashboard shows "Late today" next to "Present today (incl. late)"; Attendance shows "Total late" and colors a late arrival in the live gate feed; the monthly report API returns `total_late_days`. A late student still counts as present. Late means arriving after `LATE_AFTER` (default 08:30).

**Fee types** (Fee Structure and Custom Fees) - each fee can be charged:
- Monthly / Yearly: spread evenly over the months billed (can be paid month by month)
- Quarterly: one amount at the start of each quarter (Apr, Jul, Oct, Jan)
- Half-yearly: one amount in April and one in October
- Exam-wise / instalments: you list each instalment with a name, month and amount, e.g. Unit test 1 (June) 100, Half-yearly exam (September) 150, Unit test 2 (December) 100. A student who joins after an exam month is not charged for it. Quarterly and half-yearly fees are pro-rated for the period a student joins in.

**Collect Fee** now has a dropdown: Monthly (default, choose how many months), Quarterly (next 3 months), Half-yearly (next 6 months), Yearly (everything remaining). The amounts per fee are filled in automatically from what is already paid and can still be edited. "Paid up to" shows how far each fee is paid.

**Excel templates** (folder `templates/`, also downloadable inside the app)
- `Student_Template.xlsx` - Students > "Excel template". Upload it back with Students > "Bulk upload Excel / CSV".
- `Attendance_Template.xlsx` - blank template. Attendance > "Download Excel sheet" gives a class list for the selected date with a PRESENT / LATE / ABSENT dropdown; fill it and use Attendance > "Upload Excel / CSV". Uploading again for the same student and date corrects the record.
- Dates can be 2026-07-15 or 15/07/2026. Times are 24-hour HH:MM. Problem rows are reported with their Excel row number. `npm run templates` regenerates the two blank files.

Upgrading an existing database: `npm install`, then `npm run db:migrate` (adds `installments` columns; nothing is dropped).


---

## What is new in this version

Run after unzipping (your database keeps all existing data, new columns have safe defaults):

```
npm install
npx prisma migrate dev --name plans_late_fee_months_backup   # or: npm run db:migrate
npm run dev
```

### 1. Schools (super admin)
Add school now takes contact person, mobile, email, address, city, state, pincode and a **subscription plan** (Monthly / Quarterly / Half-yearly / Yearly, amount, start date, valid-until, which fills itself from the plan length). Click a school name for **View**, **Edit & plan** and **Menus on / off**. The list has search, filters (status, plan, plan status, state) and sortable columns. A plan that has run out is only flagged "Plan expired"; the school is not blocked automatically (use the Active switch for that).

### 2. Analytics (super admin > Analytics)
Per-school numbers for a period (today, week, month, last 30 days, financial year, custom): students, fees collected, receipts, students who paid, discount, attendance %, last payment, plan status. Filters for status, plan, plan status, state, city, search; every column sorts; optional grouping by state / city / plan; charts; **CSV and Excel download**. Each school's own page has a drill-down (collection by month, fee head, payment mode, attendance by day, students by class).

### 3. Menus on / off per school
Schools > school name > **Menus on / off**. Hides the link and the page for that school only. Nothing is blocked in the API and no data is touched, so the owner's other features and reports keep working. Switching **Fees** off hides all fee sub menus.

### 4. Due date and late fee
Fees > **Due Date & Late Fee** (school admin): last date of the month (10, 15 ...) and a flat late fee (₹10, ₹20 ...). If a month is not fully paid by its last date, the late fee is added **once to that month's total**, not to each head: September ₹300 + ₹20 late = ₹320. Late fee is checked month by month using the real payment dates, shows as its own row on Collect Fee, can be waived with "Other discount" (reason is recorded), and applies only to months due on/after the "late fee from" date, so old unpaid months are not charged retroactively.

### 5. Fee Months (which month each fee is taken)
Fees > **Fee Months** (school admin). Tick the months for each fee head, for the **whole school**, one **class**, or one **student** (student beats class beats school). Example: Tuition taken in April, not in May and June, taken again from July. An unticked month charges nothing for that fee (a yearly fee is spread over the ticked months, so its total shrinks with the skipped months; quarterly / half-yearly / custom instalments that fall in an unticked month are dropped).

### 6. Collect Fee
After searching a student there is a **Fee month** dropdown (only months with something unpaid, with the amount due and any late fee), a month strip (✓ paid, red due, – not taken), and Monthly / Quarterly / Half-yearly / Yearly. Payments are now saved **against the month they were paid for**, so a student can pay July while April is paid and May/June are not taken. Receipts (print and reprint) show the fee months and **no balance**; the WhatsApp receipt message no longer shows it either.

### 7. Attendance
- **Total days** is now the school days of the month: every day up to today that is not a weekly off (default Sunday) or a declared holiday, plus any day students were actually marked present. Set weekly off and holidays under "Holidays & weekly off". The monthly report uses the same count, so present can never exceed total.
- Every row has a **checkbox** (ticked = present, unticked = absent) and the header checkbox selects all on the page; "Save attendance" saves the changes. **Mark all present / absent** applies to the whole selected class (or school).
- New: class list from your real classes, search, status filter, sortable columns, **Monthly report** tab with CSV download.

### 8. Backup (Backup menu; super admin can back up one school or the whole platform)
- **Back up now** or **automatic** (every day / Sunday / last day of month / 31 March at the time you choose; runs if the server was off at that moment once it starts again). Choose what to include (students, attendance, fee setup, fee receipts, staff logins without passwords, school profile) and the window (all, today, this week, this month, this financial year).
- Files: **Excel** (.xlsx, one sheet per table), **JSON**, and a **.bak** (always everything for that scope; restore with `psql "$DATABASE_URL" -f file.bak`. For the whole platform it uses `pg_dump` when installed, restore with `pg_restore`).
- **Google Drive**: one copy of each file goes to a Drive folder. Setup once on the server (`.env`): create an OAuth client in Google Cloud Console (Drive API on), get a refresh token (use Google's OAuth Playground with your own client id and the scope `https://www.googleapis.com/auth/drive`), put `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` and `GOOGLE_DRIVE_FOLDER_ID` in `.env`. A service account also works for a Shared Drive. Backups go to a sub folder per school.
- Files are stored in `./backups` (or `BACKUP_DIR`). Keep that folder safe: the .bak contains password hashes.

### 9. Responsive
Phones get a menu button with a slide-in drawer, bottom-sheet pop-ups, full-width filters, 16px inputs (no zoom on iPhone), and **every table turns into stacked cards under 640px**. Tablets and laptops use the sidebar and wrap content; desktops get the full layout.
