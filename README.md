# RetroKompott

Ein schlanker, statischer Astro-Auftritt mit Tailwind CSS.

## Entwicklung

```sh
pnpm install
pnpm dev
```

## Build für GitHub Pages

```sh
pnpm build
```

Die statischen Dateien werden nach `docs/` geschrieben. In den Repository-Einstellungen unter **Settings → Pages** als Quelle den Branch `main` und den Ordner `/docs` auswählen. Die Projektseiten-Basis ist auf `/retroKompott/` gesetzt.

## Storyblok-Struktur deployen

Komponenten liegen als JSON unter `storyblok/components/`. Deklarierte, vom Repository verwaltete Stories liegen unter `storyblok/stories/`; ihr relativer Dateipfad bestimmt den Storyblok-`full_slug`. Editor-gepflegte Inhalte gehören nicht in dieses Verzeichnis.

```sh
pnpm storyblok:check
STORYBLOK_SPACE_ID=123 STORYBLOK_MANAGEMENT_TOKEN=... pnpm storyblok:deploy -- --dry-run
STORYBLOK_SPACE_ID=123 STORYBLOK_MANAGEMENT_TOKEN=... pnpm storyblok:deploy
```

Der Deploy aktualisiert Komponenten und Stories inkrementell, legt Stories standardmäßig als Entwürfe an und löscht keine Ressourcen. Veröffentlichungen erfordern das explizite `--publish`. Siehe [ADR-0003](./doc/adr/0003-storyblok-repository-structure.md) für Struktur, URL-Konventionen und Betrieb.

## Lokale Inhalte während der Migration

Der übergreifende Ablauf ist in der [Migrations- und Deployment-Anleitung](./doc/migration-workflow.md) zusammengefasst.
Der aktuelle Phasen- und Implementierungsstand steht in [doc/status.md](./doc/status.md).

### WordPress-Cache exportieren

Der Export liest veröffentlichte WordPress-Beiträge und Seiten, den öffentlichen Podcast-RSS sowie Metadaten zu referenzierten Medien. Er lädt keine Bild-, Audio- oder sonstigen Binärdateien herunter. Beim ersten Lauf wird der vollständige Cache unter `migration-cache/wordpress/` aufgebaut; weitere Läufe fragen geänderte WordPress-Datensätze seit dem gespeicherten Checkpoint ab und aktualisieren den RSS-/Asset-Metadatenstand.

```sh
pnpm wordpress:export
pnpm wordpress:export -- --dry-run
pnpm wordpress:export -- --full
```

`--full` führt eine vollständige Reconciliation aus und entfernt Cache-Datensätze, die nicht mehr in der veröffentlichten WordPress-Sammlung vorkommen. Die Standardquellen sind `https://blog.retrokompott.de/` und der öffentliche Podcast-RSS unter `http://www.medienpublikation.de/retrocompod/podcastgen/feed.xml`; sie können mit `--wordpress-url` und `--rss-url` überschrieben werden. Das Cache-Manifest und `assets/manifest.json` halten Zählungen, Checkpoints, Feed-Zuordnungen und Inventar-Ausnahmen fest. Nicht zuordenbare Stammtisch-Einträge werden unter `podcast-articles/` als Podcast-Artikel gecacht (`podcast=true`, `homepage=false`, `stammtisch=false`); sie erscheinen im RSS, aber nicht auf der Website. Cachekompott-Einträge, die 18 explizit ausgewählten ältesten Feed-Einträge sowie 8 weitere vom Nutzer festgelegte Feed-Einträge werden nicht in die Artikelintegration übernommen und im Feed-Snapshot mit Grund festgehalten. Alle Feed-Einträge sind damit klassifiziert; es verbleiben keine ungeklärten Einträge.

Der Export nutzt die öffentliche REST API und liest nur veröffentlichte Beiträge und Seiten. Delta-Abfragen verwenden `modified_after` mit einem zweiminütigen Überlappungsfenster; Änderungen, die Inhalte aus der veröffentlichten Sammlung entfernen (z. B. Löschen oder Zurückstufen), werden erst bei einer vollständigen `--full`-Reconciliation erkannt. Nicht veröffentlichte Inhalte werden nicht in den Website-Cache exportiert.

Der lokale Migrationsstatus steht in `.env`:

```dotenv
CONTENT_MIGRATION_STATUS=cache_only
```

`cache_only` bedeutet: ausschließlich den lokalen WordPress-Cache verwenden, um die Website vor dem Start der Storyblok-Migration lokal abzunehmen. Erst danach wird auf `in_progress` (Cache für WP-Inhalte plus Storyblok für native Inhalte) umgestellt. Nach Abschluss der Migration wird `complete` gesetzt; dann kommen alle Inhalte aus Storyblok. Die Statuswerte und Source-Regeln sind in [ADR-0001](./doc/adr/0001-astro-storyblok-static-pipeline.md) und [ADR-0002](./doc/adr/0002-wordpress-to-storyblok-migration.md) dokumentiert.

Die Auswahl ist Buildzeit-Konfiguration und wird nicht in Browser-Code ausgegeben. `.env` ist lokal und wird nicht versioniert. Lokale Import-/Deploy-Aufgaben benötigen außerdem `STORYBLOK_SPACE_ID` und `STORYBLOK_MANAGEMENT_TOKEN` gemäß [ADR-0003](./doc/adr/0003-storyblok-repository-structure.md); der spätere MP3-Transfer benötigt eigene lokale R2-Zugangsdaten gemäß [ADR-0007](./doc/adr/0007-final-mp3-migration-to-cloudflare-r2.md). Diese Secrets dürfen nicht in Storyblok-Inhalte, CI-Artefakte oder Browser-Code gelangen und sollen nur den Prozessen zur Verfügung stehen, die sie benötigen. Die Cache-/Storyblok-Loader sind noch nicht implementiert; bis dahin ändert diese Einstellung die derzeit statische Startseite nicht.
