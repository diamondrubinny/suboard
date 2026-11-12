# Changelog

All notable changes to SUBoard. Versions follow [Semantic Versioning](https://semver.org/).

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
