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
      if (e.key === 'Escape') this._hideSearchResults();
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
      btn.classList.add('opacity-40', 'cursor-not-allowed');
    } else {
      btn.disabled = false;
      btn.classList.remove('opacity-40', 'cursor-not-allowed');
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
    const hpBarColor = hpPct > 50
      ? 'bg-primary'
      : hpPct > 25
        ? 'bg-secondary-container'
        : 'bg-error-container hp-low';
    const sideBorder = c.isPC
      ? 'border-l-4 border-tertiary-container'
      : 'border-l-4 border-error-container';
    const activeClass = isActive
      ? 'active-glow bg-surface-container-highest ring-1 ring-primary'
      : 'hover:bg-surface-container-highest/50';
    const typeLabel = c.isPC ? 'SC' : (c.monsterIndex ? 'Monster' : 'NSC');

    const hasRealMonsterData = c.monsterData && !c.monsterData._cached;
    const expandedRow = (c.isExpanded && hasRealMonsterData)
      ? this._buildExpandedRow(c)
      : '';

    return `
      <tr class="transition-all ${activeClass}">
        <td class="px-4 py-3 text-center w-10">
          ${isActive ? '<span class="material-symbols-outlined text-primary" style="font-variation-settings:\'FILL\' 1">chevron_right</span>' : ''}
        </td>
        <td class="px-4 py-3 ${sideBorder}">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-bold text-on-surface">${this._esc(c.name)}</span>
            <span class="text-[10px] px-2 py-0.5 rounded bg-surface-container-highest text-on-surface-variant font-mono uppercase">${typeLabel}</span>
          </div>
        </td>
        <td class="px-4 py-3 text-center">
          <input type="number" data-action="initiative-input" data-id="${c.id}"
            value="${c.initiative}"
            class="w-14 bg-transparent border-b border-outline-variant text-center font-mono text-xl font-bold text-primary focus:border-primary outline-none" />
        </td>
        <td class="px-4 py-3">
          <div class="flex flex-col gap-1">
            <div class="flex items-center gap-1">
              <button data-action="hp-minus" data-id="${c.id}" data-delta="1"
                class="w-6 h-6 flex items-center justify-center rounded bg-surface-container text-on-surface-variant hover:text-secondary hover:bg-surface-container-highest font-bold text-sm transition-colors">−</button>
              <input
                type="number"
                data-action="hp-input"
                data-id="${c.id}"
                data-max="${c.maxHp}"
                value="${c.hp}"
                min="0"
                max="${c.maxHp}"
                class="hp-input w-12 bg-surface-container-lowest border border-outline-variant rounded text-center font-mono text-sm text-on-surface focus:border-primary focus:ring-1 focus:ring-primary outline-none px-1 py-0.5"
              />
              <span class="text-on-surface-variant font-mono text-xs">/ ${c.maxHp}</span>
              <button data-action="hp-plus" data-id="${c.id}" data-delta="1"
                class="w-6 h-6 flex items-center justify-center rounded bg-surface-container text-on-surface-variant hover:text-primary hover:bg-surface-container-highest font-bold text-sm transition-colors">+</button>
            </div>
            <div class="w-full bg-surface-container-lowest h-1.5 rounded-full overflow-hidden">
              <div class="h-full ${hpBarColor} transition-all" style="width:${hpPct}%"></div>
            </div>
          </div>
        </td>
        <td class="px-4 py-3 text-center font-mono text-on-surface-variant">${c.ac}</td>
        <td class="px-4 py-3 text-center font-mono text-on-surface-variant">${c.passivePerception}</td>
        <td class="px-4 py-3 text-right">
          <div class="flex items-center justify-end gap-1">
            ${c.monsterIndex ? `
            <button data-action="show-details" data-id="${c.id}"
              class="p-1 rounded text-on-surface-variant hover:text-primary transition-colors" title="Details">
              <span class="material-symbols-outlined text-base">info</span>
            </button>
            <button data-action="expand" data-id="${c.id}"
              class="p-1 rounded text-on-surface-variant hover:text-primary transition-colors" title="${c.isExpanded ? 'Einklappen' : 'Aufklappen'}">
              <span class="material-symbols-outlined text-base">${c.isExpanded ? 'expand_less' : 'expand_more'}</span>
            </button>
            ` : ''}
            <button data-action="remove" data-id="${c.id}"
              class="p-1 rounded text-on-surface-variant hover:text-error transition-colors" title="Entfernen">
              <span class="material-symbols-outlined text-base">delete</span>
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
      `<div class="bg-surface-container rounded p-2 text-center">
        <div class="font-mono text-[10px] text-on-surface-variant uppercase">${label}</div>
        <div class="font-mono font-bold text-on-surface">${val}</div>
      </div>`
    ).join('');

    const specialAbilities = (m.special_abilities || []).map(a =>
      `<p><span class="font-bold text-on-surface">${this._esc(a.name)}.</span> <span class="text-on-surface-variant">${this._esc(a.desc)}</span></p>`
    ).join('') || '<p class="text-on-surface-variant">—</p>';

    const actions = (m.actions || []).map(a =>
      `<p><span class="font-bold text-on-surface">${this._esc(a.name)}.</span> <span class="text-on-surface-variant">${this._esc(a.desc)}</span></p>`
    ).join('') || '<p class="text-on-surface-variant">—</p>';

    return `
      <tr class="monster-detail-row bg-surface-container-lowest">
        <td colspan="7" class="px-6 py-4">
          <div class="grid grid-cols-6 gap-2 mb-4 font-body text-sm">${abilityGrid}</div>
          <div class="grid md:grid-cols-2 gap-4 font-body text-sm">
            <div>
              <p class="font-mono text-[10px] uppercase tracking-widest text-primary mb-2">Besondere Fähigkeiten</p>
              <div class="space-y-2">${specialAbilities}</div>
            </div>
            <div>
              <p class="font-mono text-[10px] uppercase tracking-widest text-primary mb-2">Aktionen</p>
              <div class="space-y-2">${actions}</div>
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
        <div class="grid grid-cols-3 gap-2 mb-4">
          ${abilities.map(([l, v]) => `
            <div class="bg-surface-container rounded p-2 text-center">
              <p class="font-mono text-[10px] text-on-surface-variant uppercase">${l}</p>
              <p class="font-mono font-bold">${v}</p>
              <p class="font-mono text-[10px] text-primary">${v >= 10 ? '+' : ''}${Math.floor((v - 10) / 2)}</p>
            </div>`).join('')}
        </div>
        <div class="space-y-4 text-sm">
          <div>
            <p class="font-mono text-[10px] uppercase tracking-widest text-primary mb-2">Besondere Fähigkeiten</p>
            ${(m.special_abilities || []).map(a => `<p class="mb-2"><strong>${this._esc(a.name)}.</strong> ${this._esc(a.desc)}</p>`).join('') || '<p class="text-on-surface-variant">—</p>'}
          </div>
          <div>
            <p class="font-mono text-[10px] uppercase tracking-widest text-primary mb-2">Aktionen</p>
            ${(m.actions || []).map(a => `<p class="mb-2"><strong>${this._esc(a.name)}.</strong> ${this._esc(a.desc)}</p>`).join('') || '<p class="text-on-surface-variant">—</p>'}
          </div>
          ${m.legendary_actions?.length ? `
          <div>
            <p class="font-mono text-[10px] uppercase tracking-widest text-primary mb-2">Legendäre Aktionen</p>
            ${m.legendary_actions.map(a => `<p class="mb-2"><strong>${this._esc(a.name)}.</strong> ${this._esc(a.desc)}</p>`).join('')}
          </div>` : ''}
        </div>
      `;
    } else {
      content.innerHTML = `
        <div class="space-y-2 text-sm">
          <p><strong>Initiative:</strong> ${c.initiative}</p>
          <p><strong>Max. TP:</strong> ${c.maxHp}</p>
          <p><strong>Rüstungsklasse:</strong> ${c.ac}</p>
          <p><strong>Passive Wahrnehmung:</strong> ${c.passivePerception}</p>
        </div>`;
    }

    document.getElementById('detail-drawer')?.classList.remove('translate-x-full');
  }

  _closeDrawer() {
    document.getElementById('detail-drawer')?.classList.add('translate-x-full');
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
    overlay.classList.remove('hidden');
    overlay.classList.add('flex');
    document.getElementById('m-name')?.focus();
  }

  _closeModal() {
    const overlay = document.getElementById('modal-overlay');
    overlay.classList.add('hidden');
    overlay.classList.remove('flex');
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
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }

  _closeSettings() {
    const modal = document.getElementById('settings-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
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
      const results = await this.adapter.searchMonsters(value, 10);
      loadingIcon?.classList.add('hidden');
      this._renderSearchResults(results);
    }, 250);
  }

  _renderSearchResults(results) {
    const box = document.getElementById('search-results');
    if (!box) return;
    if (results.length === 0) {
      box.classList.add('hidden');
      return;
    }
    box.innerHTML = results.map(m => `
      <div
        data-action="add-monster"
        data-index="${this._esc(m.index)}"
        class="px-4 py-3 hover:bg-primary-container hover:text-on-primary-container cursor-pointer transition-colors border-b border-outline-variant last:border-0 font-body text-sm"
      >${this._esc(m.name)}</div>
    `).join('');
    box.classList.remove('hidden');

    // One-time listener for search result clicks
    box.onclick = (e) => {
      const item = e.target.closest('[data-action="add-monster"]');
      if (item) this._addMonsterByIndex(item.dataset.index);
    };
  }

  _hideSearchResults() {
    const box = document.getElementById('search-results');
    box?.classList.add('hidden');
    const input = document.getElementById('monster-search');
    if (input) input.value = '';
    const loadingIcon = document.getElementById('search-loading');
    loadingIcon?.classList.add('hidden');
  }

  async _addMonsterByIndex(index) {
    this._hideSearchResults();
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
