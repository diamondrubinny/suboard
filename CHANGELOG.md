# Changelog

All notable changes to SUBoard. Versions follow [Semantic Versioning](https://semver.org/).

## 1.17.0 — 2026-11-12

### Added
- Guest accounts (module, off by default). An administrator creates an account for an outside party with a mandatory expiry date (90 days by default, a year at most). A guest:
  - sees only the boards it was invited to, as a viewer or an editor — never as an owner;
  - works on items (create, edit, updates, files) and nothing else: no export, structure changes, automations, forms, dashboards, cross-board reports, user list or API tokens;
  - sees the names of people on shared boards only, and never e-mail addresses;
  - must enrol two-step verification before doing anything.
- Guests are marked "אורח" wherever they appear to others (user list, board members, member picker).
- Switching the module off, or reaching the expiry date, signs the guest out and refuses sign-in; the data stays.

### Security
- Guest access is default-deny on the server: one allowlist of API paths (`packages/shared/src/guestAccess.ts`); any new endpoint is closed to guests until listed.

## 1.16.0 — 2026-11-12

### Added
- A "connect boards" column can be pointed at a different board from its options. Existing connections are removed only after an explicit confirmation, items are never deleted, and the change is refused while a mirror column depends on the connection.
- Advanced filter by tracked time (in hours).

## 1.15.0 — 2026-11-12

### Added
- Folders inside a workspace. Managers create, rename and delete them; a board's owner files the board in a folder from the board settings. The boards page and the side menu group boards as "workspace › folder".
- Like workspaces, folders only organise: they grant no access, deleting one never deletes boards, and a folder's name is shown only to people who can see a board in it.

## 1.14.0 — 2026-11-12

### Added
- Webhooks: an optional "item deleted" event. It carries only the item's id, name and parent — not its values.
- Mirror columns that reflect numbers are totalled in each group's summary row.
- Replies to updates have the same format bar as updates (bold, italic, lists).

## 1.13.0 — 2026-11-12

### Added
- Time tracking: a person can correct their own finished entry (length, day, note). Nobody, including board owners, edits someone else's time.
- Webhooks: a failed message is sent again after 30 seconds and after 5 minutes, with the same delivery id. Only the last failure counts towards switching the webhook off. Retries do not survive a server restart; test pings are not retried.

## 1.12.0 — 2026-11-12

### Added
- Action button: besides setting a status it can stamp today's date, assign the person who pressed it, tick a checkbox, or move the item to a group.
- Advanced filter on time of day, week, colour, votes, creation date, connected items, mirrored values and number of files.
- Sorting by connected items, mirrored values, files, tracked time, linked items and colour.
- Formulas can read time of day (as minutes), week, votes, colour and the creation date.

### Fixed
- Board settings no longer scroll sideways on a phone when a column has many action buttons.
- Inserting a column or a function in the formula editor keeps the cursor in place reliably.

## 1.11.0 — 2026-11-12

### Added
- Column types: time of day, week, colour, vote (one per person), creation date, and an action button that sets a status.
- Column options: a description for any column, and a unit and number of decimals for number and formula columns (also in exports).

### Changed
- Updating a column's settings now merges with the existing ones, so saving labels no longer drops the lock, description or unit.

## 1.10.1 — 2026-11-12

### Fixed
- A switched-off module no longer flashes in the side menu while the page loads.

### Removed
- The maintenance-and-inspections kit (built for 1.11.0, never released) was withdrawn: inspections, work permits and the unit's other projects are separate systems. SUBoard is a general work-management platform.

## 1.10.0 — 2026-11-12

### Added
- Time tracking (module off by default): a time column with a start / stop timer and manual entries. Every board member sees an item's total; who logged what is visible only to that person and to the board's owners. Nothing is measured automatically.

## 1.9.0 — 2026-11-12

### Added
- Personal API tokens (module off by default): a user creates a token that lets a script call the API with the user's own permissions. Read-only by default, always expiring, stored as a hash, shown once; closed to account security and administration routes.

## 1.8.0 — 2026-11-12

### Added
- Outgoing webhooks (module off by default): a board owner registers an HTTPS address that receives a signed JSON message when items are created or changed. Targets are restricted against server-side request forgery, redirects are not followed, deliveries are logged, and a failing webhook switches itself off.
- Modules can be "off until enabled"; enabling one that sends data out asks for confirmation.

## 1.7.0 — 2026-11-12

### Added
- Column lock: a board owner can make a column editable by owners only. Editors see it read-only and the server refuses the write on every path (edit, create, bulk edit, import, connect-boards, move between boards). Automations and forms keep working.

## 1.6.0 — 2026-11-12

### Added
- Workspaces: named containers that organise boards in the side menu and on the boards page. They grant no access — a board is still visible only to its members. Managers create, rename and delete them; deleting one keeps its boards.
- Upgrade-path tests: every older database schema migrates to the latest with its data.

## 1.5.0 — 2026-11-12

### Added
- Group the table by a status or people column instead of the board's own groups (saved with the view).
- A board can name its rows ("equipment item", "inspection"); used in the add field.
- Labels can be retired: they stay on the items that have them but are no longer offered.

## 1.4.0 — 2026-11-12

### Added
- Formatting in updates: bold, italic, code, bullet and numbered lists, automatic links for http(s) addresses, with a small toolbar. Stored as plain text and rendered without HTML.
- Files column: the number of files attached to each item; opens the item.

## 1.3.0 — 2026-11-12

### Added
- Advanced filter: rules per column combined with "all" or "any", relative dates ("passed", "in the next N days"), saved with the view.
- Status split ("battery") in each group's summary row.

### Changed
- Removing a status or tag label that items still use now requires a decision — move those items to another label, or clear them on purpose. Previously the values were cleared silently. API: `replaceOptions` on column update.

## 1.2.0 — 2026-11-12

### Added
- "Connect boards" column: pick items of another board in a cell (a fault → its equipment), with a searchable picker.
- Mirror column: shows a column of the connected items (e.g. the maintenance contact's e-mail), always up to date.
- People without access to the connected board see neither the connected items nor the mirrored values.

## 1.1.0 — 2026-11-12

### Added
- Optional modules: a system administrator switches forms, dashboards, workload, the monthly report, trainings, procedures and compliance on or off. A switched-off module leaves the menu, its pages explain why, its API answers 404 and its scheduled jobs stop; its data is kept.
- The side menu can be hidden on wide screens (remembered per browser).

### Changed
- Dates are always shown and typed as dd/mm/yyyy, whatever the browser's language (own date field with a calendar button; the native control followed the browser and showed mm/dd/yyyy in English browsers).
- Navigation, command palette and route guards are built from one registry (`apps/web/src/modules/registry.ts`).

## 1.0.1 — 2026-11-12

### Fixed
- Installer: re-running it to update an existing installation stopped at the code step (git refused the checkout owned by the service user), so servers stayed on the version first installed. Updates now work, and the script prints the old and new revision.

## 1.0.0 — 2026-11-12

First stable release. The `main` branch is the stable line; install or update with `deploy/install.sh`.

### Work management
- Boards with groups, 20 column types (status, people, dates, tags, numbers, risk matrix, inspection checklist, running id, formula, linked-items rollup and more), table / kanban / calendar / timeline / map / files / workload views, saved views, column resize.
- Sub-items up to 5 levels with progress on the parent, "My work", personal reminders and private notes, item templates, duplicate item / group / board, recycle bin, bulk edit, restore a previous value from history.
- Formula columns (safe expression language, no eval) and manual links between items across boards.
- Updates with @mentions, threads, reactions, follow; in-app and e-mail notifications.
- Automations, SLA escalation, recurring items, scheduled reports, custom dashboards, monthly manager report, Excel / CSV / PDF export, CSV / Excel import.

### Safety unit modules
- Forms: one-click form builder, sections, conditional questions, QR and link sharing (signed-in users only), auto-assign and notifications.
- Investigations (5 whys, corrective actions, effectiveness check), periodic compliance tracking, trainings, procedures with read confirmation, QR item cards, floor-plan map.

### Security and accounts
- Sign-in with password, TOTP two-step verification with recovery codes, passkeys (WebAuthn), OpenID Connect SSO and SCIM provisioning (Microsoft Entra ID), self-service password reset, session list and remote sign-out, account lockout, rate limiting, audit log.
- Server-side authorisation on every route, per-board roles, uploads quarantined and scanned with ClamAV, CSP and security headers, hashed session tokens.

### Operations
- One-command installer for Ubuntu / Debian (dedicated address or a folder of an existing site), systemd service, automatic pre-update and daily database backups, nginx / Apache wiring with rollback.
- Hebrew RTL interface, WCAG 2.1 AA oriented (automated axe checks on 137 screens), installable PWA.

### Notes
- The work-permits module was removed before 1.0.0; upgrading an older test installation deletes its permit data (migration 12).
- Legal documents in the app (privacy, terms, cookies, accessibility statement) are technical drafts that require professional review before publication.
