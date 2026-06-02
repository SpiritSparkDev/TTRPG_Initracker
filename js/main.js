/**
 * main.js — Application entry point
 *
 * Instantiates all modules, wires them together, restores persisted state,
 * pre-fetches the monster list in the background, and renders the initial UI.
 */

import { StorageManager }      from './StorageManager.js';
import { SystemAdapter5e }     from './SystemAdapter5e.js';
import { CombatTrackerCore }   from './CombatTrackerCore.js';
import { ExportImportManager } from './ExportImportManager.js';
import { UIManager }           from './UIManager.js';

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
(function init() {
  // 1. Instantiate modules
  const storage    = StorageManager;          // static class
  const adapter    = new SystemAdapter5e();
  const core       = new CombatTrackerCore();
  const exportMgr  = new ExportImportManager();
  const ui         = new UIManager(core, adapter, exportMgr);

  // 2. Connect core → UI: re-render on every state change
  core.onChange = (state) => ui.render(state);

  // 3. Restore persisted state (or start fresh)
  core.loadFromStorage();

  // 4. Bind all event listeners
  ui.bindEvents();

  // 5. Initial render with the (possibly restored) state
  ui.render(core.getState());

  // 6. Pre-fetch monster list in the background (non-blocking)
  adapter.fetchMonsterList().catch(() => {
    console.warn('[main] Monster list could not be pre-fetched. Search will still work on demand.');
  });

  // 7. Privacy banner
  ui.showPrivacyBanner(storage);
})();
