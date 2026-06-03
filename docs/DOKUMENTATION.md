# Technische Dokumentation

Diese Datei beschreibt die interne Architektur, zentrale Datenflüsse und Erweiterungspunkte der Anwendung.

## 1. Architekturübersicht

Die App ist als SPA mit klarer Trennung aufgebaut:

- Core-Logik: Zustand, Regeln, Lifecycle
- Adapter: System- und API-spezifische Logik
- UI-Schicht: Rendering und Event-Handling
- Persistenz/Dateioperationen: gekapselte Serviceklassen

### 1.1 Module und Verantwortlichkeiten

- `js/main.js`
  - Initialisiert Module
  - Verbindet Core-Changes mit UI-Render
  - Stösst Initial-Render an
- `js/CombatTrackerCore.js`
  - Single Source of Truth für App-State
  - CRUD für Combatants
  - Kampfablauf (`startCombat`, `nextTurn`, `endCombat`, `endCombatAndRemoveMonsters`)
  - Sortierung und Naming-Konventionen
- `js/SystemAdapter5e.js`
  - API-Kommunikation (`fetchMonsterList`, `searchMonsters`, `fetchMonsterDetails`)
  - Regelbezogene Helfer (`calcModifier`, `rollInitiative`)
  - Mapping API-Monster -> Combatant-Payload
- `js/SystemAdapterOpen5e.js`
  - Open5e-v2-Kommunikation (`/creatures`)
  - Normalisierung von Open5e-Daten auf das bestehende Monster-Schema
  - Gleiches Adapter-Interface wie `SystemAdapter5e`
- `js/UIManager.js`
  - Bindet DOM-Events
  - Rendert Stats/Liste/Interaktionen
  - Koordiniert Modals (Manual, Settings, HP, Monster-Preview)
  - Beinhaltet UX-Workflowlogik
- `js/StorageManager.js`
  - LocalStorage laden/speichern/löschen
  - Privacy-Banner-Zustand
- `js/ExportImportManager.js`
  - Export/Import des JSON-Status

## 2. State-Modell

### 2.1 AppState

```js
{
  combatants: Combatant[],
  round: number,
  activeIndex: number,
  isCombatActive: boolean,
  settings: {
    autoHp: boolean,
    autoInitiative: boolean,
    namingConvention: 'numeric' | 'alphabetic' | 'adjective',
    tieBreaker: 'name' | 'dexterity',
    monsterApi: 'dnd5eapi' | 'open5e',
    system: 'dnd5e2014'
  }
}
```

### 2.2 Combatant

```js
{
  id: string,
  nameBase: string,
  name: string,
  initiative: number,
  hp: number,
  maxHp: number,
  ac: number,
  passivePerception: number,
  isPC: boolean,
  monsterIndex: string | null,
  monsterSource: 'dnd5eapi' | 'open5e',
  monsterData: object | null,
  isExpanded: boolean,
  isGroup: boolean,
  groupCount: number,
  hpPools: number[] | null
}
```

Hinweise:

- `hp` ist bei Gruppen die Summe aus `hpPools`
- `monsterData` kann persistiert als Cache-Marker vorliegen und wird bei Bedarf nachgeladen

## 3. Render- und Event-Flow

## 3.1 Bootstrap

1. `main.js` erzeugt Instanzen
2. `core.onChange = ui.render`
3. `core.loadFromStorage()`
4. `ui.bindEvents()`
5. `ui.render(core.getState())`

Zusätzlich:

- Adapter-Registry (`dnd5eapi`, `open5e`) wird in `main.js` verwaltet
- API-Wechsel in den Einstellungen tauscht den aktiven Adapter zur Laufzeit

## 3.2 Mutationsmodell

- Jede relevante Core-Mutation:
  - speichert via `_save()`
  - triggert via `_notify()` ein UI-Render

Das sorgt für deterministischen Zustand ohne verteilte DOM-Teilzustandslogik.

## 3.3 Tabelleninteraktionen

Event Delegation auf `initiative-list` verarbeitet:

- `remove`
- `remove-dead`
- `revive`
- `expand`
- `show-details`
- `open-hp-editor`
- `hp-minus`
- `hp-plus`

## 4. Kampf-Workflow

### 4.1 Start/Turn/Ende

- `startCombat()`:
  - setzt Runde auf 1
  - aktiviert ersten Eintrag
- `nextTurn()`:
  - geht zum nächsten Eintrag
  - bei Listenende: Runde +1, Index auf 0
- `endCombat()`:
  - beendet Kampfzustand ohne Liste zu verändern
- `endCombatAndRemoveMonsters()`:
  - beendet Kampf
  - entfernt alle Nicht-SCs

## 4.2 Sortierung

- Standard: absteigend nach Initiative
- Tie-Breaker: Name alphabetisch
- Aktiver Eintrag wird über ID stabil gehalten

## 5. TP- und Dead-UX

### 5.1 Dead-State

- Kriterium: `hp <= 0`
- Darstellung: Zeile ausgegraut, Name durchgestrichen
- Zusatzaktionen: Wiederbeleben, endgültig entfernen

### 5.2 HP-Dialog

Der Dialog unterstützt:

- Schaden (subtraktiv)
- Heilung (additiv)
- Direktes Setzen von aktuellen/maximalen TP
- Gruppen: Editierbare Pools

Gruppenlogik:

- Eingaben werden auf valide Werte gekappt (`>= 0`)
- Gesamt-TP und Poolanzahl werden konsistent in den Core zurückgeschrieben

## 6. Monster-Import-Workflow

### 6.1 Suche

- Debounced Input
- Trefferliste aus aktivem Adapter:
  - `dnd5eapi`: client-seitige Filterung auf gecachter Liste
  - `open5e`: server-seitige Suche über `name__icontains`
- API-Fehlerzustand mit Retry

### 6.2 Vorschau vor dem Hinzufügen

Beim Klick auf ein Suchergebnis:

1. Detaildaten laden
2. Preview-Modal öffnen
3. Werte bearbeiten (Name/Init/TP/AC/PP)
4. Anzahl setzen
5. Optional als Gruppe hinzufügen

### 6.3 Hinzufügen

- Ohne Gruppe: `count` einzelne Combatants
- Als Gruppe: 1 Combatant mit `groupCount` und `hpPools`

## 7. Persistenz und Datenaustausch

## 7.1 LocalStorage

- Speicherung über `StorageManager`
- Bei State-Mutation sofortiges Persistieren

## 7.2 Import/Export

- Export als JSON (SC-only oder full state)
- Import ersetzt aktiven Zustand

## 8. Sicherheit und Robustheit

- HTML-Escaping in UI-Ausgaben über `_esc`
- Defensive Null-Checks bei DOM-Zugriff
- API-Zugriffe mit Fehlerbehandlung

## 9. Styling-System

- Komplettes Styling in `css/custom.css`
- Design-Tokens per CSS-Variablen (`:root`)
- Semantische Klassen statt Utility-Klassen
- Modals über `is-open` gesteuert
- Drawer über `drawer--closed` gesteuert

## 10. Erweiterungspunkte

## 10.1 Weitere Regelsysteme

Empfohlener Weg:

1. Neuen Adapter analog zu `SystemAdapter5e` erstellen
2. Einheitliche Adapter-API beibehalten
3. Core unverändert lassen
4. UI schrittweise systemneutral erweitern

## 10.2 Foundry-VTT-Pfad

- Core-Methoden sind bereits nahe Combat-API-Denke
- UI-Render ist zentralisiert und dadurch templatefähig
- Event-Bindung kann später in Foundry `activateListeners` migriert werden

## 11. Test-Checkliste (manuell)

- Seite laden, gespeicherten Zustand wiederherstellen
- SC manuell anlegen
- Monster suchen, Preview öffnen, als Einzelmonster und als Gruppe hinzufügen
- Kampf starten, mehrere Runden schalten
- TP über Dialog manipulieren (inkl. Schaden/Heilung)
- Teilnehmer auf 0 TP bringen und Dead-Aktionen prüfen
- Kampf beenden und Monster-Cleanup prüfen
- Export/Import durchspielen

## 12. Troubleshooting

- Alte Skripte im Browsercache:
  - Hard Reload (`Ctrl+F5`)
  - DevTools `Disable cache`
- API nicht erreichbar:
  - Such-Fehleranzeige prüfen
  - Retry im Suchbereich ausführen

## 13. Begriffe

- SC: Spielercharakter
- NSC: Nichtspielercharakter
- Pool: Einzelner TP-Topf innerhalb einer Gruppe
