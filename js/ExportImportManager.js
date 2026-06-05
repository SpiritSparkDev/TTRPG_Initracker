/**
 * ExportImportManager
 * Handles JSON export and import of the combat state.
 *
 * Export modes:
 *   - exportPCs(state)  → only PC combatants + settings
 *   - exportAll(state)  → full state including monsters, HP, order
 *
 * Import:
 *   - import(file, core) → parses JSON file and calls core.loadFromExport()
 */
import { APP_VERSION } from './AppConfig.js';

export class ExportImportManager {
  constructor(i18n = null) {
    this.i18n = i18n;
  }

  /**
   * Exports only PC combatants and the current settings.
   * Useful for saving a character party between sessions.
   * @param {object} state - Full AppState (from CombatTrackerCore.getFullState())
   */
  exportPCs(state) {
    const payload = {
      exportType: 'pcs_only',
      appVersion: APP_VERSION,
      exportedAt: new Date().toISOString(),
      settings: state.settings,
      combatants: state.combatants
        .filter(c => c.isPC)
        .map(c => ({
          id: c.id,
          nameBase: c.nameBase,
          name: c.name,
          initiative: c.initiative,
          hp: c.hp,
          maxHp: c.maxHp,
          ac: c.ac,
          passivePerception: c.passivePerception,
          isPC: true,
          monsterIndex: null,
          monsterData: null,
          isExpanded: false,
        })),
    };
    this._download(payload, 'initiative_pcs.json');
  }

  /**
   * Exports the entire combat state including monsters and current HP.
   * @param {object} state - Full AppState (from CombatTrackerCore.getFullState())
   */
  exportAll(state) {
    const payload = {
      exportType: 'full_combat',
      appVersion: APP_VERSION,
      exportedAt: new Date().toISOString(),
      round: state.round,
      activeIndex: state.activeIndex,
      isCombatActive: state.isCombatActive,
      settings: state.settings,
      combatants: state.combatants,
    };
    this._download(payload, 'initiative_combat.json');
  }

  /**
   * Reads a JSON file selected by the user and loads it into the core.
   * @param {File} file - File object from an <input type="file"> element
   * @param {import('./CombatTrackerCore.js').CombatTrackerCore} core
   * @returns {Promise<void>}
   */
  importFile(file, core) {
    return new Promise((resolve, reject) => {
      if (!file) {
        reject(new Error(this._t('import_export.no_file')));
        return;
      }

      const fileName = String(file.name || '').toLowerCase();
      const mimeType = String(file.type || '').toLowerCase();
      const looksLikeJson = fileName.endsWith('.json') || mimeType.includes('json') || mimeType === '';

      if (!looksLikeJson) {
        reject(new Error(this._t('import_export.invalid_file')));
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const raw = String(e.target.result || '').replace(/^\uFEFF/, '');
          const data = JSON.parse(raw);
          this._validateImport(data);
          core.loadFromExport(data);
          resolve();
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error(this._t('import_export.read_failed')));
      reader.readAsText(file);
    });
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Validates that the import payload has the expected shape.
   * Throws if the data looks invalid.
   * @param {object} data
   */
  _validateImport(data) {
    if (!data || typeof data !== 'object') throw new Error(this._t('import_export.invalid_json'));
    if (!Array.isArray(data.combatants)) throw new Error(this._t('import_export.missing_combatants'));
  }

  _t(key, vars = {}) {
    return this.i18n?.t ? this.i18n.t(key, vars) : key;
  }

  /**
   * Creates and triggers a JSON file download.
   * @param {object} payload
   * @param {string} filename
   */
  _download(payload, filename) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoke after a short delay to allow the download to start
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
