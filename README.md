# 5e Initiative Tracker

Ein modularer, clientseitiger Initiative-Tracker für D&D 5e (SRD 2014) mit API-gestütztem Monster-Import, LocalStorage-Persistenz und Fokus auf schnellen Spieltisch-Workflow.

## Ziele des Projekts

- Schnelles Leiten von Kämpfen mit minimalen Klicks
- Robuste Offline-nahe Nutzung (nach initialem Laden der API-Daten)
- Klare Trennung von Logik, UI und Systemadapter
- Erweiterbarkeit für weitere Regelsysteme und spätere Foundry-VTT-Integration

## Features (aktueller Stand)

### Kampf und Initiative

- Initiative-Liste mit automatischer Sortierung (absteigend)
- Kampf starten, Zug weiterschalten, Kampf beenden
- Beim Kampf beenden: Monster/NSCs werden entfernt, SCs bleiben erhalten
- Rundenzähler und aktiver Teilnehmer werden live angezeigt

### Teilnehmerverwaltung

- Manuelle Teilnehmererfassung (Name, Initiative, TP, RK, Passive Wahrnehmung, SC-Flag)
- Monster-Suche über dnd5eapi.co
- Dead-State-UX:
  - Teilnehmer mit 0 TP werden visuell ausgegraut
  - Aktionen für Wiederbeleben und endgültiges Entfernen

### Trefferpunkte-Workflow (UX)

- Klick auf TP öffnet einen TP-Dialog
- Im Dialog:
  - Schaden eingeben (abziehen)
  - Heilung eingeben (addieren)
  - Aktuelle TP direkt setzen
  - Maximale TP direkt setzen
- für Gruppen: einzelne TP-Pools im selben Dialog editierbar

### Monster-Workflow vor dem Hinzufügen

- Monster werden nicht sofort hinzugefügt
- Stattdessen: Vorschau-/Vorbereitungsdialog mit:
  - Statblock-Abschnitten (Fähigkeiten, Aktionen)
  - Editierbare Werte vor übernahme (Name, Initiative, TP, RK, Passive Wahrnehmung)
  - Anzahl desselben Monstertyps
  - Option Als Gruppe (gemeinsame Initiative, mehrere TP-Pools)

### Gruppen

- Gruppen-Eintrag mit gemeinsamer Initiative
- Mehrere interne TP-Pools pro Gruppe
- Gruppenkennzeichnung in der Tabelle

### Persistenz, Import/Export, Datenschutz

- Automatisches Speichern aller änderungen in LocalStorage
- JSON-Export:
  - Nur SCs
  - Gesamter Kampf
- JSON-Import (überschreibt aktuellen Zustand)
- Datenschutz-Banner zur rein lokalen Speicherung

## Tech Stack

- HTML5
- Vanilla CSS (Design-Tokens als CSS Custom Properties)
- Vanilla JavaScript (ES Modules, klassenbasiert)
- Externe API: https://www.dnd5eapi.co/api

## Projektstruktur

```text
css/
  custom.css                # Komplettes Styling (Vanilla CSS)
js/
  main.js                   # App-Bootstrap
  CombatTrackerCore.js      # Zustand, Kampflogik, CRUD, Sortierung
  SystemAdapter5e.js        # D&D-API, regelbezogene Berechnungen
  UIManager.js              # Rendering, Events, Modals, Workflows
  StorageManager.js         # LocalStorage Zugriff
  ExportImportManager.js    # JSON Export/Import
index.html                  # SPA-Markup
tasks/
  PLAN.md                   # Ursprüngliche Spezifikation
```

## Schnellstart

## Voraussetzungen

- Node.js installiert
- Beliebiger statischer Server

## Start (Beispiel)

```powershell
cd E:\Werkbank\5eIni_tracker
npx serve . --listen 3000
```

Danach im Browser:

- http://localhost:3000

Hinweis bei unerwartetem Verhalten nach Code-änderungen:

- Hard Refresh mit Ctrl+F5
- Optional in DevTools: Network > Disable cache

## Bedienung im Alltag

### Typischer Kampfablauf

1. Monster über Suche finden
2. Monster im Vorschau-Dialog anpassen (optional)
3. Anzahl/Gruppe festlegen und hinzufügen
4. SCs und Sonder-NSCs manuell erfassen
5. Kampf starten
6. Mit Nächster Zug rotieren
7. TP über Plus/Minus oder TP-Dialog pflegen
8. Tote Teilnehmer verwalten (wiederbeleben/entfernen)
9. Kampf beenden (räumt Monster/NSCs auf)

### Tastatur

- Escape im Suchfeld: Trefferliste schliessen
- Space: Nächster Zug (nur wenn Fokus nicht in Input/Select/Button liegt)

## Datenmodell (Kurzfassung)

Ein Combatant enthält unter anderem:

- id
- nameBase, name
- initiative
- hp, maxHp
- ac, passivePerception
- isPC
- monsterIndex, monsterData
- isExpanded
- isGroup, groupCount, hpPools

## API-Hinweise

- Monster-Liste wird gecacht
- Monster-Details werden pro Index gecacht
- Bei API-Ausfall erscheint eine Such-Fehlermeldung mit Retry

## Bekannte Grenzen

- Keine serverseitige Synchronisation/Multi-User
- Keine undo/redo-Historie
- Keine getrennten Encounter-Slots/Mehrkampfverwaltung

## Roadmap (empfohlen)

- Feinere Gruppen-UX direkt in der Tabelle (Pool-Chips, Pool-targeted Damage)
- Bulk-Aktionen (z. B. alle Toten entfernen)
- Validierungs- und Komfortschritte im Monster-Vorschau-Dialog
- Optionales Logging/Combat-History
- Weitere Systemadapter (z. B. PF2e, DSA)

## Lizenz und Hinweise

- Nutzt öffentliche Daten der dnd5eapi.co im Rahmen deren Bedingungen
- D&D SRD/Regelbegriffe beachten
- Dieses Projekt speichert Daten lokal im Browser (LocalStorage)
