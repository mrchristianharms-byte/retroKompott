# ADR-0003: Storyblok-Struktur und inkrementelles Deployment aus dem Repository

- **Status:** Vorgeschlagen; Skript-Grundlage implementiert
- **Datum:** 2026-11-06

## Kontext

ADR-0001 sieht versionierte Storyblok-Komponenten und ein idempotentes Management-API-Deployment vor, legt aber weder das Dateiformat noch die Zuordnung von Repository-Pfaden zu Storyblok-URLs fest. ADR-0002 ergänzt ein vorläufiges Inhaltsmodell für die WordPress-Migration. Für eine reproduzierbare Migration und spätere Schemaänderungen müssen Komponenten, Story-Slugs und gegebenenfalls technisch verwaltete Stories im Repository auffindbar und validierbar sein.

Die Management API ist eine Schreib- und Verwaltungs-API; für den Website-Build bleibt die Content Delivery API zuständig. Redaktionsinhalte dürfen nicht versehentlich durch eine Struktur-Synchronisation überschrieben oder veröffentlicht werden. Storyblok begrenzt die Management API je nach Tarif auf 3 oder 6 Requests pro Sekunde und paginiert Listen.

## Entscheidung

Die Storyblok-Definitionen werden im Root-Verzeichnis `storyblok/` als lesbares JSON versioniert. Ein eigenständiges Node-Skript ohne zusätzliche Abhängigkeit vergleicht diese Definitionen mit dem Space und erstellt oder aktualisiert nur abweichende Komponenten und deklarierte Stories. Der Sync löscht keine API-Ressourcen.

```text
storyblok/
  components/                  # Eine JSON-Datei je Komponenten-Schema
    page.json
  stories/                     # Optionale, explizit repo-verwaltete Story-Inhalte
    pages/
      home.json                # Dateipfad = full_slug "pages/home"
scripts/
  storyblok/
    deploy.mjs                 # Validierung, Dry-Run und inkrementeller Sync
```

### Komponenten, Inhalt und URL-Konvention

- Der Dateiname einer Komponenten-Definition ohne `.json` entspricht ihrem technischen `name`; beispielsweise `components/page.json` definiert die Root-Komponente `page`.
- Ein Story-Dateipfad unter `storyblok/stories/` ist der gewünschte Storyblok-`full_slug`. Verzeichnisse werden bei Bedarf als Storyblok-Ordner angelegt. Der letzte Pfadteil ist der `slug`; der `name` und das `content`-Objekt stehen in der JSON-Datei. Nested Blocks müssen ihre Komponentenkennung und `_uid` enthalten.
- Beispielsweise definiert `storyblok/stories/pages/home.json` mit `{"name":"Startseite","content":{"component":"page","body":[]}}` die Story-URL `pages/home`. Der Pfad ist der Slug-Vertrag; tatsächliche Redirects und Astro-Routen bleiben separate, zu prüfende Frontend-/Hosting-Aufgaben.
- Neue Storys werden standardmäßig als Entwurf angelegt. Erst `--publish` veröffentlicht Änderungen. Es gibt keinen impliziten Publish und keine automatische Löschung. Ein umbenannter oder verschobener Dateipfad erzeugt zunächst einen neuen Slug; alte URLs und Stories werden nicht stillschweigend entfernt. URL-Änderungen brauchen deshalb einen geprüften Redirect-/Migrationsschritt.
- `storyblok/stories/` ist ausschließlich für Inhalte gedacht, deren Datenquelle bewusst das Repository ist (zum Beispiel technische Start-/Konfigurations-Stories oder kontrollierte Migrationen). Redaktionell im Storyblok-Editor gepflegte Inhalte werden nicht in diese Dateien kopiert und damit nicht überschrieben; ihre Laufzeitdaten kommen weiterhin über den Content-Fetch aus ADR-0001.
- Komponentenschemas und Story-Inhalte müssen zusammen mit den Astro-Renderern und Routen weiterentwickelt werden. Ein erfolgreicher Management-API-Aufruf garantiert weder Frontend-Unterstützung noch die Erhaltung alter URLs.

### Synchronisation und Betrieb

- `pnpm storyblok:check` validiert die lokalen JSON-Dateien und Komponentenreferenzen offline.
- `pnpm storyblok:deploy -- --dry-run` vergleicht den lokalen Sollzustand mit dem Space, ohne Schreibzugriffe vorzunehmen. Der normale Deploy schreibt nur erforderliche Änderungen; Storys bleiben Entwürfe, außer bei explizitem `--publish`.
- Der Space wird über `STORYBLOK_SPACE_ID`, das persönliche Management-API-Token über `STORYBLOK_MANAGEMENT_TOKEN` angegeben. Tokens werden nur zur Laufzeit als Umgebungsvariablen bereitgestellt, nicht versioniert oder in den Browser-Build übernommen. `STORYBLOK_MANAGEMENT_API_URL` kann für einen anderen API-Standort gesetzt werden.
- Der Sync lädt Komponenten und Stories vollständig mit Pagination, verarbeitet Änderungen sequenziell, wartet zur Einhaltung des Starter-Limits zwischen Requests und wiederholt begrenzt bei `429`/`5xx` mit Backoff. Andere HTTP-Fehler brechen mit sichtbarer Fehlermeldung ab.
- Nach einem erfolgreichen Dry-Run und Test-Space-Pilot kann das Skript über einen separaten, geschützten GitHub-Actions-Workflow aufgerufen werden. Der Workflow erhält ausschließlich das Management-Token; es ist nicht Teil des Site-Builds. Ein automatischer Produktionslauf wird erst nach Bestätigung von Space, Definitionen und Migrations-/Redirect-Strategie eingerichtet.

## Konsequenzen

- Komponentenschemas und deklarierte Inhalte sind reviewbar, diffbar und aus einem frischen Space reproduzierbar. API-Lese- und Schreibzugriffe sind inkrementell; unveränderte Ressourcen werden nicht aktualisiert.
- Dateien unter `storyblok/stories/` definieren den Sollzustand ihres Inhalts. Das Verzeichnis darf daher keine redaktionell im CMS gepflegten Stories enthalten. Bestehende editor-gepflegte Inhalte werden nicht automatisch importiert oder übernommen.
- Strukturänderungen an Komponenten wirken sich auf vorhandene Stories aus und müssen im Test-Space sowie mit dem Astro-Renderer geprüft werden.
- Slug-Umbenennungen erfordern eine explizite URL-Abnahme. Alte Stories werden aus Sicherheitsgründen nicht automatisch gelöscht oder umgeleitet.
- Das Skript kann ohne echtes Space-Token nur die lokale Definition validieren. Die Management-API-Kompatibilität und Storyblok-spezifische Editor-/Routenwirkung müssen nach Einrichtung eines Test-Spaces praktisch abgenommen werden.

## Quellen

Offizielle Dokumentation, geprüft am 2026-11-06:

- [Storyblok: Management API](https://www.storyblok.com/docs/api/management) — REST-API, Authentifizierung, regionale Basis-URLs, Tarif-Limits, Pagination und Backoff-Empfehlungen.
- [Storyblok: Components API](https://www.storyblok.com/docs/api/management/components) — Komponenten als eigenständige, wiederverwendbare und verschachtelbare Schema-Bausteine.
- [Storyblok: Create a component](https://www.storyblok.com/docs/api/management/components/create-a-component) und [Update a component](https://www.storyblok.com/docs/api/management/components/update-a-component) — Management-Endpunkte und Schema-Objekte.
- [Storyblok: Create a story](https://www.storyblok.com/docs/api/management/stories/create-a-story) — Story-Content-Format und Draft als Standard.
- [Storyblok: Update a story](https://www.storyblok.com/docs/api/management/stories/update-a-story) und [Story object](https://www.storyblok.com/docs/api/management/stories/the-story-object) — Story-Updates, `parent_id`, Ordner, `full_slug` und Content-Struktur.
- [Storyblok: Retrieve multiple stories](https://www.storyblok.com/docs/api/management/stories/retrieve-multiple-stories) — Filter, `full_slug`-Abfrage und Pagination für den Soll-Ist-Abgleich.
- [ADR-0001](./0001-astro-storyblok-static-pipeline.md) — Zuständigkeit von Management API, Content Delivery API und statischem Frontend.
- [ADR-0002](./0002-wordpress-to-storyblok-migration.md) — vorläufiges Zielmodell und Migrationsanforderungen.
