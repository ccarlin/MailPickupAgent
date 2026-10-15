# Message Flow — Live Email Pipeline Visualization

**Date:** 2026-10-10
**Status:** Approved (design), pending implementation
**Route:** `/messageflow`
**Menu label:** "Message Flow"

## Overview

Add a read-only admin page that renders the email-processing pipeline as a live
flow chart: emails enter at the top and pass through the agent's stages, with
terminal outcomes branching off the side. Counts are cumulative **since the last
server restart** and update in real time. Animated envelopes travel along the
arrows to convey "mail flowing".

The page is purely additive and read-only. It reuses the existing live metrics
and the existing Server-Sent Events (SSE) stream. **No changes are made to core
email processing** (`index.js` `processEmail`) and no new metrics are recorded.

## Goals

- Give operators an intuitive, at-a-glance picture of where inbound mail goes.
- Show live cumulative volumes per stage and per terminal outcome.
- Reuse existing infrastructure (metrics + `/status/events` SSE); no new
  backend data pipeline.
- Match the existing admin UI styling and dark-mode support.

## Non-goals

- Accurate per-stage pass-through counts. The current counters cannot provide
  them; middle-stage values are **estimated** and clearly marked (see
  [Data mapping](#data-mapping)).
- Historical / date-range analysis (the processing logs already support that
  elsewhere).
- Any write actions, configuration, or interaction beyond live display.
- Changing, adding to, or refactoring `app/metrics.js` or `index.js`.

## Pipeline being visualized

Derived from `processEmail` in `index.js:210`:

1. **Inbound** — email picked up from the MailEnable queue.
2. **Whitelist** — whitelisted senders/IPs/countries are released immediately.
3. **Blacklist** — TLD, sender, IP, country, and combo rules delete the email.
4. **Scoring** — allowed-countries penalty, keyword filters, SpamAssassin, AI
   check, and AbuseIPDB accumulate a spam score.
5. **Threshold** — the score is compared against `THRESHOLD_QUARANTINE` and
   `THRESHOLD_DELETE`.
6. **Outcomes** — Whitelisted, Released, Quarantined, Deleted (blacklisted).

The high-level chart collapses the blacklist sub-rules into one **Blacklist**
node and the scoring sub-checks into one **Scoring** node, per the chosen
"high-level stages only" detail level.

## Architecture & components

All changes are additive.

| File | Change | Purpose |
|---|---|---|
| `routes/messageFlow.js` | new | Express router; `GET /` renders the view |
| `views/messageFlow.pug` | new | Chart markup + SSE client |
| `views/adminLayout.pug` | edit | Add "Message Flow" menu item in the reporting group |
| `server.js` | edit | Register the router |
| `public/css/dark.css` | edit | Dark-mode overrides for the chart classes |

### Live data source (reuse, no new endpoint)

The page subscribes to the **existing** `/status/events` SSE endpoint
(`routes/status.js:153`). That endpoint already emits:

- a `full` event on connect (all metrics + uptime), and
- `update` events on each `metricUpdate` (debounced 50 ms),

with fields: `totalProcessed`, `whitelisted`, `blacklisted`, `quarantined`,
`released`, `deleted`, `uptimeFormatted`. These are exactly the values the chart
needs. Because `/messageflow` and `/status/events` share the same origin and
session cookie, `EventSource` authenticates normally through the existing auth
middleware. The client also handles the `auth-error` event by redirecting to
`/login`.

### Router

`routes/messageFlow.js` mirrors the simplest existing routers (e.g.
`routes/ruleHitsReport.js:60`):

```js
router.get('/', (req, res) => res.render('messageFlow', { title: 'Message Flow' }));
```

Registered in `server.js` alongside the other authenticated routes.

## Data mapping

The chart is rendered from the metric values above. Exact vs estimated:

| Node / chip | Value | Exactness |
|---|---|---|
| Inbound | `totalProcessed` | exact |
| Whitelist reached | `max(0, totalProcessed)` | exact (all inbound reach it) |
| → Whitelisted chip | `whitelisted` | exact |
| Blacklist reached | `max(0, totalProcessed − whitelisted)` | estimated (`~`) |
| Blacklisted / Deleted chip | `blacklisted` | exact, but **combined** (`*`) |
| Scoring reached | `max(0, totalProcessed − whitelisted − blacklisted)` | estimated (`~`) |
| Threshold reached | same as Scoring reached | estimated (`~`) |
| Released chip | `released` | exact |
| Quarantined chip | `quarantined` | exact |
| Deleted-from-queue chip | `deleted` | exact (admin deletions) |

Notes:

- All estimates use `Math.max(0, …)` to avoid negative values.
- **`blacklisted` is overloaded.** In `index.js` it is incremented both for
  immediate blacklist matches (TLD/sender/IP/country/combo) **and** for
  score-based deletions (`score >= THRESHOLD_DELETE`). The chart therefore
  labels this chip "Blacklisted / Deleted" and marks it with `*`.
- A footnote on the page states that `~` values are estimated and `*` is a
  combined counter.

## UI

- **Layout:** vertical funnel, stages top→bottom down the center. `Whitelisted`
  and `Blacklisted / Deleted` branch to the left; `Released` and `Quarantined`
  branch to the right. Matches the approved mockup.
- **Envelopes:** small envelope glyphs animate along the stage arrows and the
  terminal branches (CSS/SMIL animation), giving the "mail flowing" effect.
- **Header:** title, a green "Live" connection dot, "Last updated" timestamp
  (mirrors `views/status.pug`), and a "since last restart" pill.
- **Stat column:** a compact right-hand list repeating the four outcomes plus
  admin deletions.
- **Legend + footnote:** color key for outcomes and the `~` / `*` notation.
- **Styling:** card look consistent with `views/status.pug` /
  `views/ruleHitsReport.pug`. Outcome colors: green `#16a34a` (Whitelisted),
  blue `#2563eb` (Released), amber `#d97706` (Quarantined), red `#dc2626`
  (Blacklisted/Deleted).
- **Dark mode:** new classes added under
  `@media (prefers-color-scheme: dark)` in `public/css/dark.css`, following the
  existing pattern.

## Error handling & edge cases

- **SSE disconnect:** show a "Reconnecting…" state and retain the last known
  values (same pattern as `views/status.pug`).
- **`auth-error`:** redirect to `/login`.
- **All-zero metrics:** render the funnel with zeros and a short empty hint
  ("No emails processed yet since the last restart").
- The page is a static, long-lived view; the SSE stream may idle-timeout — this
  is acceptable because the last-known values remain legible.

## Testing & verification

The project has no unit-test runner (it uses ESLint plus standalone test
scripts).

- `npm run lint` passes with no new errors.
- Manual verification:
  1. `node server.js`, open `/messageflow`.
  2. Confirm the numbers match `/status`.
  3. Run `npm test` and confirm the funnel counts and animations update live.
  4. Toggle OS dark mode and confirm the chart remains legible.

## Risks

- If the overloaded `blacklisted` counter ever changes semantics, the `*`
  labelled chip and footnote must be revisited.
- Coupling to `/status/events` means any future change to that event's field
  names affects this page; the fields used are stable, existing dashboard
  fields.
