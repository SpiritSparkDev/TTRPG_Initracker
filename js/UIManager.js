/**
 * UIManager
 * Handles all DOM rendering and event binding for the Initiative Tracker.
 *
 * Foundry VTT compatibility note:
 * All DOM writes are isolated to this class (render + _build* helpers).
 * Event handling uses data-attribute delegation — no inline onclick.
 * To port to Foundry: replace render() body with Handlebars template rendering
 * and rebind events in activateListeners().
 */
export class UIManager {
  /**
   * @param {import('./CombatTrackerCore.js').CombatTrackerCore} core
   * @param {import('./SystemAdapter5e.js').SystemAdapter5e} adapter
   * @param {import('./ExportImportManager.js').ExportImportManager} exportMgr
   */
  constructor(core, adapter, exportMgr) {
    this.core = core;
    this.adapter = adapter;
    this.exportMgr = exportMgr;

    this._searchDebounceTimer = null;
  }

  // ---------------------------------------------------------------------------
  // Initialisation
  // ---------------------------------------------------------------------------

  /** Wire up all event listeners and perform the first render. */
  bindEvents() {
    // -- Combat controls --
    this._on('start-combat-btn', 'click', () => {
      if (this.core.combatants.length > 0) this.core.startCombat();
    });
    this._on('next-turn-btn', 'click', () => {
      if (this.core.isCombatActive) this.core.nextTurn();
    });
    this._on('reset-btn', 'click', () => {
      if (confirm('Alle Kombattanten entfernen und den Kampf zurücksetzen?')) {
        this.core.reset();
      }
    });

    // -- Add player / custom entry --
    this._on('add-player-btn', 'click', () => this._openModal(true));
    this._on('manual-entry-btn', 'click', () => this._openModal(false));

    // -- Manual entry modal --
    this._on('modal-cancel', 'click', () => this._closeModal());
    this._on('modal-overlay', 'click', (e) => {
      if (e.target.id === 'modal-overlay') this._closeModal();
    });
    this._on('manual-form', 'submit', (e) => {
      e.preventDefault();
      this._handleManualSubmit();
    });

    // -- Settings modal --
    ['settings-btn-sidebar', 'settings-btn-mobile', 'settings-btn-footer'].forEach(id => {
      this._on(id, 'click', () => this._openSettings());
    });
    this._on('settings-close', 'click', () => this._closeSettings());
    this._on('settings-modal', 'click', (e) => {
      if (e.target.id === 'settings-modal') this._closeSettings();
    });
    this._on('settings-save', 'click', () => this._saveSettings());

    // -- Monster search --
    this._on('monster-search', 'input', (e) => this._handleSearchInput(e.target.value));
    this._on('monster-search', 'keydown', (e) => {
      if (e.key === 'Escape') {
        this._hideSearchResults();
        e.target.value = '';
      }
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#monster-search') && !e.target.closest('#search-results')) {
        this._hideSearchResults();
      }
    });

    // -- Detail drawer --
    this._on('close-drawer', 'click', () => this._closeDrawer());

    // -- Initiative list: event delegation --
    this._onDelegate('initiative-list', 'click', '[data-action]', (e, el) => {
      this._handleTableAction(el.dataset.action, el.dataset.id, el.dataset);
    });
    this._onDelegate('initiative-list', 'change', '[data-action="hp-input"]', (e, el) => {
      const val = Math.max(0, Math.min(Number(el.value), Number(el.dataset.max)));
      this.core.updateCombatant(el.dataset.id, { hp: val });
    });
    this._onDelegate('initiative-list', 'change', '[data-action="initiative-input"]', (e, el) => {
      const val = parseInt(el.value);
      if (!isNaN(val)) this.core.updateCombatant(el.dataset.id, { initiative: val });
    });

    // -- Export / Import (mobile bottom nav) --
    this._on('export-pcs-btn', 'click', () => this.exportMgr.exportPCs(this.core.getFullState()));
    this._on('export-all-btn', 'click', () => this.exportMgr.exportAll(this.core.getFullState()));
    this._on('import-file-input', 'change', (e) => this._handleImport(e.target.files[0]));

    // -- Export / Import (desktop footer) --
    this._on('export-pcs-btn-desktop', 'click', () => this.exportMgr.exportPCs(this.core.getFullState()));
    this._on('export-all-btn-desktop', 'click', () => this.exportMgr.exportAll(this.core.getFullState()));
    this._on('import-file-input-desktop', 'change', (e) => this._handleImport(e.target.files[0]));

    // -- Privacy banner --
    this._on('privacy-dismiss-btn', 'click', () => {
      const { StorageManager } = window.__initiativeApp || {};
      if (StorageManager) StorageManager.dismissPrivacy();
      document.getElementById('privacy-banner')?.classList.add('hidden');
    });

    // -- beforeunload warning --
    window.addEventListener('beforeunload', (e) => {
      if (this.core.isCombatActive) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    // -- Keyboard shortcut: Space = next turn --
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(document.activeElement.tagName)) {
        e.preventDefault();
        if (this.core.isCombatActive) this.core.nextTurn();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  /**
   * Full re-render of the UI based on the current state.
   * Called via core.onChange after every state mutation.
   * @param {object} state - AppState from CombatTrackerCore
   */
  render(state) {
    this._renderStats(state);
    this._renderList(state);
    this._renderStartButton(state);
  }

  _renderStats(state) {
    const roundText = state.isCombatActive ? String(state.round) : '–';
    this._setText('round-display', roundText);
    this._setText('stat-round', roundText);
    this._setText('stat-total', String(state.combatants.length));

    let activeName = 'Warte…';
    if (state.isCombatActive && state.activeIndex >= 0 && state.combatants[state.activeIndex]) {
      activeName = state.combatants[state.activeIndex].name;
    } else if (state.combatants.length > 0 && !state.isCombatActive) {
      activeName = 'Bereit';
    }
    this._setText('stat-active', activeName);
  }

  _renderStartButton(state) {
    const btn = document.getElementById('start-combat-btn');
    if (!btn) return;
    if (state.isCombatActive) {
      btn.disabled = true;
      btn.classList.add('btn--disabled');
    } else {
      btn.disabled = false;
      btn.classList.remove('btn--disabled');
    }
  }

  _renderList(state) {
    const tbody = document.getElementById('initiative-list');
    const empty = document.getElementById('empty-state');
    if (!tbody) return;

    if (state.combatants.length === 0) {
      tbody.innerHTML = '';
      empty?.classList.remove('hidden');
      return;
    }
    empty?.classList.add('hidden');

    tbody.innerHTML = state.combatants.map((c, idx) => this._buildRow(c, idx, state)).join('');
  }

  _buildRow(c, idx, state) {
    const isActive = state.isCombatActive && idx === state.activeIndex;
    const hpPct = c.maxHp > 0 ? Math.round((c.hp / c.maxHp) * 100) : 0;
    const hpBarClass = hpPct > 50
      ? 'hp-bar-fill--high'
      : hpPct > 25
        ? 'hp-bar-fill--mid'
        : 'hp-bar-fill--low';
    const rowNameClass = c.isPC ? 'row-name--pc' : 'row-name--monster';
    const rowClass = isActive ? 'initiative-row initiative-row--active' : 'initiative-row';
    const typeLabel = c.isPC ? 'SC' : (c.monsterIndex ? 'Monster' : 'NSC');

    const hasRealMonsterData = c.monsterData && !c.monsterData._cached;
    const expandedRow = (c.isExpanded && hasRealMonsterData)
      ? this._buildExpandedRow(c)
      : '';

    return `
      <tr class="${rowClass}">
        <td class="td-indicator">
          ${isActive ? '<span class="material-symbols-outlined row-turn-icon">chevron_right</span>' : ''}
        </td>
        <td class="row-name ${rowNameClass}">
          <div class="name-wrap">
            <span class="name-text">${this._esc(c.name)}</span>
            <span class="type-badge">${typeLabel}</span>
          </div>
        </td>
        <td class="td-initiative">
          <input type="number" data-action="initiative-input" data-id="${c.id}"
            value="${c.initiative}"
            class="initiative-input" />
        </td>
        <td class="td-hp">
          <div class="hp-controls">
            <div class="hp-row">
              <button data-action="hp-minus" data-id="${c.id}" data-delta="1"
                class="hp-btn hp-btn--minus">−</button>
              <input
                type="number"
                data-action="hp-input"
                data-id="${c.id}"
                data-max="${c.maxHp}"
                value="${c.hp}"
                min="0"
                max="${c.maxHp}"
                class="hp-input"
              />
              <span class="hp-max">/ ${c.maxHp}</span>
              <button data-action="hp-plus" data-id="${c.id}" data-delta="1"
                class="hp-btn hp-btn--plus">+</button>
            </div>
            <div class="hp-bar-track">
              <div class="hp-bar-fill ${hpBarClass}" style="width:${hpPct}%"></div>
            </div>
          </div>
        </td>
        <td class="td-stat">${c.ac}</td>
        <td class="td-stat">${c.passivePerception}</td>
        <td class="td-actions">
          <div class="action-btns">
            ${c.monsterIndex ? `
            <button data-action="show-details" data-id="${c.id}"
              class="action-btn" title="Details">
              <span class="material-symbols-outlined">info</span>
            </button>
            <button data-action="expand" data-id="${c.id}"
              class="action-btn" title="${c.isExpanded ? 'Einklappen' : 'Aufklappen'}">
              <span class="material-symbols-outlined">${c.isExpanded ? 'expand_less' : 'expand_more'}</span>
            </button>
            ` : ''}
            <button data-action="remove" data-id="${c.id}"
              class="action-btn action-btn--danger" title="Entfernen">
              <span class="material-symbols-outlined">delete</span>
            </button>
          </div>
        </td>
      </tr>
      ${expandedRow}
    `;
  }

  _buildExpandedRow(c) {
    const m = c.monsterData;
    const abilities = [
      ['STR', m.strength], ['DEX', m.dexterity], ['CON', m.constitution],
      ['INT', m.intelligence], ['WIS', m.wisdom], ['CHA', m.charisma],
    ];
    const abilityGrid = abilities.map(([label, val]) =>
      `<div class="ability-card">
        <div class="ability-card__label">${label}</div>
        <div class="ability-card__score">${val}</div>
      </div>`
    ).join('');

    const specialAbilities = (m.special_abilities || []).map(a =>
      `<p><span class="stat-name">${this._esc(a.name)}.</span> <span class="stat-desc">${this._esc(a.desc)}</span></p>`
    ).join('') || '<p class="stat-desc">—</p>';

    const actions = (m.actions || []).map(a =>
      `<p><span class="stat-name">${this._esc(a.name)}.</span> <span class="stat-desc">${this._esc(a.desc)}</span></p>`
    ).join('') || '<p class="stat-desc">—</p>';

    return `
      <tr class="expanded-row">
        <td colspan="7">
          <div class="ability-grid">${abilityGrid}</div>
          <div class="expanded-sections">
            <div>
              <p class="expanded-section__title">Besondere Fähigkeiten</p>
              <div class="expanded-section__body">${specialAbilities}</div>
            </div>
            <div>
              <p class="expanded-section__title">Aktionen</p>
              <div class="expanded-section__body">${actions}</div>
            </div>
          </div>
        </td>
      </tr>
    `;
  }

  // ---------------------------------------------------------------------------
  // Drawer
  // ---------------------------------------------------------------------------

  _openDrawer(id) {
    const c = this.core.combatants.find(x => x.id === id);
    if (!c) return;
    const m = c.monsterData;

    document.getElementById('drawer-title').textContent = c.name;
    const content = document.getElementById('drawer-content');

    if (m) {
      const abilities = [
        ['STR', m.strength], ['DEX', m.dexterity], ['CON', m.constitution],
        ['INT', m.intelligence], ['WIS', m.wisdom], ['CHA', m.charisma],
      ];
      content.innerHTML = `
        <div class="drawer-abilities">
          ${abilities.map(([l, v]) => `
            <div class="drawer-ability-card">
              <p class="drawer-ability-card__label">${l}</p>
              <p class="drawer-ability-card__score">${v}</p>
              <p class="drawer-ability-card__mod">${v >= 10 ? '+' : ''}${Math.floor((v - 10) / 2)}</p>
            </div>`).join('')}
        </div>
        <div class="drawer-sections">
          <div>
            <p class="drawer-section__title">Besondere Fähigkeiten</p>
            <div class="drawer-section__body">
              ${(m.special_abilities || []).map(a => `<p><strong>${this._esc(a.name)}.</strong> ${this._esc(a.desc)}</p>`).join('') || '<p class="stat-desc">—</p>'}
            </div>
          </div>
          <div>
            <p class="drawer-section__title">Aktionen</p>
            <div class="drawer-section__body">
              ${(m.actions || []).map(a => `<p><strong>${this._esc(a.name)}.</strong> ${this._esc(a.desc)}</p>`).join('') || '<p class="stat-desc">—</p>'}
            </div>
          </div>
          ${m.legendary_actions?.length ? `
          <div>
            <p class="drawer-section__title">Legendäre Aktionen</p>
            <div class="drawer-section__body">
              ${m.legendary_actions.map(a => `<p><strong>${this._esc(a.name)}.</strong> ${this._esc(a.desc)}</p>`).join('')}
            </div>
          </div>` : ''}
        </div>
      `;
    } else {
      content.innerHTML = `
        <div class="drawer-fallback">
          <p><strong>Initiative:</strong> ${c.initiative}</p>
          <p><strong>Max. TP:</strong> ${c.maxHp}</p>
          <p><strong>Rüstungsklasse:</strong> ${c.ac}</p>
          <p><strong>Passive Wahrnehmung:</strong> ${c.passivePerception}</p>
        </div>`;
    }

    document.getElementById('detail-drawer')?.classList.remove('drawer--closed');
  }

  _closeDrawer() {
    document.getElementById('detail-drawer')?.classList.add('drawer--closed');
  }

  // ---------------------------------------------------------------------------
  // Modal helpers
  // ---------------------------------------------------------------------------

  _openModal(isPC = false) {
    const overlay = document.getElementById('modal-overlay');
    const title = document.getElementById('modal-title');
    const pcCheckbox = document.getElementById('m-is-pc');
    document.getElementById('manual-form')?.reset();
    document.getElementById('modal-error')?.classList.add('hidden');
    title.textContent = isPC ? 'Spielercharakter hinzufügen' : 'Kombattant hinzufügen';
    pcCheckbox.checked = isPC;
    pcCheckbox.disabled = isPC; // lock it for the player flow
    overlay.classList.add('is-open');
    document.getElementById('m-name')?.focus();
  }

  _closeModal() {
    const overlay = document.getElementById('modal-overlay');
    overlay.classList.remove('is-open');
    const pcCheckbox = document.getElementById('m-is-pc');
    if (pcCheckbox) pcCheckbox.disabled = false;
  }

  _handleManualSubmit() {
    const name = document.getElementById('m-name')?.value.trim();
    const errorEl = document.getElementById('modal-error');
    if (!name) {
      if (errorEl) {
        errorEl.textContent = 'Bitte einen Namen eingeben.';
        errorEl.classList.remove('hidden');
      }
      return;
    }
    const hp = parseInt(document.getElementById('m-hp')?.value) || 0;
    this.core.addCombatant({
      nameBase: name,
      initiative: parseInt(document.getElementById('m-init')?.value) || 0,
      hp,
      maxHp: hp,
      ac: parseInt(document.getElementById('m-ac')?.value) || 10,
      passivePerception: parseInt(document.getElementById('m-pp')?.value) || 10,
      isPC: document.getElementById('m-is-pc')?.checked ?? false,
    });
    this._closeModal();
  }

  // ---------------------------------------------------------------------------
  // Settings modal
  // ---------------------------------------------------------------------------

  _openSettings() {
    const s = this.core.settings;
    document.getElementById('setting-auto-hp').checked = s.autoHp;
    document.getElementById('setting-auto-init').checked = s.autoInitiative;
    const radio = document.querySelector(`input[name="naming"][value="${s.namingConvention}"]`);
    if (radio) radio.checked = true;
    const modal = document.getElementById('settings-modal');
    modal.classList.add('is-open');
  }

  _closeSettings() {
    const modal = document.getElementById('settings-modal');
    modal.classList.remove('is-open');
  }

  _saveSettings() {
    const naming = document.querySelector('input[name="naming"]:checked')?.value || 'numeric';
    this.core.updateSettings({
      autoHp: document.getElementById('setting-auto-hp')?.checked ?? true,
      autoInitiative: document.getElementById('setting-auto-init')?.checked ?? true,
      namingConvention: naming,
    });
    this._closeSettings();
  }

  // ---------------------------------------------------------------------------
  // Monster search
  // ---------------------------------------------------------------------------

  _handleSearchInput(value) {
    clearTimeout(this._searchDebounceTimer);
    if (value.length < 2) {
      this._hideSearchResults();
      return;
    }
    const loadingIcon = document.getElementById('search-loading');
    loadingIcon?.classList.remove('hidden');
    this._searchDebounceTimer = setTimeout(async () => {
      try {
        const results = await this.adapter.searchMonsters(value, 10);
        loadingIcon?.classList.add('hidden');
        this._renderSearchResults(results, value);
      } catch (err) {
        loadingIcon?.classList.add('hidden');
        this._renderSearchError(err.message);
      }
    }, 250);
  }

  _renderSearchResults(results, query = '') {
    const box = document.getElementById('search-results');
    if (!box) return;
    if (results.length === 0) {
      if (query.length >= 3) {
        box.innerHTML = `<div class="search-no-results">Keine Monster gefunden für „${this._esc(query)}".</div>`;
        box.classList.remove('hidden');
      } else {
        box.classList.add('hidden');
      }
      return;
    }
    box.innerHTML = results.map(m => `
      <div
        data-action="add-monster"
        data-index="${this._esc(m.index)}"
        class="search-result-item"
      >${this._esc(m.name)}</div>
    `).join('');
    box.classList.remove('hidden');

    // Replace click handler each time results are rendered
    box.onclick = (e) => {
      const item = e.target.closest('[data-action="add-monster"]');
      if (item) this._addMonsterByIndex(item.dataset.index);
    };
  }

  _renderSearchError(message) {
    const box = document.getElementById('search-results');
    if (!box) return;
    box.innerHTML = `
      <div class="search-error">
        <p class="search-error__title">API nicht erreichbar</p>
        <p class="search-error__msg">${this._esc(message)}</p>
        <button id="search-retry-btn" class="search-retry-btn">Erneut versuchen</button>
      </div>
    `;
    box.classList.remove('hidden');
    document.getElementById('search-retry-btn')?.addEventListener('click', () => {
      this.adapter._monsterList = null;
      const currentQuery = document.getElementById('monster-search')?.value || '';
      if (currentQuery.length >= 2) this._handleSearchInput(currentQuery);
    });
  }

  _hideSearchResults() {
    const box = document.getElementById('search-results');
    box?.classList.add('hidden');
    const loadingIcon = document.getElementById('search-loading');
    loadingIcon?.classList.add('hidden');
  }

  async _addMonsterByIndex(index) {
    this._hideSearchResults();
    const searchInput = document.getElementById('monster-search');
    if (searchInput) searchInput.value = '';
    const loadingIcon = document.getElementById('search-loading');
    loadingIcon?.classList.remove('hidden');
    try {
      const data = await this.adapter.fetchMonsterDetails(index);
      if (!data) return;
      const partial = this.adapter.buildCombatantFromMonster(data, this.core.settings);
      this.core.addCombatant(partial);
    } finally {
      loadingIcon?.classList.add('hidden');
    }
  }

  // ---------------------------------------------------------------------------
  // Table action dispatcher
  // ---------------------------------------------------------------------------

  _handleTableAction(action, id, dataset) {
    switch (action) {
      case 'remove':
        this.core.removeCombatant(id);
        break;
      case 'expand':
        this._handleExpand(id);
        break;
      case 'show-details':
        this._handleShowDetails(id);
        break;
      case 'hp-minus': {
        const c = this.core.combatants.find(x => x.id === id);
        if (c) this.core.updateCombatant(id, { hp: Math.max(0, c.hp - Number(dataset.delta || 1)) });
        break;
      }
      case 'hp-plus': {
        const c = this.core.combatants.find(x => x.id === id);
        if (c) this.core.updateCombatant(id, { hp: Math.min(c.maxHp, c.hp + Number(dataset.delta || 1)) });
        break;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Async monster-data helpers
  // ---------------------------------------------------------------------------

  /**
   * Ensures a monster combatant has real (non-cached) monsterData.
   * Re-fetches from the API if the data was stripped during LocalStorage persistence.
   * @param {string} id - Combatant id
   */
  async _ensureMonsterData(id) {
    const c = this.core.combatants.find(x => x.id === id);
    if (!c || !c.monsterIndex) return;
    if (c.monsterData && !c.monsterData._cached) return; // already have real data
    const data = await this.adapter.fetchMonsterDetails(c.monsterIndex);
    if (data) this.core.updateCombatant(id, { monsterData: data });
  }

  async _handleExpand(id) {
    await this._ensureMonsterData(id);
    const c = this.core.combatants.find(x => x.id === id);
    if (c) this.core.updateCombatant(id, { isExpanded: !c.isExpanded });
  }

  async _handleShowDetails(id) {
    await this._ensureMonsterData(id);
    this._openDrawer(id);
  }

  // ---------------------------------------------------------------------------
  // Import handler
  // ---------------------------------------------------------------------------

  async _handleImport(file) {
    if (!file) return;
    try {
      await this.exportMgr.importFile(file, this.core);
    } catch (err) {
      alert(`Import fehlgeschlagen: ${err.message}`);
    }
    // Reset file input so the same file can be re-imported
    document.getElementById('import-file-input').value = '';
    document.getElementById('import-file-input-desktop').value = '';
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  /** Helper: attach an event listener to an element by id (null-safe). */
  _on(id, event, handler) {
    document.getElementById(id)?.addEventListener(event, handler);
  }

  /**
   * Event delegation helper.
   * Attaches a single listener on `parentId`, fires `handler(event, matchedEl)`
   * for any click that matches `selector` within the delegated subtree.
   */
  _onDelegate(parentId, event, selector, handler) {
    document.getElementById(parentId)?.addEventListener(event, (e) => {
      const matched = e.target.closest(selector);
      if (matched) handler(e, matched);
    });
  }

  /** Sets textContent on an element by id (null-safe). */
  _setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  /**
   * HTML-escapes a string to prevent XSS from API data or user input.
   * @param {string} str
   * @returns {string}
   */
  _esc(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** Shows the privacy banner if it hasn't been dismissed yet. */
  showPrivacyBanner(StorageManager) {
    if (!StorageManager.isPrivacyDismissed()) {
      document.getElementById('privacy-banner')?.classList.remove('hidden');
      // Store reference so the dismiss handler can call StorageManager.dismissPrivacy()
      window.__initiativeApp = { StorageManager };
    }
  }
}
