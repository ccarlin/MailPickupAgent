# Message Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only `/messageflow` admin page that renders the live email pipeline as a vertical funnel with animated envelopes and cumulative-since-restart counts.

**Architecture:** A pure UMD mapping module (`public/scripts/messageFlow.js`) converts raw metrics into flow values; it is unit-tested from Node and loaded in the browser. A one-line Express router renders `views/messageFlow.pug`, which subscribes to the existing `/status/events` SSE stream and applies the mapping client-side. No changes to core processing or metrics.

**Tech Stack:** Node.js 18+ / CommonJS, Express, Pug, vanilla JS `EventSource`, inline SVG/CSS, ESLint.

**Spec:** `docs/superpowers/specs/2026-10-10-message-flow-design.md`

## Global Constraints

- Node.js 18 or later; the project is **CommonJS** (`require`/`module.exports`).
- **No new npm dependencies.**
- **Do not modify** `app/metrics.js` or `index.js`. This feature is purely additive and read-only.
- Reuse the existing SSE endpoint `GET /status/events` (`routes/status.js:153`); do not add a new streaming endpoint.
- `npm run lint` must pass with no new errors for every task.
- Paths use the repository root as the working directory.
- On Windows, run commands in PowerShell; `node` is on PATH.

---

### Task 1: Flow mapping module + unit test

**Files:**
- Create: `public/scripts/messageFlow.js`
- Create: `test/testMessageFlow.js`
- Modify: `package.json` (add a `messageflowTest` script)

**Interfaces:**
- Consumes: nothing.
- Produces: `computeFlow(metrics) -> flow`, where `flow` has numeric fields `inbound`, `whitelistReached`, `blacklistReached`, `scoringReached`, `thresholdReached`, `whitelisted`, `blacklisted`, `quarantined`, `released`, `deleted`. Exposed as `module.exports.computeFlow` in Node and `window.MessageFlow.computeFlow` in the browser.

- [ ] **Step 1: Write the failing test**

Create `test/testMessageFlow.js`:

```js
const assert = require('assert');
const { computeFlow } = require('../public/scripts/messageFlow.js');

let failures = 0;

function run(name, fn) {
  try {
    fn();
    console.log('PASS  ' + name);
  } catch (err) {
    failures++;
    console.error('FAIL  ' + name + ': ' + err.message);
  }
}

run('all zeros produce zeros', function () {
  const r = computeFlow({ totalProcessed: 0, whitelisted: 0, blacklisted: 0, quarantined: 0, released: 0, deleted: 0 });
  assert.strictEqual(r.inbound, 0);
  assert.strictEqual(r.blacklistReached, 0);
  assert.strictEqual(r.scoringReached, 0);
  assert.strictEqual(r.thresholdReached, 0);
});

run('typical values derive pass-through stages', function () {
  const r = computeFlow({ totalProcessed: 1204, whitelisted: 310, blacklisted: 190, quarantined: 132, released: 514, deleted: 0 });
  assert.strictEqual(r.inbound, 1204);
  assert.strictEqual(r.whitelistReached, 1204);
  assert.strictEqual(r.blacklistReached, 894);
  assert.strictEqual(r.scoringReached, 704);
  assert.strictEqual(r.thresholdReached, 704);
  assert.strictEqual(r.whitelisted, 310);
  assert.strictEqual(r.released, 514);
  assert.strictEqual(r.quarantined, 132);
});

run('never returns negative pass-through values', function () {
  const r = computeFlow({ totalProcessed: 10, whitelisted: 20, blacklisted: 5 });
  assert.strictEqual(r.blacklistReached, 0);
  assert.strictEqual(r.scoringReached, 0);
});

run('missing or non-numeric fields default to zero', function () {
  const r = computeFlow({ totalProcessed: '12', whitelisted: undefined });
  assert.strictEqual(r.inbound, 12);
  assert.strictEqual(r.whitelisted, 0);
  assert.strictEqual(r.blacklisted, 0);
});

if (failures > 0) {
  console.error('\n' + failures + ' test(s) failed');
  process.exit(1);
} else {
  console.log('\nAll Message Flow mapping tests passed');
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node test/testMessageFlow.js`
Expected: FAIL — `Cannot find module '../public/scripts/messageFlow.js'`.

- [ ] **Step 3: Write the module**

Create `public/scripts/messageFlow.js`:

```js
/**
 * Message Flow — pure mapping from raw metrics to flow-chart values.
 * UMD: runnable from Node (unit-tested) and in the browser (/messageflow page).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MessageFlow = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function computeFlow(metrics) {
    const m = metrics || {};
    const totalProcessed = num(m.totalProcessed);
    const whitelisted = num(m.whitelisted);
    const blacklisted = num(m.blacklisted);
    const quarantined = num(m.quarantined);
    const released = num(m.released);
    const deleted = num(m.deleted);

    const blacklistReached = Math.max(0, totalProcessed - whitelisted);
    const scoringReached = Math.max(0, totalProcessed - whitelisted - blacklisted);

    return {
      inbound: totalProcessed,
      whitelistReached: totalProcessed,
      blacklistReached: blacklistReached,
      scoringReached: scoringReached,
      thresholdReached: scoringReached,
      whitelisted: whitelisted,
      blacklisted: blacklisted,
      quarantined: quarantined,
      released: released,
      deleted: deleted
    };
  }

  return { computeFlow: computeFlow };
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node test/testMessageFlow.js`
Expected: PASS — `All Message Flow mapping tests passed`.

- [ ] **Step 5: Add the npm script**

In `package.json`, add a `messageflowTest` entry to `scripts` (place it after `"keywordTest:dev"`):

```json
    "keywordTest:dev": "set NODE_ENV=development&& node test/testKeywordScore.js",
    "messageflowTest": "node test/testMessageFlow.js"
```

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: no errors for the two new files.

- [ ] **Step 7: Commit**

```bash
git add public/scripts/messageFlow.js test/testMessageFlow.js package.json
git commit -m "Add Message Flow metric mapping module and tests"
```

---

### Task 2: Route, menu entry, and static chart page

**Files:**
- Create: `routes/messageFlow.js`
- Create: `views/messageFlow.pug`
- Modify: `server.js` (register router)
- Modify: `views/adminLayout.pug` (menu item)

**Interfaces:**
- Consumes: nothing (page renders zeros; Task 3 wires live data).
- Produces: an authenticated page at `/messageflow` rendering the funnel; DOM element ids `fc-inbound`, `fc-wl-reached`, `fc-bl-reached`, `fc-scoring`, `fc-threshold`, `fc-wl`, `fc-bl`, `fc-released`, `fc-quarantined`, `stat-wl`, `stat-released`, `stat-quarantined`, `stat-bl`, `stat-deleted`, `mf-empty`, `mf-last-update`, `mf-connection-dot`, `mf-connection-text`.

- [ ] **Step 1: Create the router**

Create `routes/messageFlow.js`:

```js
const express = require('express');
const router = express.Router();

router.get('/', function (req, res) {
  res.render('messageFlow', { title: 'Message Flow' });
});

module.exports = router;
```

- [ ] **Step 2: Register the router in server.js**

In `server.js`, add the line directly after the `/ruleHits` registration (currently `app.use('/ruleHits', require('./routes/ruleHitsReport'));` at line 124):

```js
app.use('/ruleHits', require('./routes/ruleHitsReport'));
app.use('/messageflow', require('./routes/messageFlow'));
```

- [ ] **Step 3: Add the menu item**

In `views/adminLayout.pug`, insert this block immediately after the "Rule Hits" `li.menu-item` (the one ending with `span Rule Hits`) and before the "Manage Links" `li.menu-item`:

```pug
          li.menu-item
            a(href='/messageflow')
              i.fas.fa-diagram-project(title="Message Flow" style="width:22px; height:22px; vertical-align:middle; margin-right:8px; font-size:18px; cursor:pointer;"
                onclick="window.open('/messageflow', '_blank'); return false;"
              )
              span Message Flow
```

- [ ] **Step 4: Create the view**

Create `views/messageFlow.pug`:

```pug
extends adminLayout

block css
  link(id="favicon" rel="icon" href="/img/MailPickupAgent.png" type="image/png")
  style.
    .mf-header {
      display: flex;
      align-items: center;
      gap: 14px;
      margin-bottom: 0.75rem;
      flex-wrap: wrap;
    }
    .mf-connection { display: flex; align-items: center; gap: 0.4rem; font-size: 0.8rem; color: #64748b; }
    .mf-connection .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
    .mf-connection .dot.connected { background: #22c55e; }
    .mf-connection .dot.disconnected { background: #ef4444; }
    .mf-connection .dot.connecting { background: #f59e0b; }
    .mf-pill { background: #eef2ff; color: #4338ca; border-radius: 10px; padding: 2px 10px; font-size: 0.68rem; font-weight: 600; }
    .mf-updated { font-size: 0.8rem; color: #94a3b8; }

    .mf-grid { display: flex; gap: 24px; align-items: flex-start; flex-wrap: wrap; }
    .mf-chart { flex: 1 1 420px; min-width: 320px; }
    .mf-chart svg { width: 100%; height: auto; }

    .mf-statcol { flex: 0 0 200px; min-width: 180px; }
    .mf-stat { border-left: 3px solid #6366f1; padding: 2px 0 8px 10px; margin-bottom: 10px; }
    .mf-stat .n { font-size: 1.15rem; font-weight: 700; color: #1e293b; }
    .mf-stat .l { font-size: 0.66rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; }
    .mf-stat.whitelisted { border-color: #16a34a; }
    .mf-stat.released { border-color: #2563eb; }
    .mf-stat.quarantined { border-color: #d97706; }
    .mf-stat.blacklisted { border-color: #dc2626; }
    .mf-stat.deleted { border-color: #64748b; }

    .mf-legend { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 12px; font-size: 0.72rem; color: #475569; }
    .mf-legend span { display: inline-flex; align-items: center; gap: 6px; }
    .mf-legend .sw { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
    .mf-legend code, .mf-footnote code { background: #f1f5f9; border-radius: 4px; padding: 0 4px; }
    .mf-footnote { font-size: 0.72rem; color: #94a3b8; margin-top: 10px; line-height: 1.5; }
    .mf-empty { display: none; text-align: center; color: #94a3b8; font-size: 0.85rem; margin-top: 8px; }

    .fc-stage { fill: #eef2ff; stroke: #6366f1; stroke-width: 1.5; }
    .fc-stage-title { font: 700 10px Roboto, sans-serif; text-anchor: middle; fill: #312e81; }
    .fc-stage-count { font: 700 12px Roboto, sans-serif; text-anchor: middle; fill: #1e293b; }
    .fc-edge { stroke: #94a3b8; stroke-width: 1.6; fill: none; marker-end: url(#mf-arrow); }
    .fc-outcome { stroke-width: 1.5; }
    .fc-outcome-title { font: 600 9px Roboto, sans-serif; text-anchor: middle; }
    .fc-outcome-count { font: 700 11px Roboto, sans-serif; text-anchor: middle; }
    .fc-outcome.wl { fill: #dcfce7; stroke: #16a34a; }
    .fc-outcome.wl .fc-outcome-title, .fc-outcome.wl .fc-outcome-count { fill: #166534; }
    .fc-outcome.bl { fill: #fee2e2; stroke: #dc2626; }
    .fc-outcome.bl .fc-outcome-title, .fc-outcome.bl .fc-outcome-count { fill: #991b1b; }
    .fc-outcome.released { fill: #dbeafe; stroke: #2563eb; }
    .fc-outcome.released .fc-outcome-title, .fc-outcome.released .fc-outcome-count { fill: #1e40af; }
    .fc-outcome.quarantined { fill: #fef3c7; stroke: #d97706; }
    .fc-outcome.quarantined .fc-outcome-title, .fc-outcome.quarantined .fc-outcome-count { fill: #92400e; }

block content
  .mf-header
    .mf-connection
      span.dot.connecting#mf-connection-dot
      span#mf-connection-text Connecting...
    span.mf-updated
      | Last updated: #[span#mf-last-update --]
    span.mf-pill since last restart

  .mf-grid
    .mf-chart
      svg(viewBox="0 0 470 350" role="img" aria-label="Email processing pipeline flow")
        defs
          marker#mf-arrow(viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse")
            path(d="M0,0 L10,5 L0,10 z" fill="#94a3b8")

        path.fc-edge(d="M235,44 V74")
        path.fc-edge(d="M235,108 V138")
        path.fc-edge(d="M235,172 V202")
        path.fc-edge(d="M235,236 V266")

        rect.fc-stage(x="175" y="10" width="120" height="34" rx="8")
        text.fc-stage-title(x="235" y="26") INBOUND
        text.fc-stage-count(id="fc-inbound" x="235" y="40") 0

        rect.fc-stage(x="175" y="74" width="120" height="34" rx="8")
        text.fc-stage-title(x="235" y="90") WHITELIST
        text.fc-stage-count(id="fc-wl-reached" x="235" y="104") 0

        rect.fc-stage(x="175" y="138" width="120" height="34" rx="8")
        text.fc-stage-title(x="235" y="154") BLACKLIST
        text.fc-stage-count(id="fc-bl-reached" x="235" y="168") 0

        rect.fc-stage(x="175" y="202" width="120" height="34" rx="8")
        text.fc-stage-title(x="235" y="218") SCORING
        text.fc-stage-count(id="fc-scoring" x="235" y="232") 0

        rect.fc-stage(x="175" y="266" width="120" height="34" rx="8")
        text.fc-stage-title(x="235" y="282") THRESHOLD
        text.fc-stage-count(id="fc-threshold" x="235" y="296") 0

        path.fc-edge(d="M175,91 H95")
        rect.fc-outcome.wl(x="15" y="77" width="80" height="28" rx="7")
        text.fc-outcome-title(x="55" y="89") Whitelisted
        text.fc-outcome-count(id="fc-wl" x="55" y="100") 0

        path.fc-edge(d="M175,155 H95")
        rect.fc-outcome.bl(x="15" y="141" width="80" height="28" rx="7")
        text.fc-outcome-title(x="55" y="153") Blacklisted*
        text.fc-outcome-count(id="fc-bl" x="55" y="164") 0

        path.fc-edge(d="M295,279 C320,279 320,267 345,267")
        rect.fc-outcome.released(x="345" y="252" width="90" height="30" rx="7")
        text.fc-outcome-title(x="390" y="266") Released
        text.fc-outcome-count(id="fc-released" x="390" y="277") 0

        path.fc-edge(d="M295,287 C320,287 320,301 345,301")
        rect.fc-outcome.quarantined(x="345" y="286" width="90" height="30" rx="7")
        text.fc-outcome-title(x="390" y="300") Quarantined
        text.fc-outcome-count(id="fc-quarantined" x="390" y="311") 0

        rect.fc-envelope(x="-5" y="-3.5" width="10" height="7" rx="1" fill="#6366f1")
          animateMotion(dur="1.6s" repeatCount="indefinite" path="M235,44 V74")
        rect.fc-envelope(x="-5" y="-3.5" width="10" height="7" rx="1" fill="#6366f1")
          animateMotion(dur="2.0s" repeatCount="indefinite" path="M235,172 V202")
        rect.fc-envelope(x="-5" y="-3.5" width="10" height="7" rx="1" fill="#16a34a")
          animateMotion(dur="2.4s" repeatCount="indefinite" path="M175,91 H95")
        rect.fc-envelope(x="-5" y="-3.5" width="10" height="7" rx="1" fill="#dc2626")
          animateMotion(dur="2.8s" repeatCount="indefinite" path="M175,155 H95")
        rect.fc-envelope(x="-5" y="-3.5" width="10" height="7" rx="1" fill="#2563eb")
          animateMotion(dur="2.6s" repeatCount="indefinite" path="M295,279 C320,279 320,267 345,267")
        rect.fc-envelope(x="-5" y="-3.5" width="10" height="7" rx="1" fill="#d97706")
          animateMotion(dur="3.0s" repeatCount="indefinite" path="M295,287 C320,287 320,301 345,301")

    .mf-statcol
      .mf-stat.whitelisted
        .n#stat-wl 0
        .l Whitelisted
      .mf-stat.released
        .n#stat-released 0
        .l Released
      .mf-stat.quarantined
        .n#stat-quarantined 0
        .l Quarantined
      .mf-stat.blacklisted
        .n#stat-bl 0
        .l Blacklisted / Deleted*
      .mf-stat.deleted
        .n#stat-deleted 0
        .l Deleted from queue

  .mf-legend
    span
      i.sw(style="background:#16a34a")
      | Whitelisted
    span
      i.sw(style="background:#2563eb")
      | Released
    span
      i.sw(style="background:#d97706")
      | Quarantined
    span
      i.sw(style="background:#dc2626")
      | Blacklisted / Deleted
    span
      code= '~'
      | estimated
    span
      code= '*'
      | combined counter

  .mf-footnote
    | Counts are live since the last server restart and update automatically. 
    strong= '~'
    | marks pass-through values derived from outcome counters (the agent does not record per-stage tallies). 
    strong= '*'
    | Blacklisted / Deleted combines emails stopped by blacklist rules with emails deleted for scoring ≥ THRESHOLD_DELETE.

  #mf-empty.mf-empty No emails processed yet since the last restart.

block scripts
  script(src='/scripts/messageFlow.js')
```

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 6: Manual verification**

Run: `node server.js`, then open `http://localhost:6245/messageflow` (localhost bypasses auth).
Expected: the page renders the vertical funnel with five stage boxes, four outcome chips (Whitelisted / Blacklisted* on the left; Released / Quarantined on the right), a stat column, legend, footnote, a "Message Flow" menu entry, and all envelopes animating. All counts read `0`. Press Ctrl+C to stop the server.

- [ ] **Step 7: Commit**

```bash
git add routes/messageFlow.js views/messageFlow.pug server.js views/adminLayout.pug
git commit -m "Add Message Flow page, route, and menu entry"
```

---

### Task 3: Live SSE updates

**Files:**
- Modify: `views/messageFlow.pug` (append the SSE client to `block scripts`)

**Interfaces:**
- Consumes: `window.MessageFlow.computeFlow` (Task 1); the `/status/events` SSE stream emitting `full` and `update` events with `totalProcessed`, `whitelisted`, `blacklisted`, `quarantined`, `released`, `deleted`.
- Produces: nothing new (DOM updates only).

- [ ] **Step 1: Append the client script**

In `views/messageFlow.pug`, add this script immediately after the `script(src='/scripts/messageFlow.js')` line inside `block scripts` (the line is currently the last item in that block):

```pug
  script.
    document.addEventListener('DOMContentLoaded', function () {
      function fmt(n) { return (n || 0).toLocaleString(); }

      function setText(id, value) {
        var el = document.getElementById(id);
        if (el) el.textContent = value;
      }

      function applyFlow(data) {
        var flow = window.MessageFlow.computeFlow(data);
        setText('fc-inbound', fmt(flow.inbound));
        setText('fc-wl-reached', fmt(flow.whitelistReached));
        setText('fc-bl-reached', fmt(flow.blacklistReached));
        setText('fc-scoring', fmt(flow.scoringReached));
        setText('fc-threshold', fmt(flow.thresholdReached));
        setText('fc-wl', fmt(flow.whitelisted));
        setText('fc-bl', fmt(flow.blacklisted));
        setText('fc-released', fmt(flow.released));
        setText('fc-quarantined', fmt(flow.quarantined));
        setText('stat-wl', fmt(flow.whitelisted));
        setText('stat-released', fmt(flow.released));
        setText('stat-quarantined', fmt(flow.quarantined));
        setText('stat-bl', fmt(flow.blacklisted));
        setText('stat-deleted', fmt(flow.deleted));
        var empty = document.getElementById('mf-empty');
        if (empty) empty.style.display = flow.inbound === 0 ? 'block' : 'none';
        setText('mf-last-update', new Date().toLocaleTimeString());
      }

      function setConnection(state) {
        var dot = document.getElementById('mf-connection-dot');
        var text = document.getElementById('mf-connection-text');
        if (!dot || !text) return;
        dot.className = 'dot ' + state;
        text.textContent = state === 'connected' ? 'Live' : (state === 'connecting' ? 'Reconnecting…' : 'Disconnected');
      }

      setConnection('connecting');

      var es = new EventSource('/status/events');
      es.addEventListener('full', function (e) {
        try { applyFlow(JSON.parse(e.data)); } catch (err) { /* ignore malformed frame */ }
        setConnection('connected');
      });
      es.addEventListener('update', function (e) {
        try { applyFlow(JSON.parse(e.data)); } catch (err) { /* ignore malformed frame */ }
        setConnection('connected');
      });
      es.addEventListener('auth-error', function () {
        es.close();
        window.location.href = '/login';
      });
      es.onerror = function () {
        setConnection(es.readyState === EventSource.CONNECTING ? 'connecting' : 'disconnected');
      };
    });
```

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no errors. (If ESLint flags the empty `catch` blocks, replace each `catch (err) { /* ignore malformed frame */ }` with `catch (err) { console.debug('messageFlow: bad SSE frame', err); }`.)

- [ ] **Step 3: Manual verification**

Run: `node server.js`, open `http://localhost:6245/messageflow`, and confirm the connection indicator turns green ("Live").
In a second terminal run: `npm test` (sends test emails through the pipeline).
Expected: the funnel counts increase live and the indicator stays green. Press Ctrl+C to stop the server.

- [ ] **Step 4: Commit**

```bash
git add views/messageFlow.pug
git commit -m "Wire Message Flow page to live SSE metrics"
```

---

### Task 4: Dark-mode styling and final verification

**Files:**
- Modify: `public/css/dark.css` (append overrides)

**Interfaces:**
- Consumes: the CSS classes emitted by `views/messageFlow.pug` (Task 2).
- Produces: nothing.

- [ ] **Step 1: Append dark-mode overrides**

Append the following inside the existing `@media (prefers-color-scheme: dark) { ... }` block in `public/css/dark.css` (add it near the other page sections, just before the closing `}` of the media query):

```css
  /* --- Message Flow page --- */
  .mf-connection { color: #94a3b8; }
  .mf-updated { color: #64748b; }
  .mf-pill { background: #17263c; color: #93c5fd; }
  .mf-stat .n { color: #e2e8f0; }
  .mf-stat .l { color: #94a3b8; }
  .mf-legend { color: #94a3b8; }
  .mf-legend code, .mf-footnote code { background: #1f2937; color: #cbd5e1; }
  .mf-footnote { color: #64748b; }
  .mf-empty { color: #64748b; }

  .fc-stage { fill: #1e293b; stroke: #818cf8; }
  .fc-stage-title { fill: #c7d2fe; }
  .fc-stage-count { fill: #f1f5f9; }
  .fc-edge { stroke: #64748b; }

  .fc-outcome.wl { fill: #0b2a1a; stroke: #16a34a; }
  .fc-outcome.wl .fc-outcome-title, .fc-outcome.wl .fc-outcome-count { fill: #6ee7a0; }
  .fc-outcome.bl { fill: #3b1216; stroke: #dc2626; }
  .fc-outcome.bl .fc-outcome-title, .fc-outcome.bl .fc-outcome-count { fill: #fca5a5; }
  .fc-outcome.released { fill: #17263c; stroke: #2563eb; }
  .fc-outcome.released .fc-outcome-title, .fc-outcome.released .fc-outcome-count { fill: #93c5fd; }
  .fc-outcome.quarantined { fill: #2a1d0e; stroke: #d97706; }
  .fc-outcome.quarantined .fc-outcome-title, .fc-outcome.quarantined .fc-outcome-count { fill: #fdba74; }
```

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Manual verification (light + dark)**

Run: `node server.js`, open `http://localhost:6245/messageflow`.
- With the OS/browser in light mode: chart is legible on white.
- Switch the OS to dark mode and reload: the page background, stages, chips, legend, and footnote are all legible (no white-on-white or dark-on-dark).
Press Ctrl+C to stop the server.

- [ ] **Step 4: Confirm no regressions on other pages**

Open `http://localhost:6245/status` and `http://localhost:6245/ruleHits`.
Expected: both still render and function normally (the only shared change is one menu item in `adminLayout.pug`).

- [ ] **Step 5: Commit**

```bash
git add public/css/dark.css
git commit -m "Add dark-mode styles for Message Flow page"
```

---

## Notes for the executor

- The spec is authoritative for behavior; this plan is authoritative for the mechanics. If they disagree, raise it before implementing.
- Do not add per-stage counters or touch `app/metrics.js` / `index.js` — the `~` and `*` notation exists precisely to avoid that.
- All monetary/numeric values on the page come from `computeFlow`; keep the two notations (`~`, `*`) visible so estimates are never mistaken for exact figures.
