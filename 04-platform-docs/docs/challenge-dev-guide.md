# LiterStella Challenge Development Guide

This document is written as a handoff guide for another CLI or coding agent. Use it as the implementation reference for the LiterStella Challenge program.

## Quick Context

- Product: LiterStella Challenge, also called "YaNaWan".
- App path: `02-challenge/literstella-challenge`.
- Docs path: `04-platform-docs/docs`.
- Current frontend: React + Vite.
- Main files:
  - `02-challenge/literstella-challenge/src/App.jsx`
  - `02-challenge/literstella-challenge/src/styles.css`
  - `02-challenge/literstella-challenge/package.json`
- Current state: prototype UI with mock data, local React state, Recharts charts, Lucide icons, and placeholder links.
- Known issue: several existing Korean strings in the current app and docs are mojibake. Treat user-facing Korean copy as needing UTF-8 replacement before production.

## Local Commands

Run from `02-challenge/literstella-challenge`.

```bash
npm install
npm run dev
npm run build
npm run preview
```

The app is a Vite app. `npm run dev` currently runs `vite --host 0.0.0.0`.

## Product Goal

Build a paid reading habit challenge that moves a participant through:

1. Payment
2. Application
3. Public declaration
4. Daily certification
5. Badge and streak tracking
6. Hall of Fame completion records

The 13th cohort default goal is 30 days. Extension goals are 66 days and 100 days. The 90-day goal is legacy-only and should appear only in historical records unless a new cohort explicitly restores it.

## Core User Roles

- Visitor: sees landing page, payment CTA, program explanation, Hall of Fame preview.
- Paid applicant: can open and submit the challenge application.
- Participant: can access dashboard, submit daily reading certification, view progress.
- Admin/operator: reviews payments, applications, certification logs, cohort status, refunds/donations, and Hall of Fame records.

## Required Screens

### Landing

Purpose: convert visitor to paid applicant.

Required sections:

- Hero with cohort name, default goal, and primary CTA.
- Payment notice with clear paid-only application rule.
- Program flow: payment, application, declaration, certification, badges, Hall of Fame.
- Goal tiers: 30, 66, 100, legacy 90.
- Personal tracker preview.
- Live challenge board preview.
- Hall of Fame preview.
- FAQ or policy section for refund/donation rules.

### Application

Purpose: make the participant define a concrete reading plan.

Required fields:

- Name or nickname
- Email
- Naver Cafe nickname or profile URL
- Country/time zone
- Cohort ID
- Goal days: 30, 66, 100
- Selected book list
- Reading method
- Daily reading time
- Declaration URL
- Agreement checkboxes

### Participant Dashboard

Purpose: daily execution and motivation.

Required blocks:

- Today certification status
- Day grid for target duration
- Streak, certified days, rest days, remaining days
- Current books
- Recent certification logs
- Badge archive
- Weekly trend chart
- Reading method distribution
- Community leaderboard

### Certification Form

Required fields:

- Book
- Page range or chapter
- Reading mode
- Short learning log
- External proof URL, usually Naver Cafe
- Optional image/proof attachment in a later version

Validation:

- One certification per participant per challenge day.
- Page range and log are required.
- Proof URL can be optional in prototype, but production should enforce it if the cohort policy requires public cafe proof.
- Duplicate same-day submissions should return a clear error and should not increment streak.

### Admin

Minimum admin workflows:

- Mark payment as confirmed.
- Approve or reject application.
- Review daily certifications.
- Adjust rest days manually.
- Export cohort progress CSV.
- Promote successful participants to Hall of Fame.
- Record refund/donation or reward outcome.

## Data Model

Use these entities even if the first implementation stores mock data.

### `challenge_cohorts`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `slug` | text | Example: `yanawan-13` |
| `title` | text | Display name |
| `default_goal_days` | int | Usually 30 |
| `starts_at` | date | Cohort start date |
| `ends_at` | date | Default goal end date |
| `status` | text | `draft`, `open`, `active`, `closed` |
| `payment_url` | text | External payment link |
| `application_url` | text | If using external form temporarily |

### `challenge_participants`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `user_id` | uuid | Auth user ID |
| `cohort_id` | uuid | FK to cohort |
| `nickname` | text | Public display name |
| `country` | text | ISO or display string |
| `timezone` | text | Example: `Asia/Seoul` |
| `goal_days` | int | 30, 66, or 100 |
| `status` | text | `applied`, `approved`, `active`, `completed`, `dropped` |
| `payment_status` | text | `pending`, `paid`, `refunded`, `donated` |
| `declaration_url` | text | Public declaration URL |
| `started_at` | date | Participant start date |

### `challenge_books`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `participant_id` | uuid | FK |
| `title` | text | Book title |
| `route` | text | Example: Harry Potter, classic, free reading |
| `target_scope` | text | Optional page/chapter goal |
| `status` | text | `planned`, `reading`, `completed`, `paused` |

### `challenge_certifications`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `participant_id` | uuid | FK |
| `book_id` | uuid | FK |
| `challenge_day` | int | 1-based day number |
| `certified_on` | date | Local challenge date |
| `pages` | text | Page range or chapter |
| `mode` | text | Reading mode |
| `log` | text | Learning log |
| `proof_url` | text | External URL |
| `status` | text | `submitted`, `approved`, `rejected` |

Create a unique constraint on `(participant_id, certified_on)` or `(participant_id, challenge_day)` depending on final policy.

### `challenge_badges`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `participant_id` | uuid | FK |
| `badge_type` | text | Example: `day_3`, `day_7`, `day_10`, `day_30` |
| `earned_at` | timestamptz | Award time |

### `challenge_hall_of_fame`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `participant_id` | uuid | FK |
| `cohort_id` | uuid | FK |
| `type` | text | `success`, `challenge` |
| `title` | text | Public achievement title |
| `summary` | text | Short description |
| `badge_labels` | text[] | Display badges |
| `published` | boolean | Public visibility |

## API Contract

Use these route names as the default contract. Implement as Supabase calls, serverless functions, or API routes depending on the chosen backend.

### Public

- `GET /challenge/cohorts/current`
- `GET /challenge/leaderboard?cohort=yanawan-13`
- `GET /challenge/hall-of-fame`

### Participant

- `GET /me/challenge`
- `POST /me/challenge/application`
- `POST /me/challenge/certifications`
- `GET /me/challenge/certifications`
- `GET /me/challenge/badges`

### Admin

- `GET /admin/challenge/cohorts/:id/participants`
- `PATCH /admin/challenge/participants/:id`
- `PATCH /admin/challenge/certifications/:id`
- `POST /admin/challenge/hall-of-fame`
- `GET /admin/challenge/cohorts/:id/export`

## Frontend Implementation Notes

Keep the current design direction: dark library, gold accent, readable dashboard, and dense operational UI.

Recommended component split:

- `src/App.jsx`: routing shell only.
- `src/data/mockChallengeData.js`: mock data until backend exists.
- `src/components/LandingHero.jsx`
- `src/components/ProgramFlow.jsx`
- `src/components/ApplicationForm.jsx`
- `src/components/ChallengeDashboard.jsx`
- `src/components/CertificationForm.jsx`
- `src/components/ProgressCharts.jsx`
- `src/components/HallOfFame.jsx`
- `src/components/AdminChallengePanel.jsx`

State rules:

- Derived stats should be computed from certifications, not manually duplicated.
- Do not increment streak until certification submit succeeds.
- Badge eligibility should be derived from approved certification count.
- UI should support 30, 66, and 100 day grids without hard-coded 30-day assumptions.

Copy rules:

- Replace mojibake with clean UTF-8 Korean.
- Use "야나완" consistently for the Korean product name.
- Keep "LiterStella Challenge" for English/technical labels.
- Avoid user-facing implementation notes such as "Supabase pending" inside production UI.

## Business Rules

- 30-day completion: eligible for full refund or donation according to cohort policy.
- 66-day completion: eligible for 50% discount on next challenge.
- 100-day completion: eligible for free entry to next challenge.
- Rest days can exist, but must be explicit in cohort policy.
- Public declaration is required before challenge activation if the cohort uses Naver Cafe commitment.
- Hall of Fame has two categories:
  - Success Hall: book/project completion.
  - Challenge Hall: long-term consistency or repeated cohort participation.

## Acceptance Criteria

Use this checklist before considering an implementation complete.

- Landing page works on desktop and mobile.
- Payment and application CTAs are wired to real URLs or documented placeholders.
- Participant can submit a valid daily certification.
- Duplicate same-day certification is blocked.
- Certification updates grid, count, streak, recent log, and chart data.
- 30, 66, and 100 day goal lengths render correctly.
- Badge unlocks occur at 3, 7, 10, and 30 days.
- Hall of Fame separates Success Hall and Challenge Hall.
- Build passes with `npm run build`.
- Korean text is readable UTF-8, with no mojibake.

## Suggested Development Order

1. Fix user-facing Korean copy and extract mock data.
2. Split `App.jsx` into focused components.
3. Make goal length dynamic.
4. Implement certification submit flow against mock service.
5. Add backend schema and persistence.
6. Add auth and participant-scoped data access.
7. Add admin review flows.
8. Replace placeholder payment/application links.
9. Run responsive UI verification.
10. Build and deploy.

## Prompt For Another CLI

Use this prompt when handing the work to another CLI:

```text
You are working in E:\LiterStella Project\LiterStella-DEV.
Read 04-platform-docs/docs/challenge-dev-guide.md first.
Implement the LiterStella Challenge program in 02-challenge/literstella-challenge.
Preserve the current React + Vite stack, lucide-react icons, Recharts charts, and dark library visual direction.
Keep edits scoped to the challenge app and docs unless backend/schema work is explicitly requested.
Before coding, inspect src/App.jsx, src/styles.css, package.json, and this guide.
First priority: replace mojibake Korean copy, split the prototype into maintainable components, and make the 30/66/100 day goal system data-driven.
Verify with npm run build.
```
