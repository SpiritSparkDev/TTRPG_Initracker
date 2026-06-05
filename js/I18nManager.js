import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES } from './AppConfig.js';

export class I18nManager {
  /**
   * @param {{ getLanguage?: () => (string|null), setLanguage?: (lang:string) => void }} storage
   */
  constructor(storage = {}) {
    this.storage = storage;
    this.lang = DEFAULT_LANGUAGE;
    this.messages = {};
  }

  async init(preferredLanguage = null) {
    const stored = this.storage.getLanguage?.();
    const detected = this._detectBrowserLanguage();
    const preferred = this._normalizeLanguage(preferredLanguage || stored || detected || DEFAULT_LANGUAGE);
    await this.setLanguage(preferred, { persist: false });
    return this.lang;
  }

  async setLanguage(lang, { persist = true } = {}) {
    const normalized = this._normalizeLanguage(lang);
    this.messages = await this._loadMessages(normalized);
    this.lang = normalized;
    if (persist) this.storage.setLanguage?.(normalized);
    this.applyToDocument();
    return this.lang;
  }

  t(key, vars = {}) {
    const raw = this._get(this.messages, key) ?? key;
    return this._interpolate(String(raw), vars);
  }

  applyToDocument(root = document, vars = {}) {
    if (!root) return;

    root.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (!key) return;
      el.textContent = this.t(key, vars);
    });

    root.querySelectorAll('[data-i18n-html]').forEach((el) => {
      const key = el.getAttribute('data-i18n-html');
      if (!key) return;
      el.innerHTML = this.t(key, vars);
    });

    root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (!key) return;
      el.setAttribute('placeholder', this.t(key, vars));
    });

    root.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const key = el.getAttribute('data-i18n-title');
      if (!key) return;
      el.setAttribute('title', this.t(key, vars));
    });

    root.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
      const key = el.getAttribute('data-i18n-aria-label');
      if (!key) return;
      el.setAttribute('aria-label', this.t(key, vars));
    });

    if (document?.documentElement) {
      document.documentElement.setAttribute('lang', this.lang);
    }
  }

  _normalizeLanguage(lang) {
    const short = String(lang || '').toLowerCase().slice(0, 2);
    return SUPPORTED_LANGUAGES.includes(short) ? short : DEFAULT_LANGUAGE;
  }

  _detectBrowserLanguage() {
    if (typeof navigator === 'undefined') return DEFAULT_LANGUAGE;
    return navigator.language || navigator.userLanguage || DEFAULT_LANGUAGE;
  }

  async _loadMessages(lang) {
    const response = await fetch(`lang/${lang}.json`);
    if (!response.ok) throw new Error(`Failed to load language file: ${lang}`);
    return response.json();
  }

  _get(obj, path) {
    return String(path).split('.').reduce((acc, p) => (acc && p in acc ? acc[p] : undefined), obj);
  }

  _interpolate(template, vars) {
    return template.replace(/\{(\w+)\}/g, (_, key) => {
      if (key in vars) return String(vars[key]);
      return `{${key}}`;
    });
  }
}
