/**
 * main.js — Application entry point
 *
 * Instantiates all modules, wires them together, restores persisted state,
 * pre-fetches the monster list in the background, and renders the initial UI.
 */

import { StorageManager }      from './StorageManager.js';
import { SystemAdapter5e }     from './SystemAdapter5e.js';
import { SystemAdapterOpen5e } from './SystemAdapterOpen5e.js';
import { I18nManager }         from './I18nManager.js';
import { APP_VERSION }         from './AppConfig.js';
import { CombatTrackerCore }   from './CombatTrackerCore.js';
import { ExportImportManager } from './ExportImportManager.js';
import { UIManager }           from './UIManager.js';

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
(async function init() {
  // 1. Instantiate modules
  const storage    = StorageManager;          // static class
  const adapters   = {
    dnd5eapi: new SystemAdapter5e(),
    open5e: new SystemAdapterOpen5e(),
  };
  const core       = new CombatTrackerCore();
  const i18n       = new I18nManager(storage);
  const exportMgr  = new ExportImportManager(i18n);
  const resolveAdapter = (source) => adapters[source] || adapters.dnd5eapi;
  const ui = new UIManager(
    core,
    resolveAdapter(core.settings.monsterApi),
    exportMgr,
    {
      resolveAdapter,
      onSettingsSaved: (settings) => {
        ui.adapter = resolveAdapter(settings.monsterApi);
        ui.adapter.fetchMonsterList().catch(() => {
          console.warn('[main] Monster list could not be pre-fetched after API switch.');
        });
      },
      i18n,
    },
  );

  // 2. Connect core → UI: re-render on every state change
  core.onChange = (state) => ui.render(state);

  // 3. Restore persisted state (or start fresh)
  core.loadFromStorage();
  ui.adapter = resolveAdapter(core.settings.monsterApi);

  // 3b. Resolve language (saved setting -> browser language fallback)
  const resolvedLang = await i18n.init(core.settings.language);
  if (core.settings.language !== resolvedLang) {
    core.updateSettings({ language: resolvedLang });
  }
  i18n.applyToDocument();

  const versionEl = document.getElementById('app-version');
  if (versionEl) versionEl.textContent = i18n.t('version.badge', { version: APP_VERSION });

  // 4. Bind all event listeners
  ui.bindEvents();

  // 5. Initial render with the (possibly restored) state
  ui.render(core.getState());

  // 6. Pre-fetch monster list in the background (non-blocking)
  ui.adapter.fetchMonsterList().catch(() => {
    console.warn('[main] Monster list could not be pre-fetched. Search will still work on demand.');
  });

  // 7. Privacy banner
  ui.showPrivacyBanner(storage);
})().catch((err) => {
  console.error('[main] Bootstrap failed:', err);
});
