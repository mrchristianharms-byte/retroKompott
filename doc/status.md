# Migrationsstatus

Stand: 2026-11-06

## Aktuelle Phase

**Phase 1 – WordPress-Export und lokaler Cache: Offen.**

Die Reihenfolge ist bewusst: erst WordPress-Daten lokal sichern, dann die Website ausschließlich mit diesem Cache lokal testen, erst danach Storyblok als Content-Quelle und Migrationsziel einschalten. Die vorhandenen ADRs und das Storyblok-Schema-Deploy-Skript sind Planungs-/Grundlagenarbeit; sie bedeuten nicht, dass die Content-Migration bereits läuft.

## Aktueller Stand der lokalen Website

Der technische Check und Build laufen erfolgreich (`pnpm check`, `pnpm build`), aber der Build erzeugt derzeit nur `/index.html` aus der Platzhalter-Startseite. Das ist kein Nachweis für eine vollständige lokale Website. Es gibt noch keinen WordPress-Cache (`migration-cache/wordpress/`), keinen Cache-only Content-Loader und keine dynamischen Artikel-/Seitenrouten.

Die in ADR-0002 genannten Mengen (ca. 293 Posts, 38 Pages und 141 Media, Stand 2026-11-05) sind eine bisherige Bestandsaufnahme, kein verifiziertes vollständiges Exportinventar. Vor der Abnahme sind tatsächliche Exportzahlen und Ausnahmen zu erfassen.

## Plan bis zur Cache-only Website-Abnahme

1. **WordPress-Inventar und Export:** vollständige veröffentlichte Posts und Pages samt Permalinks, Status, Datums-/Änderungsdaten und benötigten Metadaten exportieren; Podcast-RSS zuordnen und Asset-Metadaten in `assets/manifest.json` erfassen. Binärdateien (insbesondere MP3s und Bilder) nicht in den Cache kopieren.
2. **Cache und Loader:** ein dokumentiertes, versioniertes Cache-Format samt wiederholbarem Export/Delta-Verhalten und Checkpoints festlegen. Einen Loader mit Schema-/Integritätsprüfung erstellen, der im Modus `cache_only` ausschließlich lokale Daten verwendet.
3. **URL- und Seiteninventar:** alle WordPress-URLs und Seitentypen klassifizieren; Eltern-/Slug-Beziehungen, Kollisionen, Weiterleitungen, leere Inhalte, Shortcodes und externe/plugin-abhängige Funktionen dokumentieren. Beabsichtigte Ausschlüsse und Ersatzverhalten festhalten.
4. **Routen und Darstellung:** Astro-Routen für die exportierten Artikel und Seiten aus den WordPress-Permalinks generieren. Artikel-/Seitentemplates sowie Renderer für die tatsächlich vorkommenden Inhalte und Medienreferenzen implementieren.
5. **Generierte Ansichten:** Startseite und die in ADR-0005 vorgesehenen Übersichten aus dem Cache erzeugen; Podcast-RSS nach den festgelegten Flags generieren. Die drei Publikationsflags bleiben unabhängig und kombinierbar.
6. **Abnahme:** Cache-only Build ohne Storyblok-Zugriff ausführen; erwartete und erzeugte veröffentlichte Routen vergleichen, Ausnahmen ausweisen, interne Links und Assets prüfen und die Seitentypen im Browser stichprobenartig abnehmen. Erst danach Phase 3 freigeben.

Storyblok-Integration, Storyblok-Import und R2-Transfer bleiben bis nach dieser lokalen Abnahme gesperrt. Die Website soll für diese Phase ohne Storyblok-Secrets und ohne Asset-Binärdateien im Repository baubar sein.

## Phasen und Status

| # | Phase | Status | Abnahmekriterium / nächster Schritt |
|---|---|---|---|
| 1 | WordPress-Posts/Pages exportieren; Podcast-RSS zuordnen; Asset-Metadaten inventarisieren | **Offen** | Wiederholbarer Export mit Checkpoints und `migration-cache/wordpress/`-Inhalt inklusive `assets/manifest.json`; keine Medien-Binärdateien im Cache. |
| 2 | Website aus lokalem Cache erstellen und testen | **Blockiert durch 1** | Vorhandener Build baut nur `/index.html` (Platzhalter), daher noch keine Cache-Website-Abnahme. Nach Phase 1: Loader, Artikel-/Seitenrouten, Renderer, Übersichten und RSS im `cache_only`-Modus ohne Storyblok-Zugriff prüfen; Routenbestand, Links und Seitentypen abnehmen. |
| 3 | Storyblok-Schemas vorbereiten und Test-Space deployen | **Gesperrt bis Abnahme von 2** | Lokalen Cache-Website-Stand freigeben, danach Schemas validieren und Test-Space-Dry-Run/Pilot abnehmen. Das vorhandene Schema-Deploy-Skript ist nur Grundlage. |
| 4 | WordPress-Inhalte inkrementell nach Storyblok migrieren | **Gesperrt bis 3** | Wiederholbare Deltas, Hashes/Checkpoints, Mapping, Slug-Konflikte und WP-Ownership geprüft. |
| 5 | Mischbetrieb und laufende lokale/öffentliche Builds | **Gesperrt bis 4** | `CONTENT_MIGRATION_STATUS=in_progress`: Cache für WP-Inhalte, Storyblok für native Inhalte; beide Publish-Pfade getestet. |
| 6 | Content-Cutover und erster erfolgreicher Storyblok-Deploy | **Gesperrt bis 5** | Finaler Delta-Import und Abgleich, Ownership-Wechsel dokumentiert, `CONTENT_MIGRATION_STATUS=complete`, Website mit bisherigen Audio-URLs deployed. |
| 7 | Öffentliche MP3s nach Cloudflare R2 übertragen | **Gesperrt bis 6** | Nur explizit öffentliche MP3s aus Asset-Inventar, lokaler R2-Zugriff, wiederaufnehmbarer Upload und erfolgreicher Integritäts-/Range-Test. Patreon-Dateien ausgeschlossen. |
| 8 | Story-/RSS-URLs umstellen und final deployen | **Gesperrt bis 7** | Verifizierte R2-URLs in Storyblok, RSS-GUIDs erhalten, Player/RSS und finale Website geprüft; PodcastGen erst nach Übergangsfreigabe ablösen. |

## Bereits vorhanden

- ADRs 0001–0007 beschreiben Build, Migration, Storyblok-Schemas, Audio-/RSS-Ausgaben und R2-Transfer.
- `pnpm storyblok:check` und ein inkrementelles Storyblok-Struktur-Deploy-Skript sind angelegt.
- `.env` ist in `.gitignore` ausgeschlossen. Sie ist lokal mit den Zugangsdaten zu befüllen, wenn ein entsprechender Import-/Deploy-/Transfer-Prozess umgesetzt und benötigt wird.

## Noch nicht implementiert

- WordPress-Export/Delta-Importer und lokaler Migrationscache samt Asset-Inventar.
- Cache-only Content-Loader, Permalink-Mapping, dynamische Astro-Routen und Renderer für migrierte Artikel/Seiten.
- Klassifikation und Abnahme der WordPress-Seitentypen, einschließlich Shortcodes und plugin-/extern-abhängiger Funktionen.
- Generierte Startseite/Übersichten und Podcast-RSS samt Routen-, Link- und Inhaltsabnahme.
- Content-Migration nach Storyblok und Cloudflare-R2-MP3-Transfer.

Statusänderungen werden in dieser Datei zusammen mit erledigter Abnahme und Nachweisen aktualisiert. Die technische Detailplanung steht in [migration-workflow.md](./migration-workflow.md); die Einzelentscheidungen stehen in [adr/](./adr/).
