# Migration und Deployment

Diese Anleitung fasst den geplanten Weg von WordPress zu Storyblok und Astro zusammen. Die [ADRs](./adr/) enthalten die technischen Details und Entscheidungen.

> **Stand:** Die Storyblok-Schema-Prüfung und das inkrementelle Schema-Deployment sind angelegt. WordPress-Importer, Cache-/Content-Loader, Seiten- und RSS-Generator sowie R2-Asset-Transfer sind noch geplant und nicht implementiert. Die Schritte unten beschreiben den Zielablauf, keine bereits ausführbare End-to-End-Migration.

## Überblick

```text
WordPress Posts/Pages ── inkrementeller Import ──> Storyblok ──> Website-Deploy
        │                                      ↑
        ├── Cache + Asset-Inventar             └── native Storyblok-Inhalte
        └── Podcast-RSS-Metadaten

Nach Content-Abschluss und erstem Deploy:
Asset-Inventar ── freigegebene öffentliche MP3s ──> Cloudflare R2 ──> URL-Update
                                                                       │
                                                               finaler Deploy/RSS
```

## Während des Mischbetriebs

- **WordPress** bleibt Quelle für WordPress-verwaltete Beiträge und Seiten. Der Import übernimmt nur Änderungen seit dem letzten Checkpoint und aktualisiert ausschließlich die zugeordneten WP-Stories.
- **Storyblok** ist Quelle für neue, dort redaktionell angelegte Inhalte. Der WP-Importer darf solche Stories nicht überschreiben.
- **Lokaler Cache** unter `migration-cache/wordpress/` hält normalisierte Posts/Pages, Checkpoints, RSS-Metadaten und `assets/manifest.json`. Er enthält keine MP3- oder sonstigen Asset-Binärdateien.
- **Lokal bauen:** zuerst `CONTENT_MIGRATION_STATUS=cache_only` (nur Cache); nach lokaler Abnahme `in_progress` (Cache für WP-Inhalte plus Storyblok für native Stories); nach dem finalen Content-Abgleich `complete` (alle Inhalte aus Storyblok).
- **Podcast-Veröffentlichung:** Die drei unabhängigen Story-Felder steuern die Ausgaben:
  - `podcast=true`: in den öffentlichen Podcast-RSS; benötigt eine freigegebene öffentliche MP3.
  - `homepage=true`: öffentliche Artikelseite, Homepage- und allgemeine Artikellisten.
  - `stammtisch=true`: Stammtischliste.
  Die Flags können beliebig kombiniert werden. Patreon-Extras bleiben privat und außerhalb des öffentlichen Feeds.

## Geplanter Ablauf

1. **WordPress exportieren und Cache aufbauen.** `pnpm wordpress:export` liest veröffentlichte Beiträge und Seiten vollständig paginiert aus, liest den Podcast-RSS und inventarisiert referenzierte Assets als Metadaten. Nicht zuordenbare Stammtisch-Einträge werden als Podcast-Artikel mit `podcast=true`, `homepage=false` und `stammtisch=false` unter `podcast-articles/` abgelegt: Podcast-RSS ja, Website nein. Cachekompott, die 18 explizit ausgeschlossenen ältesten Feed-Einträge und 8 weitere vom Nutzer festgelegte Feed-Einträge werden nicht als Artikel importiert; sie bleiben mit Ausschlussgrund im RSS-Snapshot. Keine MP3-/Bild-Binärdateien herunterladen. Weitere Aufrufe exportieren WordPress-Deltas ab dem Cache-Checkpoint; `pnpm wordpress:export -- --full` führt eine vollständige Reconciliation aus. Der Export legt `posts/<id>.json`, `pages/<id>.json`, `podcast-articles/<feed-id>.json`, `podcast-feed.json`, `assets/manifest.json` und `manifest.json` unter `migration-cache/wordpress/` ab. `--dry-run` prüft Quellen und Zuordnungen ohne Cache-Dateien zu schreiben.
2. **Website zunächst nur aus dem Cache lokal erstellen und testen.** `CONTENT_MIGRATION_STATUS=cache_only` verwenden. Astro-Website mit `pnpm dev` im Browser prüfen und den statischen Build mit `pnpm build` ausführen. Artikel, Seiten, URLs und Veröffentlichungsflags abnehmen. In dieser Phase keine Inhalte aus Storyblok beziehen. Cache-/Content-Loader sind noch nicht implementiert; bis dahin ist dieser Testschritt blockiert.
3. **Storyblok erst nach lokaler Abnahme starten.** Komponenten und Content-Schemas versionieren, mit `pnpm storyblok:check` validieren und zunächst in einem Test-Space deployen. Management-API-Aufrufe benötigen `STORYBLOK_SPACE_ID` und `STORYBLOK_MANAGEMENT_TOKEN`; Änderungen vor dem Schreiben mit `pnpm storyblok:deploy -- --dry-run` prüfen.
4. **Pilot und inkrementelle Migration.** Nach Freigabe des lokalen Cache-Stands WordPress-Inhalte schrittweise in Storyblok übernehmen. Hashes vermeiden unnötige Updates; Checkpoints erst nach erfolgreichem Lauf fortschreiben. Slug-Konflikte, unklare Asset-Freigaben und nicht zugeordnete Feed-Einträge ausdrücklich klären.
5. **Mischbetrieb betreiben.** `CONTENT_MIGRATION_STATUS=in_progress`: WP-Inhalte kommen aus dem Cache, native Storyblok-Inhalte aus Storyblok. WordPress-Änderung → Import → lokal prüfen → Website-Build/Deploy. Storyblok-Publish → Website-Build/Deploy. Regelmäßig Fehler, Cache-Änderungen, Ownership und Links reviewen.
6. **Content-Migration abschließen.** Letzten Delta-Import und Abgleich durchführen, Ownership-Wechsel dokumentieren, `CONTENT_MIGRATION_STATUS=complete` setzen und nach erneutem lokalem Test die Website mit weiterhin gültigen PodcastGen-Audio-URLs deployen.
7. **Öffentliche MP3s zuletzt migrieren.** Asset-Inventar prüfen, nur explizit öffentliche MP3s auswählen, Dry Run und R2-Upload ausführen. Uploads wiederaufnehmbar übertragen und Größe, Integrität, HTTPS, `HEAD` und Byte-Range-Auslieferung prüfen. Unbekannte/private Dateien nicht hochladen.
8. **URLs umstellen und final deployen.** Nur verifizierte R2-URLs in Storyblok eintragen. RSS-GUIDs erhalten; Player und RSS sollen dieselbe URL nutzen. Zuerst lokal testen, dann RSS/Website validieren und erneut deployen. PodcastGen-Dateien erst nach erfolgreicher Prüfung und geplanter Redirect-/Übergangsfrist stilllegen.

Der aktuelle Umsetzungsstand je Phase steht in [status.md](./status.md). Änderungen an der Reihenfolge oder neue Abnahmen dort festhalten.

## Lokale Zugangsdaten

`.env` ist lokal und wird nicht versioniert. Die Datei ist in `.gitignore` ausgeschlossen. Sie kann, wenn die jeweiligen Tools implementiert sind, folgende Variablen enthalten:

```dotenv
CONTENT_MIGRATION_STATUS=cache_only
STORYBLOK_SPACE_ID=
STORYBLOK_MANAGEMENT_TOKEN=
CLOUDFLARE_R2_ACCOUNT_ID=
CLOUDFLARE_R2_BUCKET=
CLOUDFLARE_R2_ACCESS_KEY_ID=
CLOUDFLARE_R2_SECRET_ACCESS_KEY=
CLOUDFLARE_R2_PUBLIC_BASE_URL=
```

Storyblok-Management-Token und R2-Schlüssel sind Secrets: nur dem nötigen lokalen Prozess bereitstellen, nicht ins Asset-Manifest, in Storyblok-Inhalte, Logs, CI-Artefakte oder Browser-Code schreiben. Der normale Website-Build benötigt keine Schreib-Credentials. Der bestehende Node-Deploy-Befehl liest Umgebungsvariablen; `.env` wird von diesem Skript derzeit nicht automatisch geladen, daher müssen Variablen für den Aufruf explizit in die Prozessumgebung gelangen.

## Zugehörige Entscheidungen

- [ADR-0001: Build- und Deployment-Pipeline](./adr/0001-astro-storyblok-static-pipeline.md)
- [ADR-0002: WordPress-Migration, Cache und Asset-Inventar](./adr/0002-wordpress-to-storyblok-migration.md)
- [ADR-0003: Storyblok-Schemas und Struktur-Deployment](./adr/0003-storyblok-repository-structure.md)
- [ADR-0004: Artikel, Komponenten und Audio-Player](./adr/0004-storyblok-frontend-components.md)
- [ADR-0005: Generierte Übersichten und RSS](./adr/0005-generated-article-views-and-podcast-feed.md)
- [ADR-0006: Langfristige Speicherung öffentlicher Audios](./adr/0006-long-term-podcast-audio-storage.md)
- [ADR-0007: Abschließender MP3-Transfer nach Cloudflare R2](./adr/0007-final-mp3-migration-to-cloudflare-r2.md)
