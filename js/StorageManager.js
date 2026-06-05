/**
 * StorageManager
 * Handles all LocalStorage persistence for the Initiative Tracker.
 * Stateless static class — can be replaced with IndexedDB or server-side later.
 */
export class StorageManager {
  static KEY = 'ini_tracker_state';
  static PRIVACY_KEY = 'ini_tracker_privacy_dismissed';
  static LANGUAGE_KEY = 'ini_tracker_language';

  /**
   * Persists the full application state.
   * @param {object} state - AppState object from CombatTrackerCore
   */
  static save(state) {
    try {
      localStorage.setItem(StorageManager.KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('[StorageManager] save failed:', e);
    }
  }

  /**
   * Loads the persisted application state.
   * @returns {object|null} Parsed state or null if nothing stored / parse error.
   */
  static load() {
    try {
      const raw = localStorage.getItem(StorageManager.KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.warn('[StorageManager] load failed:', e);
      return null;
    }
  }

  /** Removes the persisted state entirely. */
  static clear() {
    localStorage.removeItem(StorageManager.KEY);
  }

  /** Returns true if the privacy banner has been dismissed by the user. */
  static isPrivacyDismissed() {
    return localStorage.getItem(StorageManager.PRIVACY_KEY) === '1';
  }

  /** Marks the privacy banner as dismissed. */
  static dismissPrivacy() {
    localStorage.setItem(StorageManager.PRIVACY_KEY, '1');
  }

  /** Returns the persisted UI language code, e.g. "de" or "en". */
  static getLanguage() {
    return localStorage.getItem(StorageManager.LANGUAGE_KEY);
  }

  /** Persists the selected UI language code. */
  static setLanguage(lang) {
    localStorage.setItem(StorageManager.LANGUAGE_KEY, String(lang || ''));
  }
}
