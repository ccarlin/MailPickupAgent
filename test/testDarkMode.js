const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const DARK_CSS = path.join(ROOT, 'public', 'css', 'dark.css');
const ADMIN_LAYOUT = path.join(ROOT, 'views', 'adminLayout.pug');
const LOGIN = path.join(ROOT, 'views', 'login.pug');

function read(src) {
  return fs.readFileSync(src, 'utf8');
}

function describe(selector) {
  return selector.replace(/\s+/g, ' ').trim();
}

const REQUIRED_SURFACES = [
  // layout shell (adminLayout.pug inline styles)
  'html, body',
  '.top-banner',
  '.left-column',
  '.right-column',
  '.collapsible-header',
  '.left-column li.menu-item',
  '.left-column h2',
  '.right-column h2',
  '.footer',
  '.modal-box',
  '.modal-header',
  '.modal-body',
  // shared admin.css components
  '.gridjs-container',
  '.gridjs-th',
  '.gridjs-td',
  'tbody tr',
  '.gridjs-footer',
  '.gridjs-pagination button',
  '.mui-card',
  '.mui-divider',
  '.mui-empty',
  '.mui-btn',
  '.action-btn',
  '.mui-filters-row .mui-filters-right input',
  '.mui-multiselect-toggle',
  '.mui-multiselect-dropdown',
  '.mui-filter-banner',
  '.preview-modal-content',
  '.info-modal-content',
  '.listing-modal-content',
  '.info-field',
  '.info-field-value',
  '.info-reason-box',
  '.header-bar',
  '.btn-outline',
  '.toast',
  // configHistory/ruleHits shared editor surfaces
  '.tab',
  '.backup-list',
  '.viewer-toolbar',
  '.viewer-content',
  '.diff-line.added',
  '.diff-line.removed',
  '.diff-line.unchanged',
  '.modal',
  // configEditor & rulesEditor
  '.section-header',
  '.combo-grid th',
  '.combo-grid td',
  '.list-item',
  '.inline-form input',
  '.field input',
  '.field select',
  // status page
  '.status-card',
  '#server-offline',
  '.status-card.pending.alert',
  '.highlight-flash',
  // mailq card view
  '.email-card',
  '.email-header h3',
  '.email-body p',
  '.last-updated',
  '#listingAddressList',
  '.preview-modal-content',
  // manage links / sessions / notifications / rule hits
  '.summary-bar',
  '.generate-section',
  '.generated-link',
  '.keys-table th',
  '.keys-table td',
  '.summary-card',
  '.smtp-totals-row',
  '.reason-subrow',
  '.mui-card-header',
  // login page
  '.login-card'
];

function run() {
  const failures = [];

  try {
    assert.ok(fs.existsSync(DARK_CSS), 'public/css/dark.css does not exist');
  } catch (e) {
    failures.push(String(e.message));
  }

  const css = fs.existsSync(DARK_CSS) ? read(DARK_CSS) : '';

  if (css) {
    assert.ok(
      css.includes('@media (prefers-color-scheme: dark)'),
      'dark.css must define the @media (prefers-color-scheme: dark) block'
    );
    assert.ok(
      /color-scheme\s*:\s*dark/i.test(css),
      'dark.css must declare color-scheme: dark so form controls/scrollbars render dark'
    );
  }

  // Toggle wire-up: every page must load dark.css.
  for (const file of [ADMIN_LAYOUT, LOGIN]) {
    const name = path.basename(file);
    try {
      const content = read(file);
      assert.ok(
        content.includes('/css/dark.css'),
        `${name} must link /css/dark.css`
      );
    } catch (e) {
      failures.push(`${name}: ${e.message}`);
    }
  }

  // Coverage: every major light-mode surface must have a dark override.
  if (css) {
    for (const sel of REQUIRED_SURFACES) {
      try {
        assert.ok(
          css.includes(describe(sel)),
          `no dark override for: ${describe(sel)}`
        );
      } catch (e) {
        failures.push(String(e.message));
      }
    }
  }

  if (failures.length) {
    console.error(`Dark mode checks FAILED (${failures.length}):`);
    failures.forEach(f => console.error('  - ' + f));
    process.exitCode = 1;
  } else {
    console.log('Dark mode checks PASSED.');
  }
}

if (require.main === module) {
  run();
}

module.exports = { run, REQUIRED_SURFACES };