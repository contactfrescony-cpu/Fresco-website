# Fresco NY production deployment

## Requirements

- Node.js 20 or newer
- A reverse proxy such as Nginx or a Node-capable platform
- HTTPS certificate for `frescony.uk`

## Install, build and run

The front end is a React (Vite) app compiled into `dist/`; `server.js` serves that build, the gallery API and the image folders.

```sh
npm ci                 # dev dependencies are needed for the build
npm run build          # writes dist/
npm prune --omit=dev   # optional: drop build tooling after building
NODE_ENV=production PORT=8000 HOST=127.0.0.1 TRUST_PROXY=true npm start
```

`npm start` exits with a message if `dist/` is missing. Rebuild after any change under `src/`, `public/` or `index.html`. For local development with live reload use `npm run dev` (binds to 127.0.0.1 only).

Caching: hashed files under `/assets/` are served as immutable for one year; HTML is `no-cache`, so a new build takes effect immediately. Old `*.html` URLs return 301 redirects to the new routes.

On Windows PowerShell, set environment variables with `$env:NODE_ENV='production'` before `npm start`. The application honors a host-provided `PORT`.

Terminate HTTPS at Nginx, Apache, a load balancer, or the hosting platform and proxy requests to the application port. Redirect HTTP to HTTPS and forward `Host`, `X-Forwarded-For`, and `X-Forwarded-Proto` headers.

Use systemd, PM2, Docker, or the host's application manager. Configure its health check as `GET /healthz`; a healthy instance returns HTTP 200 with `{"status":"ok"}`.

## Contact form: enquiries, email and Google Sheet

The Contact page posts enquiries to `POST /api/contact`. Each enquiry is:

1. **saved in MySQL** (`enquiries` table, created by `npm run db:setup`). This is the master copy, shown on the back-office **Enquiries** page (`/admin/enquiries`, administrators and viewers): filter by status, search, assign to a staff member, add internal notes, export CSV;
2. **emailed** as "New enquiry #id" (details below), with a link to that enquiry on the Enquiries page;
3. **copied to a Google Sheet** (below).

When the enquiry is saved, the visitor gets an answer straight away and the email and Sheet copy follow in the background, so a slow mail server or Google never loses an enquiry. If the database is down, the email is sent directly as before.

### Email

The server emails each enquiry to `CONTACT_TO` (default `info@frescony.uk`) with the visitor's address as Reply-To. Set the SMTP details of the sending mailbox in `.env` (see `.env.example`) or the host's environment:

```sh
SMTP_HOST=smtp.example.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=website@frescony.uk
SMTP_PASS=<app password>
CONTACT_TO=info@frescony.uk
```

Restart the server after changing these. Without `SMTP_HOST` the enquiry is still saved (the Enquiries page shows "Email not set up"); only when neither SMTP nor the database is configured does the form fall back to opening the visitor's email app with the enquiry pre-filled. The endpoint validates fields, has a hidden spam honeypot and allows 5 enquiries per IP per 15 minutes.

### Google Sheet copy

Every enquiry becomes one row in a Google Sheet, keyed by its ID in column A. Status and "assigned to" changes made on the Enquiries page update that same row; nothing is ever duplicated. The Sheet is a copy for convenience: the Enquiries page and the database remain the master.

1. Signed in as the Fresco NY Google account, create a Google Sheet (e.g. "Fresco NY Enquiries").
2. In the Sheet: **Extensions -> Apps Script**. Replace the code with `google/enquiries-sheet.gs` and save.
3. **Project Settings -> Script properties**: add `SHEET_SECRET`, a long random string (e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
4. **Deploy -> New deployment -> Web app**, Execute as **Me**, Who has access **Anyone**, then authorise.
5. In the website's `.env` set `SHEETS_WEBHOOK_URL` (the URL ending in `/exec`) and `SHEETS_WEBHOOK_SECRET` (the same secret). Restart the server.
6. Run `npm run sheets:check`. It names the Sheet and sends any enquiries saved before it was connected.

If Google is unreachable, the copy is retried every 10 minutes; the Enquiries page shows how many are waiting and has a **Sync to Sheet now** button. Staff may add their own columns to the right of the script's columns; the script writes only its own.

## Back-office database (MySQL) and staff login

Staff sign in at `/admin/login`. Accounts and roles are stored in MySQL (8.0+). Set the `DB_*` values in `.env` (see `.env.example`), then:

```sh
npm run db:setup                      # creates DB_NAME (default fresco_ny), tables and the 4 roles; safe to re-run
npm run db:create-user -- --username yourid --name "Your Name" --role admin
npm run db:set-password -- --username yourid   # change a password (also signs that person out)
```

`db:create-user` asks for the password (minimum 10 characters). If the login ID already exists, it updates that user's name, role and password instead.

Staff sign in with their **login ID**. No email addresses are stored for staff, so there is no "forgot password" email. An administrator changes forgotten passwords with `npm run db:set-password`. Passwords are stored as bcrypt hashes, so typing a new password straight into the database does not work.

Staff can also create their own account at `/admin/signup`, linked from "Login" in the website footer. They give a login ID (must be unique), password, name, date of birth (18 or older) and gender.

- New accounts have **no role** and cannot sign in until an administrator assigns one under **Users & Roles**, where accounts can also be disabled.
- Sign-up is limited to 5 accounts per IP per hour.
- After updating the code, run `npm run db:setup` once to bring an existing database up to date.

Roles: `admin` (everything), `approver` (review and publish), `contributor` (upload and draft), `viewer` (read-only dashboards). Which role opens which back-office section is set in `src/admin/sections.js`; protect server API routes with `requireRole('approver', ...)` from `server/auth.js`.

Sessions last 12 hours and are stored in the `user_sessions` table as hashed tokens, in an HttpOnly cookie that is marked `Secure` when `NODE_ENV=production` (so production must be served over HTTPS). Login is limited to 10 attempts per IP per 15 minutes. All times are stored in UTC. If MySQL is unreachable, the public website keeps working and only the back office reports that it is unavailable.

## Database on your own server (website hosted elsewhere, e.g. Hostinger)

The website can run on Hostinger while MySQL stays on your own server. It reaches MySQL over the internet through the server's public name (for example `db.example.com`, which forwards port 3306 to the office MySQL machine).

Settings on the hosting side:

```sh
DB_HOST=db.example.com      # a plain name or IP, without https:// or a trailing /
DB_PORT=3306
DB_NAME=fresco_ny
DB_USER=fresco_web           # a dedicated login, see below
DB_PASSWORD=...
DB_SSL=true                  # encrypt the connection over the internet
DB_SSL_CA=                   # optional: path to the server's ca.pem, to also verify the server
```

Run `npm run db:check` on the hosting server. It prints that server's public IP and tests the connection, encryption and speed. If something fails, it says what to fix.

**On the MySQL server** (done by whoever administers it):

1. Create a login just for the website. It may connect only from the hosting server's IP, may only use `fresco_ny`, and must use encryption:

   ```sql
   CREATE USER 'fresco_web'@'HOSTING_SERVER_IP' IDENTIFIED BY 'a-long-random-password' REQUIRE SSL;
   GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON fresco_ny.* TO 'fresco_web'@'HOSTING_SERVER_IP';
   ```

2. In the firewall, allow port 3306 **only** from the hosting server's IP, plus the office for maintenance. The same MySQL server holds other systems' databases, so it must not be open to the whole internet.
3. The public address must not change. Use a static IP or a DNS name such as `db.example.com` that is kept up to date.

If the office internet or that server goes down, the public pages still show their built-in products and photos. The back office (logins, uploads, approvals) waits until the database is reachable again.

## Contributor photo uploads → Google Drive

Contributors have one job in the back office: **Upload Photos** (`/admin/upload`). They pick or drag in raw garment photos (JPG, PNG, WebP or HEIC, up to 25 MB each, up to 50 at a time). Each photo is sent to the Google Drive folder **Unprocessed Garment Images**, where the image pipeline (`fresco-website-automation`) classifies and processes it. Contributors do not choose a category.

The website holds no Google credentials. It hands each photo to a small Google Apps Script, `google/drive-upload.gs`, which runs as the Fresco NY Google account and saves the file into the folder. One-time setup:

1. Signed in to Google as the **Fresco NY account** (the one that owns the Drive folders), open <https://script.google.com>, create a project and paste in `google/drive-upload.gs`.
2. Under **Project Settings → Script properties**, add `FOLDER_ID` (the ID at the end of the Unprocessed Garment Images folder URL) and `UPLOAD_SECRET` (a long random string).
3. **Deploy → New deployment → Web app**, with *Execute as: Me* and *Who has access: Anyone*. Authorise it with the Fresco NY account.
4. In the website's `.env`, set `DRIVE_UPLOAD_URL` (the web-app URL ending in `/exec`) and `DRIVE_UPLOAD_SECRET` (the same secret). Restart the server, then run `npm run drive:check`. It should print the folder name.

Each photo is renamed in Drive to `date_randomid_originalname`, for example `2026-11-02_a1b2c3_IMG_0412.jpg`. This keeps two phones' `IMG_0001.jpg` files from colliding, because the pipeline skips names it has already processed. The uploader and the original file name are written into the Drive file's description. The server checks the real file type from the file's content and only reports success once Drive returns the new file's ID and the stored size matches. Every upload, including failures, is recorded in the `image_uploads` table. The **Recent uploads** list shows each photo's live status, refreshed every minute: *Unprocessed* (still waiting in the input folder), *Processed* (with whether it is waiting for approval, on the website and in which folder, or rejected), or *Failed* (the pipeline moved it to `_failed`, or it never reached Drive). It can be filtered by status. Telling *Failed* apart needs Apps Script version 5; Drive is asked at most every 30 seconds. Contributors see their own history; administrators see everyone's. The limit is 300 photos per user per hour. Run `npm run db:setup` once to create the table on an existing database.

## Approving photos for the website (approvers)

The back-office sidebar has Upload Photos, Website Images, Users & Roles, Enquiries and Analytics; each person sees only the pages their role allows and lands on the first of them (there is no dashboard). Administrators see a badge on Users & Roles when people are waiting for a role.

Approvers have one page in the back office: **Website Images** (`/admin/review`). At the top it is a split screen for the product photos; below that is a separate **Development page photos** section (see the next section).

- **Left: waiting for approval.** These are the finished images the pipeline wrote to `Processed Images/<category>/` in Drive. Each one shows the folder the AI suggests.
- **Right: the website's 8 product folders** and the photos in each.

Dragging a photo onto a folder publishes it straight away. It goes first in the folder. A folder holds up to **20** photos; publishing into a full folder removes its last photo. On touch screens, approvers tap a photo and choose a folder, and use arrow buttons to reorder.

Folders cannot be created. They can be renamed, given a homepage line and Products page text, reordered, hidden from the Products page, or shown on the homepage (up to 4). Photos inside a folder can be reordered, removed, or dragged onto another folder (on phones: the ⇄ button). A moved photo goes first in its new folder, the same 20-photo rule applies, and its Drive file moves to the matching Drive folder. A filter shows all folders, only the homepage folders, or only the Products page folders. Photos that should not be published can be rejected.

How finished images arrive:

- The page asks Drive for new finished images when it opens, every 2 minutes while it is open, and when the approver clicks **Check for new photos**.
- At most 20 new images are fetched each time, and each Drive file is fetched only once.
- The website never moves or deletes anything in *Processed Images*. The pipeline's `_done`, `_failed` and `_logs` folders are ignored.

This needs the **current** `google/drive-upload.gs` (version 3):

1. Paste the new code into the Apps Script project and Save.
2. Make sure the script property `PROCESSED_FOLDER_ID` is set (the ID of the **Processed Images** folder).
3. Go to **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy**. The URL stays the same.
4. Run `npm run drive:check`. It names the folders and warns if an older script version is still deployed.

### Storage: Google Drive is the home of every website photo

| What | Where |
|---|---|
| Published website photos (the files) | Google Drive, in **Fresco Website Images/<website folder>/** in the Fresco NY account. The script creates this folder on first use. |
| Order, folder names, homepage and Products settings, status | MySQL tables `product_categories` and `product_images` |
| Local copies | `media-library/cache/` (published photos) and `media-library/pending/` (photos waiting for approval) |

**Publishing a photo.** Drive copies the finished image from *Processed Images* into the website folder; the pipeline's file stays where it is. The website then shows the photo at `/media/<Drive file id>.webp`.

**Removing a photo.** When a photo leaves the website, either because it is removed or because a full folder rotates, its Drive file goes to the **Drive trash**. It can be recovered there for 30 days.

**Renaming a website folder** also renames its Drive folder.

**Local copies.** The files in `media-library/` are only a cache, filled from Drive. You can delete them at any time and the website downloads the photos again on the next view. To keep the cache elsewhere, set `MEDIA_DIR`.

**Do not edit files in *Fresco Website Images* by hand.** The website tracks each photo by its Drive file. A file moved or deleted in Drive stops showing once the cache is cleared.

**Moving the original photos into Drive (one-off).** On first setup, `npm run db:setup` lists the original photos from `gallery/<folder>/`. Then:

1. Run `npm run media:migrate -- --dry-run` to see the list without changing anything.
2. Run `npm run media:migrate` to upload each photo to Drive, check that every byte arrived, and switch the website to the Drive copy.

It is safe to run again; photos already moved are skipped. The `gallery/` files are not deleted. They stay as the fallback the homepage and Products page use if MySQL is unreachable.

### Development page photos (approvers)

The **Development page photos** section at the bottom of **Website Images** (link at the top of the page) manages the photos of the four Development page sections: 01 Measuring tape, 02 Sewing thread, 03 Needles and 04 Pattern pieces. Each section holds up to **3** photos, which visitors swipe through (arrows on large screens).

- **Add photo** (click, or drop a photo on the slot), **Replace**, **Remove** and the ← → buttons to change the order. Changes are live straight away.
- These photos do **not** go through the AI image pipeline (that is for garment shots). The browser shrinks each photo to at most 2000 px and WebP before uploading; JPG, PNG and WebP work everywhere, iPhone HEIC photos only in Safari.
- Storage is the same as product photos: Google Drive **Fresco Website Images/Development – <section>/**, tracked in `product_categories` (`kind = 'development'`, ids 101–104) and `product_images`. Replaced and removed photos go to the Drive trash.
- **Google Drive is the only source** of these photos: there are no local copies. A section with no photos shows an empty frame, and if the database cannot be reached the sections show empty frames too. The original four pictures were moved into Drive with `npm run media:migrate` (it uploads a section's old `development-images/<key>/` files only while that section has no photos).
- Needs `npm run db:setup` once (adds the `kind` column and the four sections) and Apps Script version 3 or later.

## Gallery updates

Upload JPG, JPEG, PNG, WebP, or AVIF files to the relevant directory under `gallery/` (product pages). The four Development page photo sections have no folders: their photos live in Google Drive and are managed in **Website Images → Development page photos**. On an ephemeral hosting platform, include images in the deployment artifact or migrate them to object storage; runtime uploads will not persist.

## Website analytics (Google Analytics 4)

The public site loads the GA4 tag itself (`src/components/AnalyticsTracker.jsx`) and sends a page view on every page change. It does not track `/admin` pages, `localhost` or office-network (192.168.x / 10.x) addresses, so only real visitors are counted. The production Content-Security-Policy already allows Google's analytics hosts.

The back-office **Analytics** page reads the figures from Google with a service account:

1. Copy the service-account key to `google/ga4-key.json` on the server. It is gitignored, so copy it by hand; it is not in the repository.
2. Set `GA4_PROPERTY_ID` (the numeric property ID) and `GA4_KEY_FILE` in `.env`.
3. In GA4 Admin → Property access management, give the service account's email the Viewer role.

If something is missing or Google refuses access, the Analytics page shows the exact error instead of numbers. New visits take 24–48 hours to appear in GA4's reports. "Active right now" is real time.

The page also shows a separate server visit log (IP, approximate location and device), kept in MySQL `visitor_logs` for 30 days. Bots, staff pages and office-network visits are not logged.

### Daily analytics email

Administrators set the recipients (up to 10) and the send time on the **Analytics** page, under *Daily Email Report*. Viewers can see these settings but not change them. Use **Send test email now** to check delivery. The email contains the previous day's GA4 figures and is sent through the SMTP settings above (`SMTP_*`), so those must be filled in.

The website's own Node server sends it: a scheduler inside `server.js` checks every minute. Settings and status live in MySQL (`analytics_email_settings`, created automatically). Times are in `REPORT_TIME_ZONE` (India time by default).

- **Catch-up:** if the app was stopped or asleep at the send time, the email goes out as soon as the app is running again that day.
- **No duplicates:** each day is recorded in the database before sending, so a restart or a second copy of the app never sends twice.
- **Retry:** if sending fails, the page shows the error and the app tries again every 15 minutes that day.

On hosts that stop idle Node apps, add a cron job in the hosting panel that opens `https://frescony.uk/healthz` a minute before the send time. This wakes the app. Hosting servers usually run on UTC: 08:59 India time is `29 3 * * *`.

## Before DNS cutover

1. Replace illustrative images with approved Fresco NY work.
2. Confirm permission to display every brand name and verify every external URL.
3. Configure the SMTP settings above and send a test enquiry from the live Contact page.
4. Add Fresco NY's analytics and consent configuration before claiming analytics is active.
5. Review the privacy wording against the actual production configuration.
6. Test all pages through HTTPS, including navigation, galleries, `/healthz`, `robots.txt`, and `sitemap.xml`.
