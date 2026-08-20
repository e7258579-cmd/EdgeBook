/**
 * settingsPage.js — Settings Page
 * EdgeBook — Phase 2 (Settings foundation)
 *
 * Turns the old #settings-popup quick-menu into a real page, reached via
 * the sidebar "Settings" button (showPage('settings')).
 *
 * Sections:
 *   Appearance — Dark/Light theme toggle (migrated from the sidebar).
 *                Reuses the existing toggleTheme()/updateThemeButton()
 *                functions from app.js unchanged — only the button markup
 *                moved, wired to the same #theme-icon / #theme-label ids.
 *   Tools      — Import, Export, Generate Test Data, Trading Rules,
 *                Google Sheets — migrated from the old #settings-popup,
 *                calling the same existing functions.
 *
 * This establishes the pattern (grouped sections, one control per
 * preference) that Phase 3 (Gross/Net toggle) and Phase 4 (Price Move
 * toggle) will add to under a future "Display" section.
 *
 * Depends on globals already defined elsewhere (loaded before this file):
 *   toggleTheme(), MOON_PATH, SUN_PATH          — app.js
 *   openImportWizard()                          — importWizard.js
 *   exportCSV(), seedTestData()                 — app.js
 *   openRulesModal()                            — (existing, unchanged)
 *   openGsModal()                                — googleSheets.js
 *
 * Public API (window.*):
 *   renderSettingsPage()  — called by showPage('settings') in pageShell.js
 */

function renderSettingsPage() {
  const el = document.getElementById('tab-settings');
  if (!el) return;

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

  el.innerHTML = `
    <div class="page-title" id="settings-page-title" style="margin-bottom:1.5rem">Settings</div>

    <div class="section" style="max-width:520px">
      <h2>Appearance</h2>
      <button class="sb-item" id="sb-theme" onclick="toggleTheme()" style="width:auto;display:inline-flex;border-radius:var(--radius)">
        <svg id="theme-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${isDark ? SUN_PATH : MOON_PATH}</svg>
        <span class="sb-label" id="theme-label">${isDark ? 'Light' : 'Dark'}</span>
      </button>
    </div>

    <div class="section" style="max-width:520px;margin-top:1.5rem;padding:0.5rem 0">
      <h2 style="padding:0 1.25rem">Tools</h2>
      <button class="settings-menu-item" onclick="openImportWizard()">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Import
      </button>
      <button class="settings-menu-item" onclick="exportCSV()">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        Export
      </button>
      <div style="height:1px;background:var(--border);margin:4px 0"></div>
      <button class="settings-menu-item" onclick="seedTestData()">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
        Generate Test Data
      </button>
      <div style="height:1px;background:var(--border);margin:4px 0"></div>
      <button class="settings-menu-item" onclick="openRulesModal()">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
        Trading Rules
      </button>
      <button class="settings-menu-item" onclick="openGsModal()">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="9" x2="9" y2="21"/></svg>
        Google Sheets
      </button>
    </div>
  `;
}

// ─── EXPOSE PUBLIC API ─────────────────────────────────────
window.renderSettingsPage = renderSettingsPage;
