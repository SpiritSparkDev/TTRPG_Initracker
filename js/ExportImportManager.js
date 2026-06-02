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
export class ExportImportManager {
  /**
   * Exports only PC combatants and the current settings.
   * Useful for saving a character party between sessions.
   * @param {object} state - Full AppState (from CombatTrackerCore.getFullState())
   */
  exportPCs(state) {
    const payload = {
      exportType: 'pcs_only',
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
      if (!file || file.type !== 'application/json') {
        reject(new Error('Ungültige Datei. Bitte eine .json-Datei hochladen.'));
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target.result);
          this._validateImport(data);
          core.loadFromExport(data);
          resolve();
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
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
    if (!data || typeof data !== 'object') throw new Error('Kein gültiges JSON-Objekt.');
    if (!Array.isArray(data.combatants)) throw new Error('Fehlende "combatants"-Liste im Import.');
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
    a.click();
    // Revoke after a short delay to allow the download to start
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
