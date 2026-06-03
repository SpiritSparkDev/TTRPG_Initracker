import { StorageManager } from './StorageManager.js';

/**
 * CombatTrackerCore
 * Central state manager and rule logic for the Initiative Tracker.
 *
 * Foundry VTT compatibility note:
 * The public API (startCombat, nextTurn, endCombat) mirrors
 * Foundry's game.combat interface intentionally, so this class
 * can later be wrapped inside a Foundry CombatTracker Application
 * with minimal changes.
 *
 * No DOM access in this class — all UI updates are triggered via onChange.
 */
export class CombatTrackerCore {
  /** Adjectives for the "adjective" naming convention (D&D-themed, German). */
  static ADJECTIVES = [
    'Flinker', 'Wütender', 'Blasser', 'Hungriger', 'Alter',
    'Junger', 'Gehörnter', 'Einäugiger', 'Narbenbedeckter', 'Dreckiger',
    'Knurriger', 'Schleichender', 'Brüllender', 'Verfluchter', 'Tapferer',
  ];

  /** Default settings applied when no saved state exists. */
  static DEFAULT_SETTINGS = {
    autoHp: true,
    autoInitiative: true,
    namingConvention: 'numeric', // 'numeric' | 'alphabetic' | 'adjective'
    tieBreaker: 'name', // 'name' | 'dexterity'
    system: 'dnd5e2014',
    monsterApi: 'dnd5eapi', // 'dnd5eapi' | 'open5e'
  };

  constructor() {
    /** @type {object[]} List of Combatant objects, sorted descending by initiative */
    this.combatants = [];
    /** @type {number} Current combat round (1-based when active) */
    this.round = 0;
    /** @type {number} Index of the currently active combatant (-1 = none) */
    this.activeIndex = -1;
    /** @type {boolean} Whether combat has been started */
    this.isCombatActive = false;
    /** @type {object} App settings */
    this.settings = { ...CombatTrackerCore.DEFAULT_SETTINGS };
    /** @type {Function|null} Callback fired after every state mutation */
    this.onChange = null;
  }

  // ---------------------------------------------------------------------------
  // State accessors
  // ---------------------------------------------------------------------------

  /** Returns a plain-object snapshot of the current state (for storage / export). */
  getState() {
    return {
      combatants: this.combatants.map(c => ({
        ...c,
        // Don't persist full monsterData to avoid bloating LocalStorage;
        // we re-attach it on import or keep a reference via monsterIndex.
        monsterData: c.monsterData ? { _cached: true, index: c.monsterIndex } : null,
      })),
      round: this.round,
      activeIndex: this.activeIndex,
      isCombatActive: this.isCombatActive,
      settings: this.settings,
    };
  }

  /**
   * Returns a full state snapshot including monsterData (for JSON export).
   */
  getFullState() {
    return {
      combatants: this.combatants,
      round: this.round,
      activeIndex: this.activeIndex,
      isCombatActive: this.isCombatActive,
      settings: this.settings,
    };
  }

  /** Returns only PC combatants (isPC === true). */
  getPCCombatants() {
    return this.combatants.filter(c => c.isPC);
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  /** Saves current state to LocalStorage. */
  _save() {
    StorageManager.save(this.getState());
  }

  /**
   * Loads state from LocalStorage and hydrates this instance.
   * Call once during app init.
   */
  loadFromStorage() {
    const saved = StorageManager.load();
    if (!saved) return;
    this._hydrateFromObject(saved);
  }

  /**
   * Overwrites the current state from an external object (import).
   * @param {object} data - State object (from JSON export)
   */
  loadFromExport(data) {
    this._hydrateFromObject(data);
    this._save();
    this._notify();
  }

  _hydrateFromObject(data) {
    this.combatants = (data.combatants || []).map(c => ({
      ...c,
      // Restore monsterData reference markers — actual data reloaded on demand
      monsterData: c.monsterData ?? null,
      monsterSource: c.monsterSource || (data.settings?.monsterApi ?? CombatTrackerCore.DEFAULT_SETTINGS.monsterApi),
      combatantType: c.combatantType || (c.isPC ? 'sc' : 'monster'),
      isExpanded: c.isExpanded ?? false,
      isGroup: c.isGroup ?? false,
      groupCount: Number(c.groupCount) || 1,
      hpPools: Array.isArray(c.hpPools) ? c.hpPools.map(n => Number(n) || 0) : null,
    }));
    this.round = data.round ?? 0;
    this.activeIndex = data.activeIndex ?? -1;
    this.isCombatActive = data.isCombatActive ?? false;
    this.settings = { ...CombatTrackerCore.DEFAULT_SETTINGS, ...(data.settings || {}) };
  }

  // ---------------------------------------------------------------------------
  // Combatant CRUD
  // ---------------------------------------------------------------------------

  /**
   * Adds a new combatant to the tracker.
   * @param {object} partial - Partial combatant data (see Combatant schema)
   * @returns {object} The created combatant
   */
  addCombatant(partial) {
    const baseName = partial.nameBase || partial.name || 'Unbekannt';
    const name = this._resolveDisplayName(baseName);
    const initialHp = Number(partial.hp) || 0;
    const initialMaxHp = Number(partial.maxHp ?? partial.hp) || 0;
    const isGroup = Boolean(partial.isGroup);
    const groupCount = Math.max(1, Number(partial.groupCount) || 1);
    const hpPools = isGroup
      ? (Array.isArray(partial.hpPools) && partial.hpPools.length > 0
          ? partial.hpPools.map(n => Math.max(0, Number(n) || 0))
          : Array.from({ length: groupCount }, () => initialHp))
      : null;

    const combatant = {
      id: crypto.randomUUID(),
      nameBase: baseName,
      name,
      initiative: Number(partial.initiative) || 0,
      hp: isGroup ? hpPools.reduce((sum, val) => sum + val, 0) : initialHp,
      maxHp: isGroup ? (initialMaxHp * groupCount) : initialMaxHp,
      ac: Number(partial.ac) || 10,
      dexterity: Number(partial.dexterity) || 10,
      passivePerception: Number(partial.passivePerception) || 10,
      isPC: Boolean(partial.isPC),
      combatantType: partial.combatantType || (partial.isPC ? 'sc' : 'monster'),
      isGroup,
      groupCount,
      hpPools,
      monsterIndex: partial.monsterIndex ?? null,
      monsterSource: partial.monsterSource ?? this.settings.monsterApi ?? CombatTrackerCore.DEFAULT_SETTINGS.monsterApi,
      monsterData: partial.monsterData ?? null,
      isExpanded: false,
    };

    this.combatants.push(combatant);
    // Keep insertion order before combat starts; only auto-sort in active combat.
    if (this.isCombatActive) this.sortByInitiative();

    // If combat is already running, the activeIndex points to the same combatant
    // (sort may have shifted positions)
    this._save();
    this._notify();
    return combatant;
  }

  /**
   * Removes a combatant by id.
   * @param {string} id
   */
  removeCombatant(id) {
    const idx = this.combatants.findIndex(c => c.id === id);
    if (idx === -1) return;
    this.combatants.splice(idx, 1);
    // Keep activeIndex in bounds
    if (this.activeIndex >= this.combatants.length) {
      this.activeIndex = Math.max(0, this.combatants.length - 1);
    }
    if (this.combatants.length === 0) this.isCombatActive = false;
    this._save();
    this._notify();
  }

  /**
   * Partially updates a combatant.
   * @param {string} id
   * @param {object} patch - Key/value pairs to merge
   */
  updateCombatant(id, patch) {
    const combatant = this.combatants.find(c => c.id === id);
    if (!combatant) return;

    if (combatant.isGroup && Array.isArray(combatant.hpPools) && 'hp' in patch && !('hpPools' in patch)) {
      const requestedHp = Math.max(0, Number(patch.hp) || 0);
      const perPoolCap = Math.max(0, Math.floor((Number(combatant.maxHp) || 0) / Math.max(1, combatant.groupCount || 1)));
      let remaining = requestedHp;
      const nextPools = [];
      for (let i = 0; i < combatant.hpPools.length; i++) {
        const val = Math.max(0, Math.min(perPoolCap, remaining));
        nextPools.push(val);
        remaining -= val;
      }
      patch.hpPools = nextPools;
    }

    Object.assign(combatant, patch);

    if (combatant.isGroup && Array.isArray(combatant.hpPools)) {
      combatant.hpPools = combatant.hpPools.map(n => Math.max(0, Number(n) || 0));
      combatant.groupCount = Math.max(1, combatant.hpPools.length);
      combatant.hp = combatant.hpPools.reduce((sum, val) => sum + val, 0);
      const maxPerUnit = Math.max(0, Math.floor((Number(combatant.maxHp) || 0) / combatant.groupCount));
      combatant.maxHp = Math.max(combatant.hp, maxPerUnit * combatant.groupCount);
    } else {
      combatant.hp = Math.max(0, Number(combatant.hp) || 0);
      combatant.maxHp = Math.max(0, Number(combatant.maxHp) || 0);
      if (combatant.hp > combatant.maxHp) combatant.hp = combatant.maxHp;
    }

    // Initiative edits should reorder only during active combat.
    if (this.isCombatActive && 'initiative' in patch) this.sortByInitiative();

    this._save();
    this._notify();
  }

  /**
   * Updates the settings object.
   * @param {object} patch
   */
  updateSettings(patch) {
    Object.assign(this.settings, patch);
    this._save();
    this._notify();
  }

  // ---------------------------------------------------------------------------
  // Sorting
  // ---------------------------------------------------------------------------

  /**
   * Sorts combatants descending by initiative.
   * Ties are broken by name (alphabetical).
   * Preserves activeIndex so the current combatant stays highlighted after re-sort.
   */
  sortByInitiative() {
    const activeId = (this.isCombatActive && this.activeIndex >= 0)
      ? this.combatants[this.activeIndex]?.id
      : null;
    const tieBreaker = this.settings.tieBreaker || 'name';

    this.combatants.sort((a, b) => {
      if (b.initiative !== a.initiative) return b.initiative - a.initiative;

      if (tieBreaker === 'dexterity') {
        const dexDiff = (Number(b.dexterity) || 10) - (Number(a.dexterity) || 10);
        if (dexDiff !== 0) return dexDiff;
      }

      return a.name.localeCompare(b.name);
    });

    if (activeId !== null) {
      const newIdx = this.combatants.findIndex(c => c.id === activeId);
      if (newIdx !== -1) this.activeIndex = newIdx;
    }
  }

  // ---------------------------------------------------------------------------
  // Combat flow (mirrors Foundry's game.combat API)
  // ---------------------------------------------------------------------------

  /**
   * Starts combat: sets round to 1, marks first combatant active.
   * Analogous to Foundry's Combat#startCombat().
   */
  startCombat() {
    if (this.combatants.length === 0) return;
    // First ordering happens when combat starts.
    this.sortByInitiative();
    this.round = 1;
    this.activeIndex = 0;
    this.isCombatActive = true;
    this._save();
    this._notify();
  }

  /**
   * Advances to the next turn.
   * Wraps around to round+1 at the end of the list.
   * Analogous to Foundry's Combat#nextTurn().
   */
  nextTurn() {
    if (!this.isCombatActive || this.combatants.length === 0) return;
    this.activeIndex++;
    if (this.activeIndex >= this.combatants.length) {
      this.activeIndex = 0;
      this.round++;
    }
    this._save();
    this._notify();
  }

  /**
   * Ends combat and resets all combat state.
   * Analogous to Foundry's Combat#endCombat().
   */
  endCombat() {
    this.round = 0;
    this.activeIndex = -1;
    this.isCombatActive = false;
    this._save();
    this._notify();
  }

  /**
   * Ends combat and removes all non-PC combatants (monsters + NPCs).
   */
  endCombatAndRemoveMonsters() {
    this.combatants = this.combatants.filter(c => c.isPC);
    this.round = 0;
    this.activeIndex = -1;
    this.isCombatActive = false;
    this._save();
    this._notify();
  }

  /**
   * Resets the entire tracker (removes all combatants, ends combat).
   */
  reset() {
    this.combatants = [];
    this.round = 0;
    this.activeIndex = -1;
    this.isCombatActive = false;
    StorageManager.clear();
    this._notify();
  }

  // ---------------------------------------------------------------------------
  // Naming convention
  // ---------------------------------------------------------------------------

  /**
   * Resolves the display name for a new combatant based on the current
   * naming convention. Also renames the first occurrence if it has no suffix yet.
   * @param {string} baseName
   * @returns {string} Resolved display name
   */
  _resolveDisplayName(baseName) {
    const existing = this.combatants.filter(c => c.nameBase === baseName);
    if (existing.length === 0) return baseName;

    // First duplicate: rename the existing un-suffixed entry
    if (existing.length === 1 && existing[0].name === baseName) {
      existing[0].name = this._buildSuffixedName(baseName, 0);
    }

    return this._buildSuffixedName(baseName, existing.length);
  }

  /**
   * @param {string} base
   * @param {number} index - 0-based position among same-name combatants
   * @returns {string}
   */
  _buildSuffixedName(base, index) {
    switch (this.settings.namingConvention) {
      case 'alphabetic':
        return `${base} ${String.fromCharCode(65 + index)}`;
      case 'adjective': {
        const adj = CombatTrackerCore.ADJECTIVES[index % CombatTrackerCore.ADJECTIVES.length];
        return `${adj} ${base}`;
      }
      case 'numeric':
      default:
        return `${base} ${index + 1}`;
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  _notify() {
    if (typeof this.onChange === 'function') this.onChange(this.getState());
  }
}
