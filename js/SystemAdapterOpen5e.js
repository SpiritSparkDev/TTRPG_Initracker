/**
 * SystemAdapterOpen5e
 * Open5e system adapter. Uses the Open5e v2 creatures endpoint and normalizes
 * response data to the same shape used by the DnD5e adapter/UI.
 */
export class SystemAdapterOpen5e {
  static SYSTEM_ID = 'dnd5e2014';
  static SYSTEM_LABEL = 'D&D 5e (2014)';
  static ADAPTER_ID = 'open5e';
  static BASE_URL = 'https://api.open5e.com/v2';

  constructor() {
    /** @type {Map<string, object>} Cache for normalized monster detail objects */
    this._detailCache = new Map();
    /** @type {Array<{index:string, name:string}>|null} Optional warm cache */
    this._monsterList = null;
    /** @type {Promise<void>|null} In-flight warm-list fetch */
    this._listFetchPromise = null;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Open5e supports server-side search; we only warm the first page as optional cache.
   * @returns {Promise<Array<{index:string, name:string}>>}
   */
  async fetchMonsterList() {
    if (this._monsterList !== null) return this._monsterList;
    if (this._listFetchPromise) return this._listFetchPromise;

    this._listFetchPromise = fetch(`${SystemAdapterOpen5e.BASE_URL}/creatures/?limit=50&ordering=name`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
        return r.json();
      })
      .then(data => {
        const list = Array.isArray(data?.results)
          ? data.results.map(m => ({ index: m.key, name: m.name }))
          : [];
        this._monsterList = list;
        return this._monsterList;
      })
      .catch(e => {
        console.warn('[SystemAdapterOpen5e] fetchMonsterList failed:', e);
        return null;
      })
      .finally(() => {
        this._listFetchPromise = null;
      });

    return this._listFetchPromise;
  }

  /**
   * Searches creatures via Open5e's server-side filtering.
   * @param {string} query
   * @param {number} [limit=10]
   * @returns {Promise<Array<{index:string, name:string}>>}
   */
  async searchMonsters(query, limit = 10) {
    if (!query) return [];

    const url = new URL(`${SystemAdapterOpen5e.BASE_URL}/creatures/`);
    url.searchParams.set('name__icontains', query);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('ordering', 'name');

    const r = await fetch(url.toString());
    if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);

    const data = await r.json();
    const list = Array.isArray(data?.results) ? data.results : [];
    return list.map(m => ({
      index: m.key,
      name: m.name,
    }));
  }

  /**
   * Fetches and normalizes monster details by Open5e creature key.
   * @param {string} index - Open5e key, e.g. "a5e-mm_goblin"
   * @returns {Promise<object|null>}
   */
  async fetchMonsterDetails(index) {
    if (this._detailCache.has(index)) return this._detailCache.get(index);

    try {
      const r = await fetch(`${SystemAdapterOpen5e.BASE_URL}/creatures/${encodeURIComponent(index)}/`);
      if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);

      const raw = await r.json();
      const normalized = this._normalizeCreature(raw);
      this._detailCache.set(index, normalized);
      return normalized;
    } catch (e) {
      console.warn(`[SystemAdapterOpen5e] fetchMonsterDetails(${index}) failed:`, e);
      return null;
    }
  }

  /** Clears all internal caches. */
  clearCache() {
    this._monsterList = null;
    this._detailCache.clear();
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
   * Builds a Combatant partial object from normalized monster data.
   * @param {object} monsterData
   * @param {object} settings - App settings ({ autoHp, autoInitiative })
   * @returns {object}
   */
  buildCombatantFromMonster(monsterData, settings) {
    const hp = settings.autoHp ? monsterData.hit_points : 0;
    const initiative = settings.autoInitiative
      ? this.rollInitiative(monsterData.dexterity)
      : 0;

    const ac = Number(monsterData.armor_class) || 10;

    return {
      nameBase: monsterData.name,
      initiative,
      hp,
      maxHp: monsterData.hit_points,
      ac,
      dexterity: Number(monsterData.dexterity) || 10,
      passivePerception: monsterData.senses?.passive_perception ?? 10,
      isPC: false,
      monsterIndex: monsterData.index,
      monsterSource: SystemAdapterOpen5e.ADAPTER_ID,
      monsterData,
      isExpanded: false,
    };
  }

  _normalizeCreature(raw) {
    const abilities = raw?.ability_scores || {};
    const passivePerception = Number(raw?.passive_perception) || 10;
    const savingThrows = raw?.saving_throws || {};
    const traits = Array.isArray(raw?.traits) ? raw.traits : [];
    const actions = Array.isArray(raw?.actions) ? raw.actions : [];

    const proficiencies = Object.entries(savingThrows).map(([ability, value]) => ({
      proficiency: { index: `saving-throw-${ability.toLowerCase()}` },
      value: Number(value) || 0,
    }));

    const legendaryActions = actions
      .filter(a => a?.action_type === 'LEGENDARY_ACTION')
      .map(a => ({ name: a.name, desc: a.desc }));

    return {
      index: raw.key,
      name: raw.name,
      armor_class: Number(raw.armor_class) || 10,
      hit_points: Number(raw.hit_points) || 0,
      strength: Number(abilities.strength) || 10,
      dexterity: Number(abilities.dexterity) || 10,
      constitution: Number(abilities.constitution) || 10,
      intelligence: Number(abilities.intelligence) || 10,
      wisdom: Number(abilities.wisdom) || 10,
      charisma: Number(abilities.charisma) || 10,
      senses: {
        passive_perception: passivePerception,
      },
      proficiencies,
      special_abilities: traits.map(t => ({ name: t.name, desc: t.desc })),
      actions: actions.map(a => ({ name: a.name, desc: a.desc })),
      legendary_actions: legendaryActions,
      _source: SystemAdapterOpen5e.ADAPTER_ID,
      _raw: raw,
    };
  }
}
