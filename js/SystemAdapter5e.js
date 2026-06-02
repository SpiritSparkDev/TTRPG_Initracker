/**
 * SystemAdapter5e
 * D&D 5e (SRD 2014) system adapter. Handles all external API communication
 * and system-specific rule calculations.
 *
 * System-Adapter-Pattern: Replace this class with a different adapter
 * (e.g. SystemAdapterPathfinder) to support other RPG systems without
 * touching CombatTrackerCore or UIManager.
 */
export class SystemAdapter5e {
  static SYSTEM_ID = 'dnd5e2014';
  static SYSTEM_LABEL = 'D&D 5e (2014)';
  static BASE_URL = 'https://www.dnd5eapi.co/api';

  constructor() {
    /** @type {Map<string, object>} Cache for monster detail objects */
    this._detailCache = new Map();
    /** @type {Array<{index:string, name:string}>|null} Full monster list */
    this._monsterList = null;
    /** @type {Promise<void>|null} In-flight list fetch */
    this._listFetchPromise = null;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Fetches (and caches) the full monster list on first call.
   * Subsequent calls return the cached list immediately.
   * @returns {Promise<Array<{index:string, name:string}>>}
   */
  async fetchMonsterList() {
    if (this._monsterList) return this._monsterList;
    if (this._listFetchPromise) return this._listFetchPromise;

    this._listFetchPromise = fetch(`${SystemAdapter5e.BASE_URL}/monsters`)
      .then(r => r.json())
      .then(data => {
        this._monsterList = data.results || [];
        return this._monsterList;
      })
      .catch(e => {
        console.warn('[SystemAdapter5e] fetchMonsterList failed:', e);
        this._monsterList = [];
        return [];
      })
      .finally(() => { this._listFetchPromise = null; });

    return this._listFetchPromise;
  }

  /**
   * Searches the monster list by name prefix (case-insensitive).
   * Waits for the list to be available, then filters client-side.
   * @param {string} query
   * @param {number} [limit=10]
   * @returns {Promise<Array<{index:string, name:string}>>}
   */
  async searchMonsters(query, limit = 10) {
    const list = await this.fetchMonsterList();
    if (!query) return [];
    const q = query.toLowerCase();
    return list.filter(m => m.name.toLowerCase().includes(q)).slice(0, limit);
  }

  /**
   * Fetches full monster details. Results are cached per index.
   * @param {string} index - e.g. "goblin"
   * @returns {Promise<object|null>}
   */
  async fetchMonsterDetails(index) {
    if (this._detailCache.has(index)) return this._detailCache.get(index);
    try {
      const r = await fetch(`${SystemAdapter5e.BASE_URL}/monsters/${index}`);
      const data = await r.json();
      this._detailCache.set(index, data);
      return data;
    } catch (e) {
      console.warn(`[SystemAdapter5e] fetchMonsterDetails(${index}) failed:`, e);
      return null;
    }
  }

  /**
   * Calculates a D&D 5e ability score modifier.
   * @param {number} stat - Ability score (e.g. 14)
   * @returns {number} Modifier (e.g. +2)
   */
  calcModifier(stat) {
    return Math.floor((stat - 10) / 2);
  }

  /**
   * Rolls 1d20 and adds the DEX modifier.
   * @param {number} dexScore - Dexterity ability score
   * @returns {number}
   */
  rollInitiative(dexScore) {
    return Math.floor(Math.random() * 20) + 1 + this.calcModifier(dexScore);
  }

  /**
   * Builds a Combatant partial object from raw API monster data.
   * @param {object} monsterData - Full monster object from the API
   * @param {object} settings - App settings ({ autoHp, autoInitiative })
   * @returns {object} Partial combatant (without id / name suffix — handled by Core)
   */
  buildCombatantFromMonster(monsterData, settings) {
    const hp = settings.autoHp ? monsterData.hit_points : 0;
    const initiative = settings.autoInitiative
      ? this.rollInitiative(monsterData.dexterity)
      : 0;

    // armor_class can be an array of objects [{type, value}] or a number (older API)
    let ac = 10;
    if (Array.isArray(monsterData.armor_class) && monsterData.armor_class.length > 0) {
      ac = monsterData.armor_class[0].value ?? 10;
    } else if (typeof monsterData.armor_class === 'number') {
      ac = monsterData.armor_class;
    }

    return {
      nameBase: monsterData.name,
      initiative,
      hp,
      maxHp: monsterData.hit_points,
      ac,
      passivePerception: monsterData.senses?.passive_perception ?? 10,
      isPC: false,
      monsterIndex: monsterData.index,
      monsterData,
      isExpanded: false,
    };
  }
}
