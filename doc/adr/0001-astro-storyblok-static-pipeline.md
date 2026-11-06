# ADR-0001: Astro, Storyblok und statische Deployment-Pipeline

- **Status:** Angenommen
- **Datum:** 2026-11-05

## Kontext

RetroKompott soll als schlanke Astro-Anwendung statische Seiten für GitHub Pages erzeugen. Storyblok liefert redaktionelle Inhalte; daneben soll die Struktur des Storyblok-Spaces (Komponenten und Felder) versioniert und automatisiert bereitgestellt werden. Es gibt damit drei unterschiedliche Verantwortlichkeiten:

1. veröffentlichte Inhalte aus Storyblok abrufen,
2. die versionierte Inhaltsstruktur nach Storyblok deployen,
3. aus den abgerufenen Inhalten die statische Website bauen und veröffentlichen.

GitHub Pages führt keinen Astro-Server aus. Abfragen, die auf dem Server beim Seitenaufruf stattfinden, sind dort nicht verfügbar. CMS-Inhalte müssen daher bereits beim Build abgerufen und in HTML und Assets umgewandelt sein. Eine Veröffentlichung in Storyblok allein aktualisiert eine bestehende statische Website nicht.

## Entscheidung

Wir verwenden Astro als statisch prerenderndes Frontend und Storyblok als Quelle für Inhalte und deren redaktionelle Pflege. Die drei Aufgaben werden in getrennten Skripten und Workflows mit getrennten Berechtigungen abgebildet.

### Projektstruktur

Astros etablierte `src/`- und `public/`-Grenze bleibt erhalten. Dateien unter `src/` werden vom Build verarbeitet; Dateien unter `public/` werden unverändert kopiert. Fachliche Zuständigkeiten werden innerhalb von `src/` getrennt:

```text
.github/
  workflows/
    site.yml                     # Content abrufen, statisch bauen, Pages deployen
    storyblok-structure.yml      # versionierte Storyblok-Struktur deployen
storyblok/
  components/                    # deklarative, versionierte Block-/Felddefinitionen
scripts/
  storyblok/
    fetch-content.ts             # Delivery API: veröffentlichte Inhalte abrufen
    deploy-structure.ts          # Management API: Strukturen idempotent synchronisieren
src/
  components/
    storyblok/                   # Renderer für Storyblok-Komponenten/Blöcke
  content.config.ts              # Collections und Laufzeit-/Buildzeit-Schemas
  layouts/
  pages/                         # URL-Routen; erzeugen die statischen Seiten
  styles/
```

Die Struktur ist eine Konvention, keine von Astro vorgeschriebene Architektur. Kleine Sites sollen keine zusätzlichen Layer oder UI-Frameworks einführen, bevor konkreter Bedarf besteht.

### Content-Fetch und Frontend-Deployment

- Der Fetch verwendet die Storyblok Content Delivery API und ruft veröffentlichte Inhalte zur Buildzeit ab. Er läuft als eigener Job **innerhalb desselben GitHub-Actions-Workflows und Laufs** wie der Seiten-Build.
- Für CI-/Deployment-Builds ist Storyblok die Quelle, aus der das Frontend zur Buildzeit Inhalte liest. Im initialen Mischbetrieb können Storys entweder redaktionell direkt in Storyblok angelegt oder aus WordPress inkrementell importiert worden sein; beide werden im selben Storyblok-Snapshot gerendert. Der WordPress-Importer ist ein separater vorgelagerter Schreibprozess gemäß ADR-0002 und kein zusätzlicher Buildzeit-Content-Provider. Die lokale Cache-Ausnahme während der Migration ist nachfolgend festgelegt.
- Ein WordPress-Delta-Import aktualisiert Storyblok und stößt erst nach erfolgreichem Abschluss den Site-Build an. Ein direkter Storyblok-Publish stößt den Site-Build direkt an. So verwendet der Build in beiden Fällen dieselbe Delivery-API-Abfrage und vermeidet eine Laufzeit-Prioritätslogik zwischen zwei CMS.
- Die lokalen Content-Quellen folgen einer dreistufigen, über `.env` gesteuerten Reihenfolge: `CONTENT_MIGRATION_STATUS=cache_only` liest ausschließlich den WordPress-Cache und wird für den ersten lokalen Website-Aufbau und die fachliche Abnahme verwendet, bevor Storyblok als Content-Quelle startet. `in_progress` schaltet auf Mischbetrieb um: WP-importierte Beiträge und Seiten kommen aus `migration-cache/wordpress/`, native Storyblok-Stories aus der Content Delivery API. Stories mit WP-Ursprungsschlüssel werden in dieser Phase nicht zusätzlich aus Storyblok eingelesen.
- Mit `CONTENT_MIGRATION_STATUS=complete` kommen lokale Build-Inhalte vollständig aus Storyblok; der WordPress-Cache wird nicht mehr als Content-Quelle verwendet. Nur `cache_only`, `in_progress` und `complete` sind gültige Werte; ein fehlender oder unbekannter Wert lässt den lokalen Content-Build mit einer klaren Fehlermeldung abbrechen, statt still auf eine andere Quelle umzuschalten.
- Für den normalen lokalen Site-Build wird `CONTENT_MIGRATION_STATUS` aus `.env` als Buildzeit-Konfiguration verwendet und nicht als `PUBLIC_`-Variable an Client-Code weitergegeben. Die lokale `.env` darf zusätzlich nicht öffentliche Zugangsdaten für getrennte Aufgaben enthalten, darunter das Storyblok-Management-Token (ADR-0003) und die R2-Transfer-Schlüssel (ADR-0007); der Site-Build liest diese Secrets nicht. Der öffentliche GitHub-Actions-Build setzt den Status explizit auf die für die jeweilige Migrationsphase freigegebene Quelle. Vor Abschluss der lokalen Cache-Abnahme wird kein Storyblok-Content-Build als Ersatz für den Cache-only-Test betrachtet. Lokale Secrets werden nicht in den Workflow übernommen.
- Die Storyblok-Astro-Schnellstartanleitung zeigt auch `output: "server"` für ihr Integrationsbeispiel. Diese Laufzeitkonfiguration übernehmen wir nicht: Für GitHub Pages ruft unser Fetch-Skript die Delivery API vor dem statischen Build ab.
- Der Job validiert die Antwort gegen ein definiertes Schema und veröffentlicht sie als kurzlebiges Workflow-Artefakt. Der Frontend-Build benötigt dieses Artefakt als explizite Abhängigkeit (`needs`); er baut nicht mit veralteten, unbemerkt übrig gebliebenen lokalen Daten.
- Das Frontend liest den Snapshot über Astro-Content-Collections beziehungsweise einen passenden Loader. Collections und ihre Schemas sind die typisierte Grenze zwischen CMS-Daten und Seitencode. CMS-spezifische Daten werden in Storyblok-Renderern und gegebenenfalls einem Adapter normalisiert, nicht ungeprüft durch alle Seiten gereicht.
- Der Workflow installiert exakt aus dem pnpm-Lockfile (`pnpm install --frozen-lockfile`), prüft die Anwendung, baut statisch nach `docs/` und veröffentlicht dieses Verzeichnis über GitHub-Actions-Pages-Artefakte. Die GitHub-Pages-Quelle wird auf **GitHub Actions** gesetzt; `docs/` ist das Build-Verzeichnis, nicht die Deployment-Quelle aus dem Branch.
- Ein Storyblok-Publish-Webhook (oder ein gleichwertiger authentifizierter Dispatch) startet einen neuen Site-Workflow. Zusätzlich startet ein Push auf den Hauptbranch den Build, damit Codeänderungen veröffentlicht werden. Auch Preview- oder Draft-Inhalte benötigen einen Build und ein entsprechend geschütztes Preview-Deployment.

### Storyblok-Struktur-Deployment

- Die Definitionen der Komponenten und Felder werden als Quelltext in `storyblok/components/` versioniert. Änderungen daran lösen den getrennten Struktur-Deployment-Workflow aus; ein manueller Lauf ist für gezielte Wiederholungen möglich.
- Das Deployment-Skript synchronisiert die Definitionen idempotent über die Storyblok Management API. Wiederholte Läufe mit derselben Definition sollen denselben Zielzustand herstellen.
- Nur dieser Workflow erhält ein kurzlebiges, möglichst eng berechtigtes Management-API-Token als GitHub-Actions-Secret. Fetch- und Frontend-Jobs erhalten es nicht. Der Management-API-Token wird niemals in den statischen Build, ein Artefakt oder Browser-Code aufgenommen.
- Die Jobs haben getrennte minimale GitHub-Berechtigungen und Secrets. CMS-API-Ratenlimits, Pagination, Fehlerantworten und begrenzte Wiederholungen mit Backoff werden vom jeweiligen Skript berücksichtigt.

## Konsequenzen

- Eine neue Storyblok-Veröffentlichung erfordert einen neuen Build und Pages-Deploy; Änderungen sind deshalb nicht unmittelbar zur Laufzeit sichtbar.
- Während des Mischbetriebs laufen zwei getrennte Aktualisierungspfade auf die gemeinsame Storyblok-Quelle: WordPress → inkrementeller Import → Build sowie Storyblok-Publish → Build. Storyblok-native und importierte Inhalte verwenden damit dieselben Frontend-Schemas, Renderer und Build-Validierungen.
- Vor Beginn der Storyblok-Content-Migration kann `cache_only` für einen lokalen Abnahme-Build ausschließlich aus dem WordPress-Cache verwendet werden. Danach nutzen lokale Builds bei `in_progress` den Cache für WP-verwaltete Inhalte und Storyblok für native Stories. Der öffentliche CI-Build bleibt davon getrennt und verwendet explizit die für die aktuelle Freigabe bestimmte Quelle.
- CMS-Ausfälle oder ungültige Daten sollen den Build sichtbar fehlschlagen lassen, anstatt stillschweigend mit einer alten oder leeren Seite zu veröffentlichen.
- Das Workflow-Artefakt koppelt Fetch und Build an denselben Commit und Lauf, ist aber keine dauerhafte Content-Historie. Soll ein Snapshot reproduzierbar versioniert oder zwischen unabhängigen Läufen geteilt werden, wird dafür eine separate Entscheidung benötigt.
- CMS-Struktur und Frontend-Renderer müssen gemeinsam weiterentwickelt werden. Ein erfolgreicher Struktur-Deploy garantiert nicht automatisch, dass der neue Block bereits im Frontend gerendert wird; deshalb prüfen Tests die erwarteten Blocktypen und Schemas.
- Ein Wechsel zu SSR, Live-Content-Collections oder request-time-Rendering ist eine neue Architekturentscheidung und erfordert einen für die Laufzeit geeigneten Host statt GitHub Pages.
- Die bestehende Repo-Konfiguration baut bereits nach `docs/`. Die Pages-Quelle muss bei Einführung dieses ADRs von Branch-Deployment auf den GitHub-Actions-Deploy umgestellt werden.
- Der initiale lokale Abnahme-Modus ist `CONTENT_MIGRATION_STATUS=cache_only`. Die Konfiguration dokumentiert die Quellenwahl, implementiert aber selbst weder den Cache-Loader noch den Storyblok-Delivery-Loader; diese bleiben notwendiger Bestandteil der Frontend-Integration.

## Quellen

Offizielle Dokumentation, abgerufen am 2026-11-05:

- [Astro: Project structure](https://docs.astro.build/en/basics/project-structure/) — Konventionen für `src/`, `public/`, Seiten, Komponenten und Layouts.
- [Astro: Content collections](https://docs.astro.build/en/guides/content-collections/) — typisierte Collections, Schemas und Build-Time-Loader für strukturierte Inhalte.
- [Astro: Deploy to GitHub Pages](https://docs.astro.build/en/guides/deploy/github/) — statisches Deployment über GitHub Actions, `base` für Projektseiten und Pages-Konfiguration.
- [Astro: On-demand rendering](https://docs.astro.build/en/guides/on-demand-rendering/) — request-time-Rendering benötigt einen Server-Adapter und eine passende Laufzeit.
- [Storyblok: Astro quickstart](https://www.storyblok.com/docs/quickstarts/astro) — Astro-Integration, Delivery-API-Abfragen und Komponenten-Renderer.
- [Storyblok: Management API](https://www.storyblok.com/docs/api/management) — Zweck der Management-API, Authentifizierung, Rate-Limits, Pagination und Retry-Empfehlungen.
- [Storyblok: Components API](https://www.storyblok.com/docs/api/management/components) — Komponenten als wiederverwendbare, verschachtelbare Inhaltsbausteine und zugehöriger Management-Endpunkt.
