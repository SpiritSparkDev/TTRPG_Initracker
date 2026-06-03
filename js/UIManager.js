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
   * @param {{ resolveAdapter?: (source: string) => any, onSettingsSaved?: (settings: object) => void }} [options]
   */
  constructor(core, adapter, exportMgr, options = {}) {
    this.core = core;
    this.adapter = adapter;
    this.exportMgr = exportMgr;
    this._resolveAdapter = typeof options.resolveAdapter === 'function'
      ? options.resolveAdapter
      : () => this.adapter;
    this._onSettingsSaved = typeof options.onSettingsSaved === 'function'
      ? options.onSettingsSaved
      : null;

    this._searchDebounceTimer = null;
    this._monsterPreviewData = null;
    this._groupPoolDamageContext = null;
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
    this._on('end-combat-btn', 'click', () => this._endCombatAndClearMonsters());

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

    // -- HP modal --
    this._on('hp-modal-close', 'click', () => this._closeHpModal());
    this._on('hp-modal-cancel', 'click', () => this._closeHpModal());
    this._on('hp-modal', 'click', (e) => {
      if (e.target.id === 'hp-modal') this._closeHpModal();
    });
    this._on('hp-modal-form', 'submit', (e) => {
      e.preventDefault();
      this._submitHpModal();
    });

    // -- Group pool damage modal --
    this._on('group-pool-damage-close', 'click', () => this._closeGroupPoolDamageModal());
    this._on('group-pool-damage-cancel', 'click', () => this._closeGroupPoolDamageModal());
    this._on('group-pool-damage-modal', 'click', (e) => {
      if (e.target.id === 'group-pool-damage-modal') this._closeGroupPoolDamageModal();
    });
    this._on('group-pool-damage-form', 'submit', (e) => {
      e.preventDefault();
      this._submitGroupPoolDamage();
    });

    // -- Monster add preview modal --
    this._on('monster-add-close', 'click', () => this._closeMonsterAddModal());
    this._on('monster-add-cancel', 'click', () => this._closeMonsterAddModal());
    this._on('monster-add-modal', 'click', (e) => {
      if (e.target.id === 'monster-add-modal') this._closeMonsterAddModal();
    });
    this._on('monster-add-form', 'submit', (e) => {
      e.preventDefault();
      this._submitMonsterAddModal();
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
    const endBtn = document.getElementById('end-combat-btn');
    if (!btn) return;
    if (state.isCombatActive) {
      btn.disabled = true;
      btn.classList.add('btn--disabled');
      if (endBtn) {
        endBtn.disabled = false;
        endBtn.classList.remove('btn--disabled');
      }
    } else {
      btn.disabled = false;
      btn.classList.remove('btn--disabled');
      if (endBtn) {
        endBtn.disabled = state.combatants.length === 0;
        endBtn.classList.toggle('btn--disabled', state.combatants.length === 0);
      }
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
    const isDead = c.hp <= 0;
    const hpPct = c.maxHp > 0 ? Math.round((c.hp / c.maxHp) * 100) : 0;
    const hpBarClass = hpPct > 50
      ? 'hp-bar-fill--high'
      : hpPct > 25
        ? 'hp-bar-fill--mid'
        : 'hp-bar-fill--low';
    const rowNameClass = c.isPC ? 'row-name--pc' : 'row-name--monster';
    const rowClass = [
      'initiative-row',
      isActive ? 'initiative-row--active' : '',
      isDead ? 'initiative-row--dead' : '',
      c.isGroup ? 'initiative-row--group' : '',
    ].filter(Boolean).join(' ');
    const typeLabel = c.isGroup
      ? `Gruppe x${c.groupCount}`
      : (c.isPC ? 'SC' : (c.monsterIndex ? 'Monster' : 'NSC'));

    const hpControlsClass = c.isGroup ? 'hp-controls hp-controls--group' : 'hp-controls';
    const groupPools = (c.isGroup && Array.isArray(c.hpPools))
      ? c.hpPools.map((pool, poolIdx) => {
          const poolName = `${c.nameBase || c.name} ${poolIdx + 1}`;
          return `
            <button
              type="button"
              data-action="group-pool-damage"
              data-id="${c.id}"
              data-pool-index="${poolIdx}"
              data-pool-name="${this._esc(poolName)}"
              class="group-pool ${pool <= 0 ? 'group-pool--dead' : ''}"
              title="Schaden auf ${this._esc(poolName)} anwenden"
            >
              <span class="group-pool__name">${this._esc(poolName)}</span>
              <span class="group-pool__hp">${pool} TP</span>
            </button>
          `;
        }).join('')
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
          <div class="${hpControlsClass}">
            <div class="hp-row">
              <button data-action="hp-minus" data-id="${c.id}" data-delta="1"
                class="hp-btn hp-btn--minus">−</button>
              <input
                type="number"
                data-action="open-hp-editor"
                data-id="${c.id}"
                data-max="${c.maxHp}"
                value="${c.hp}"
                min="0"
                max="${c.maxHp}"
                readonly
                class="hp-input"
              />
              <span class="hp-max">/ ${c.maxHp}${c.isGroup ? ` (Pools: ${c.groupCount})` : ''}</span>
              <button data-action="hp-plus" data-id="${c.id}" data-delta="1"
                class="hp-btn hp-btn--plus">+</button>
            </div>
            <div class="hp-bar-track">
              <div class="hp-bar-fill ${hpBarClass}" style="width:${hpPct}%"></div>
            </div>
            ${c.isGroup ? `<div class="group-pools">${groupPools}</div>` : ''}
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
            ` : ''}
            <button data-action="remove" data-id="${c.id}"
              class="action-btn action-btn--danger" title="Entfernen">
              <span class="material-symbols-outlined">delete</span>
            </button>
            ${isDead ? `
            <button data-action="revive" data-id="${c.id}"
              class="action-btn" title="Wiederbeleben">
              <span class="material-symbols-outlined">favorite</span>
            </button>
            <button data-action="remove-dead" data-id="${c.id}"
              class="action-btn action-btn--danger" title="Endgültig entfernen">
              <span class="material-symbols-outlined">delete_forever</span>
            </button>
            ` : ''}
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
      const savingThrows = this._buildSavingThrowsHtml(m);
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
            <p class="drawer-section__title">Rettungswürfe</p>
            <div class="drawer-section__body">${savingThrows}</div>
          </div>
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
    const monsterApiSelect = document.getElementById('setting-monster-api');
    if (monsterApiSelect) monsterApiSelect.value = s.monsterApi || 'dnd5eapi';
    const tieBreakerSelect = document.getElementById('setting-tie-breaker');
    if (tieBreakerSelect) tieBreakerSelect.value = s.tieBreaker || 'name';
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
    const settingsPatch = {
      autoHp: document.getElementById('setting-auto-hp')?.checked ?? true,
      autoInitiative: document.getElementById('setting-auto-init')?.checked ?? true,
      namingConvention: naming,
      tieBreaker: document.getElementById('setting-tie-breaker')?.value || 'name',
      monsterApi: document.getElementById('setting-monster-api')?.value || 'dnd5eapi',
    };
    this.core.updateSettings(settingsPatch);
    if (this._onSettingsSaved) this._onSettingsSaved(this.core.settings);
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
      this.adapter.clearCache?.();
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
    const loadingIcon = document.getElementById('search-loading');
    loadingIcon?.classList.remove('hidden');
    try {
      const data = await this.adapter.fetchMonsterDetails(index);
      if (!data) return;
      this._openMonsterAddModal(data);
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
      case 'remove-dead':
        this.core.removeCombatant(id);
        break;
      case 'revive': {
        const c = this.core.combatants.find(x => x.id === id);
        if (!c) break;
        const reviveTo = c.isGroup
          ? c.hpPools.reduce((sum, val) => sum + (val > 0 ? val : 1), 0)
          : Math.max(1, Math.min(c.maxHp || 1, Math.ceil((c.maxHp || 1) * 0.5)));
        this.core.updateCombatant(id, { hp: reviveTo });
        break;
      }
      case 'show-details':
        this._handleShowDetails(id);
        break;
      case 'open-hp-editor':
        this._openHpModal(id);
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
      case 'group-pool-damage': {
        this._openGroupPoolDamageModal(id, dataset.poolIndex, dataset.poolName);
        break;
      }
    }
  }

  _openGroupPoolDamageModal(id, poolIndexRaw, poolNameRaw) {
    const c = this.core.combatants.find(x => x.id === id);
    if (!c || !c.isGroup || !Array.isArray(c.hpPools)) return;

    const poolIndex = Number(poolIndexRaw);
    if (!Number.isInteger(poolIndex) || poolIndex < 0 || poolIndex >= c.hpPools.length) return;

    const poolName = poolNameRaw || `Pool ${poolIndex + 1}`;
    const currentHp = Math.max(0, Number(c.hpPools[poolIndex]) || 0);

    this._groupPoolDamageContext = { id, poolIndex };
    const title = document.getElementById('group-pool-damage-title');
    if (title) title.textContent = `Schaden auf ${poolName}`;

    const meta = document.getElementById('group-pool-damage-meta');
    if (meta) meta.textContent = `Aktuell: ${currentHp} TP`;

    const amount = document.getElementById('group-pool-damage-amount');
    if (amount) amount.value = '0';

    document.getElementById('group-pool-damage-error')?.classList.add('hidden');
    document.getElementById('group-pool-damage-modal')?.classList.add('is-open');
    amount?.focus();
  }

  _closeGroupPoolDamageModal() {
    document.getElementById('group-pool-damage-modal')?.classList.remove('is-open');
    this._groupPoolDamageContext = null;
  }

  _submitGroupPoolDamage() {
    const ctx = this._groupPoolDamageContext;
    if (!ctx) return;

    const c = this.core.combatants.find(x => x.id === ctx.id);
    if (!c || !c.isGroup || !Array.isArray(c.hpPools) || ctx.poolIndex >= c.hpPools.length) {
      this._closeGroupPoolDamageModal();
      return;
    }

    const amountEl = document.getElementById('group-pool-damage-amount');
    const errorEl = document.getElementById('group-pool-damage-error');
    const damage = Number(amountEl?.value);
    if (!Number.isFinite(damage) || damage < 0) {
      if (errorEl) {
        errorEl.textContent = 'Bitte eine gültige positive Zahl eingeben.';
        errorEl.classList.remove('hidden');
      }
      return;
    }

    const hpPools = [...c.hpPools];
    hpPools[ctx.poolIndex] = Math.max(0, hpPools[ctx.poolIndex] - Math.floor(damage));
    this.core.updateCombatant(c.id, { hpPools });
    this._closeGroupPoolDamageModal();
  }

  _openHpModal(id) {
    const c = this.core.combatants.find(x => x.id === id);
    if (!c) return;
    document.getElementById('hp-modal-id').value = c.id;
    document.getElementById('hp-damage').value = '0';
    document.getElementById('hp-heal').value = '0';
    document.getElementById('hp-current').value = String(c.hp);
    document.getElementById('hp-max').value = String(c.maxHp);
    document.getElementById('hp-modal-error')?.classList.add('hidden');
    const poolsWrap = document.getElementById('hp-pools-wrap');
    const poolsGrid = document.getElementById('hp-pools-grid');
    if (c.isGroup && Array.isArray(c.hpPools) && poolsWrap && poolsGrid) {
      poolsWrap.classList.remove('hidden');
      poolsGrid.innerHTML = c.hpPools.map((pool, idx) => `
        <div class="hp-pool-item">
          <label class="hp-pool-item__label" for="hp-pool-${idx}">Pool ${idx + 1}</label>
          <input id="hp-pool-${idx}" type="number" min="0" value="${pool}" class="form-input form-input--mono" data-pool-index="${idx}" />
        </div>
      `).join('');
    } else if (poolsWrap && poolsGrid) {
      poolsWrap.classList.add('hidden');
      poolsGrid.innerHTML = '';
    }
    document.getElementById('hp-modal')?.classList.add('is-open');
    document.getElementById('hp-damage')?.focus();
  }

  _closeHpModal() {
    document.getElementById('hp-modal')?.classList.remove('is-open');
  }

  _submitHpModal() {
    const id = document.getElementById('hp-modal-id')?.value;
    const c = this.core.combatants.find(x => x.id === id);
    if (!c) return;

    const damage = Math.max(0, Number(document.getElementById('hp-damage')?.value) || 0);
    const heal = Math.max(0, Number(document.getElementById('hp-heal')?.value) || 0);
    const current = Math.max(0, Number(document.getElementById('hp-current')?.value) || 0);
    const max = Math.max(0, Number(document.getElementById('hp-max')?.value) || 0);
    const errorEl = document.getElementById('hp-modal-error');
    const poolInputs = Array.from(document.querySelectorAll('#hp-pools-grid [data-pool-index]'));

    if (max <= 0) {
      if (errorEl) {
        errorEl.textContent = 'Maximale TP müssen größer als 0 sein.';
        errorEl.classList.remove('hidden');
      }
      return;
    }

    let newHp = Math.min(current, max);
    newHp = Math.max(0, newHp - damage + heal);
    newHp = Math.min(newHp, max);

    if (c.isGroup && poolInputs.length > 0) {
      const hpPools = poolInputs.map((input) => Math.max(0, Number(input.value) || 0));
      const totalFromPools = hpPools.reduce((sum, val) => sum + val, 0);
      let adjustedTotal = Math.max(0, totalFromPools - damage + heal);
      const perPoolCap = Math.max(1, Math.floor(max / Math.max(1, hpPools.length)));
      const redistributed = hpPools.map(() => {
        const val = Math.min(perPoolCap, adjustedTotal);
        adjustedTotal -= val;
        return val;
      });
      this.core.updateCombatant(c.id, {
        hpPools: redistributed,
        groupCount: redistributed.length,
        maxHp: Math.max(max, redistributed.reduce((sum, val) => sum + val, 0)),
      });
    } else {
      this.core.updateCombatant(c.id, { hp: newHp, maxHp: max });
    }
    this._closeHpModal();
  }

  _openMonsterAddModal(monsterData) {
    this._monsterPreviewData = monsterData;
    const partial = this.adapter.buildCombatantFromMonster(monsterData, this.core.settings);

    document.getElementById('monster-add-index').value = monsterData.index;
    document.getElementById('monster-add-title').textContent = `${monsterData.name} vorbereiten`;
    document.getElementById('monster-add-name').value = partial.nameBase;
    document.getElementById('monster-add-count').value = '1';
    document.getElementById('monster-add-init').value = String(partial.initiative);
    document.getElementById('monster-add-hp').value = String(partial.maxHp);
    document.getElementById('monster-add-ac').value = String(partial.ac);
    document.getElementById('monster-add-pp').value = String(partial.passivePerception);
    document.getElementById('monster-add-group').checked = false;
    document.getElementById('monster-add-error')?.classList.add('hidden');

    const abilities = [
      ['STR', monsterData.strength], ['DEX', monsterData.dexterity], ['CON', monsterData.constitution],
      ['INT', monsterData.intelligence], ['WIS', monsterData.wisdom], ['CHA', monsterData.charisma],
    ];
    document.getElementById('monster-add-abilities').innerHTML = abilities.map(([label, val]) => `
      <div class="ability-card">
        <div class="ability-card__label">${label}</div>
        <div class="ability-card__score">${val}</div>
      </div>
    `).join('');

    const special = (monsterData.special_abilities || []).map(a =>
      `<p><span class="stat-name">${this._esc(a.name)}.</span> <span class="stat-desc">${this._esc(a.desc)}</span></p>`
    ).join('') || '<p class="stat-desc">—</p>';
    const actions = (monsterData.actions || []).map(a =>
      `<p><span class="stat-name">${this._esc(a.name)}.</span> <span class="stat-desc">${this._esc(a.desc)}</span></p>`
    ).join('') || '<p class="stat-desc">—</p>';
    const saves = this._buildSavingThrowsHtml(monsterData);

    document.getElementById('monster-add-saves').innerHTML = saves;
    document.getElementById('monster-add-special').innerHTML = special;
    document.getElementById('monster-add-actions').innerHTML = actions;
    document.getElementById('monster-add-modal')?.classList.add('is-open');
    document.getElementById('monster-add-count')?.focus();
  }

  _closeMonsterAddModal() {
    document.getElementById('monster-add-modal')?.classList.remove('is-open');
    this._monsterPreviewData = null;
  }

  _submitMonsterAddModal() {
    const data = this._monsterPreviewData;
    if (!data) return;

    const count = Math.max(1, Number(document.getElementById('monster-add-count')?.value) || 1);
    const isGroup = document.getElementById('monster-add-group')?.checked ?? false;
    const hpPerUnit = Math.max(0, Number(document.getElementById('monster-add-hp')?.value) || 0);
    const basePayload = {
      nameBase: document.getElementById('monster-add-name')?.value.trim() || data.name,
      initiative: Number(document.getElementById('monster-add-init')?.value) || 0,
      hp: hpPerUnit,
      maxHp: hpPerUnit,
      ac: Number(document.getElementById('monster-add-ac')?.value) || 10,
      passivePerception: Number(document.getElementById('monster-add-pp')?.value) || 10,
      isPC: false,
      monsterIndex: data.index,
      monsterSource: data._source || this.core.settings.monsterApi || 'dnd5eapi',
      monsterData: data,
      isExpanded: false,
    };

    if (isGroup && count > 1) {
      this.core.addCombatant({
        ...basePayload,
        isGroup: true,
        groupCount: count,
        hpPools: Array.from({ length: count }, () => hpPerUnit),
      });
    } else {
      for (let i = 0; i < count; i++) {
        this.core.addCombatant({ ...basePayload, isGroup: false, groupCount: 1, hpPools: null });
      }
    }

    const searchInput = document.getElementById('monster-search');
    if (searchInput) searchInput.value = '';
    this._closeMonsterAddModal();
  }

  _endCombatAndClearMonsters() {
    if (this.core.combatants.length === 0) return;
    if (!confirm('Kampf beenden und alle Monster/NSCs aus der Initiative entfernen?')) return;
    this.core.endCombatAndRemoveMonsters();
    this._closeDrawer();
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
    const adapter = this._resolveAdapter(c.monsterSource || this.core.settings.monsterApi || 'dnd5eapi');
    const data = await adapter.fetchMonsterDetails(c.monsterIndex);
    if (data) this.core.updateCombatant(id, { monsterData: data });
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

  _buildSavingThrowsHtml(monsterData) {
    const proficiency = Array.isArray(monsterData?.proficiencies) ? monsterData.proficiencies : [];
    const saveRows = proficiency
      .filter((p) => String(p?.proficiency?.index || '').startsWith('saving-throw-'))
      .map((p) => {
        const stat = String(p.proficiency.index).replace('saving-throw-', '').toUpperCase();
        const value = Number(p.value) || 0;
        return `${stat} ${value >= 0 ? '+' : ''}${value}`;
      });

    if (saveRows.length === 0) return '<p class="stat-desc">—</p>';
    return `<p class="stat-desc">${saveRows.join(', ')}</p>`;
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
