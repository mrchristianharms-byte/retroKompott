# ADR-0005: Automatisch generierte Artikelübersichten und Podcast-RSS

- **Status:** Vorgeschlagen
- **Datum:** 2026-11-06

## Kontext

Einige WordPress-Seiten wiederholen Informationen, die bereits in Beiträgen oder dem Podcast-RSS vorkommen. Diese Listen werden aktuell parallel zu den Artikeln manuell gepflegt. Dadurch können Titel, Links, Episodennummern, Veröffentlichungsdaten, Interviewgäste und MP3-URLs auseinanderlaufen.

Die öffentlichen Seiten und Daten wurden am 2026-11-06 stichprobenartig geprüft:

1. [`/bisher/`](https://blog.retrokompott.de/bisher/) enthält eine chronologische Liste von Episoden mit Nummer, Datum, Dauer, Thema und Interviewgästen. Die Einträge verlinken auf die jeweiligen WordPress-Beiträge bzw. auf Zeitmarken innerhalb der Beiträge.
2. [`/die-interviews-als-mp3-download/`](https://blog.retrokompott.de/die-interviews-als-mp3-download/) enthält eine alphabetisch/chronologisch nummerierte Interviewliste mit Gast, Kurzbeschreibung, Aufnahme-/Ausstrahlungsdatum und einem Link zu einer Zeitmarke in der vollständigen Folge. Die Seite bietet außerdem einen Patreon-Hinweis. Das ist ein redaktioneller Index, kein öffentliches Verzeichnis geschützter MP3-Dateien.
3. [`/01-stammtisch/`](https://blog.retrokompott.de/01-stammtisch/) enthält Stammtischfolgen, frei verfügbare Previews, Verweise auf Unterstützer-Vollversionen sowie Live- und Teilnahmeinformationen. Die lange Episodenliste ist manuell in den Seitentext eingebettet.
4. Der bestehende öffentliche [Podcast-RSS-Feed](http://www.medienpublikation.de/retrocompod/podcastgen/feed.xml) enthält pro Episode bereits Titel, Beschreibung/Shownotes, MP3-`enclosure`, Byte-Länge, MIME-Typ, GUID, Dauer und Veröffentlichungszeit. Er enthält sowohl Hauptfolgen als auch Stammtisch-Previews. Für den geprüften Stammtisch 405 ist eine öffentliche Preview-Datei mit Patreon-/Steady-Hinweis enthalten; der Feed liefert nicht dadurch Zugriff auf die Unterstützer-Vollversion.

Die bestehenden Daten sind nicht vollständig normalisiert: Interviewgäste und Zeitmarken liegen teilweise als Links in Freitext, Stammtischlisten enthalten Ausnahmen und der Player-Endpunkt liefert nicht bei jeder Folge Kapitel oder Dauer. Außerdem gilt der lokale Migrationsmodus aus ADR-0001: WP-verwaltete Artikel kommen vorläufig aus dem Cache, native Storyblok-Inhalte parallel aus Storyblok. Assets werden gemäß ADR-0002 nicht lokal gecacht.

## Entscheidung

Übersichten werden nicht als manuell gepflegte Kopien der Artikellisten migriert. Stattdessen werden sie aus einem gemeinsamen, normalisierten Build-Datensatz generiert. Redaktionelle Einleitungen, Hinweise, rechtliche Texte und CTA bleiben eigenständiger Seiteninhalt; die wiederholbaren Episoden-/Interviewzeilen werden durch einen konfigurierten Listenblock ersetzt.

Die vorhandenen öffentlichen Pfade bleiben erhalten. Die drei HTML-Seiten werden als Storyblok-`page`-Stories mit einem `article_listing`-Block modelliert. Der Block speichert nur den geprüften Ansichtstyp und eine kleine Menge Darstellungsoptionen; er enthält keine manuelle Kopie der angezeigten Artikel oder Interviews. Der Astro-Renderer filtert und sortiert die verfügbaren Artikel beim statischen Build.

Die Veröffentlichung wird über drei unabhängige Boolean-Felder am `article`-Root gesteuert: `podcast`, `homepage` und `stammtisch`. Die Flags sind kombinierbar; keines wird automatisch aus einem anderen abgeleitet. Sie steuern die jeweilige Ausgabe unabhängig davon, ob die Story eine MP3 besitzt oder als redaktionelle Artikelseite erscheint:

- `podcast=true`: Episode in den gemeinsamen Podcast-RSS-Feed aufnehmen. Dafür sind eine gültige, öffentlich erreichbare Audio-Enclosure und die erforderlichen RSS-Metadaten erforderlich. Das Flag veröffentlicht für sich allein keine Artikelseite. Stammtisch-Previews können damit im RSS stehen; supporter-only Vollversionen dürfen nicht öffentlich syndiziert werden.
- `homepage=true`: öffentlichen Artikel unter seiner Route rendern und in den Website- sowie `/bisher/`-Artikellisten anzeigen.
- `stammtisch=true`: in der Stammtischliste unter `/01-stammtisch/` anzeigen. Das Flag schließt eine Aufnahme in Homepage oder RSS nicht ein; diese werden nur über die jeweils eigenen Flags aktiviert.

Ein Artikel mit nur `podcast=true` ist somit ein RSS-only-Eintrag ohne öffentliche Artikelseite und ohne Aufnahme in die beiden Website-Listen. Ein Artikel kann beispielsweise zugleich `podcast=true` und `stammtisch=true` haben, ohne auf der Startseite oder in der allgemeinen Artikelliste zu erscheinen. Alle drei Flags müssen als explizite Boolean-Werte vorhanden sein; fehlende Flags, fehlende/ungültige Pflichtdaten bei einem aktivierten Flag oder ein `podcast=true` ohne gültige öffentliche MP3 führen zu einem sichtbaren Validierungsfehler. Der Generator errät keine Flags aus Titel oder Kategorie; eine zugehörige MP3 allein ersetzt die explizite redaktionelle Freigabe über `podcast=true` nicht.

### Datenfluss und Quellen

1. Ein kanonischer Artikel-Datensatz wird aus dem lokalen WordPress-Migrationscache und nativen Storyblok-`article`-Stories zusammengesetzt, solange `CONTENT_MIGRATION_STATUS=in_progress` gilt. WP-originierte Stories werden in diesem lokalen Modus nicht ein zweites Mal aus Storyblok geladen. Nach `complete` kommen alle kanonischen Artikel aus Storyblok (ADR-0001/0002).
2. Der WordPress-Beitrag bleibt die Quelle für Artikelinhalt, Themen, Shownotes und gegebenenfalls Interview-Segmente. Der bestehende RSS-Feed wird während der Migration ergänzend und read-only für Audio-Enclosure-URL, Byte-Länge, MIME-Typ, GUID, Dauer und RSS-Publish-Zeit verwendet. MP3-/Bilddateien werden nicht heruntergeladen.
3. RSS-Einträge werden per stabiler GUID, MP3-Enclosure-URL, geprüftem Beitrags-Link und Dateiname der MP3 (auch wenn dieser in eingebettetem Player-JSON steht) einem kanonischen Artikel zugeordnet. Ein Treffer ergänzt Audio-/Feed-Metadaten desselben Artikels und erzeugt keine zweite Episode. Nicht zuordenbare Stammtisch-Feed-Einträge werden als RSS-only `article`-Datensätze im lokalen Cache `podcast-articles/<feed-id>.json` geführt: `podcast=true`, `homepage=false` und `stammtisch=false`. Sie erscheinen damit im Podcast-RSS, aber weder als Artikelseite noch in einer Website-Liste. Titel, Feed-Beschreibung, Veröffentlichungszeit und öffentliche Preview-Audio-Metadaten stammen aus dem Podcast-RSS; Audio-Binärdaten werden nicht heruntergeladen. Nicht zugeordnete Cachekompott-Feed-Einträge werden ausdrücklich nicht in die Artikelintegration übernommen und im Snapshot mit dem Ausschlussgrund `cachekompott_excluded_by_editorial_rule` dokumentiert. Zusätzlich werden die 18 explizit ausgewählten ältesten Feed-Einträge anhand ihrer stabilen Feed-IDs mit `explicit_oldest_feed_entries_exclusion` ausgeschlossen; neue Einträge am Ende des Feeds verschieben diese Ausschlussliste nicht. Acht weitere vom Nutzer festgelegte Feed-Einträge werden anhand stabiler IDs mit `explicit_selected_feed_item_exclusion` ausgeschlossen. Alle Ausschlüsse bleiben im Roh-Snapshot dokumentiert; andere ungeklärte Einträge müssen vor einer Importfreigabe redaktionell klassifiziert werden.
4. Der Feed wird beim Build als Metadaten gelesen; unvollständige Antworten oder ungültiges XML schlagen sichtbar fehl und dürfen keinen leeren/gedeckelten Ersatzbestand erzeugen. Falls Feed-Abruf und Seiten-Build getrennte CI-Jobs sind, wird der validierte Snapshot als kurzlebiges Artefakt zwischen ihnen übergeben.

### Gemeinsames Artikel- und Segmentmodell

Die Root-Komponente `article` erhält die strukturierten Felder, welche die Ansichten benötigen. Felder müssen bei der Umsetzung in ADR-0004 und ADR-0002 abgestimmt werden.

| Feld | Zweck |
|---|---|
| `podcast` | Erforderlicher Boolean. `true` veröffentlicht den Artikel im gemeinsamen Podcast-RSS-Feed; erfordert eine gültige öffentliche MP3-Enclosure und vollständige Pflichtmetadaten. |
| `homepage` | Erforderlicher Boolean. `true` rendert die öffentliche Artikelseite und nimmt sie in Homepage- und allgemeine Artikellisten auf. |
| `stammtisch` | Erforderlicher Boolean. `true` nimmt den Artikel in die Stammtischliste auf. |
| `episode_number`, `published_at`, `topic` | Nummer, Ausstrahlungsdatum und kurzes Thema für die bisherige-Ausgaben-Liste. |
| `audio_guid`, `audio_url`, `audio_length_bytes`, `audio_mime_type`, `duration` | Zuordnung und RSS-/Player-Felder. GUID bleibt stabil, auch wenn Dateiname oder CDN-URL wechseln. |
| `access` und `public_audio_url` | Explizite Sichtbarkeit (`public`, `public_preview`, `supporters`). Nur eine als öffentlich freigegebene Enclosure-URL darf in öffentlichen Playern und Feeds erscheinen. |
| `interviews[]` | Geordnete Interview-Segmente mit `guest_name`, optionaler `guest_description`, `timecode`, `recorded_at`, `released_at` und `access`. `timecode` verweist auf den Abschnitt im jeweiligen Artikel/Audio und wird für den Linkanker verwendet. |
| `notes` | Semantische Shownotes als Richtext/Blöcke, aus denen Listen und RSS-Beschreibungen erzeugt werden. Der Renderer gibt keine ungeprüften WordPress-HTML-Fragmente aus. |

Felder mit unbekanntem Wert bleiben leer; Titelparser oder fehlende Playerdaten werden nicht als gesicherte Quelle behandelt. Migrationsberichte weisen Artikel ohne Pflichtmetadaten für die jeweilige Ansicht aus.

### Generierte Ansichten

| Bestehender Pfad | Ansicht / Auswahlregel | Redaktionell gepflegter Anteil |
|---|---|---|
| Startseite | Podcast-/Artikelbereich zeigt veröffentlichte Artikel mit `homepage=true`, unabhängig vom Format und davon, ob der Artikel eine MP3 besitzt. | Überschrift, Teaserumfang und Layout. |
| `/bisher/` | `article_listing.view=archive`: veröffentlichte Artikel mit `homepage=true`, chronologisch absteigend oder gruppiert nach Jahren; Ausgabe von Nummer, Datum, Dauer, Thema und verknüpften Interviewgästen. Klick führt zum kanonischen Artikel. | Seitentitel, Einführung, optionale Jahres-/Formatüberschriften und ergänzende Hinweise. Die Episodenzeilen selbst sind vollständig generiert. |
| `/die-interviews-als-mp3-download/` | `article_listing.view=interviews`: nur veröffentlichte Interview-Segmente; Sortierung gemäß konfiguriertem Sortierschlüssel, standardmäßig Ausstrahlungsdatum und Segmentnummer. Name führt auf die Zeitmarke des Artikels. | Einleitung, redaktionell gepflegter Hinweis zu Patreon/Steady und Link zu den Unterstützerangeboten. Die Liste der Gäste wird aus `interviews[]` generiert. Keine direkte öffentliche MP3-URL für supporter-only Inhalte. |
| `/01-stammtisch/` | `article_listing.view=stammtisch`: veröffentlichte Artikel mit `stammtisch=true`, nach Episodennummer/-datum sortiert. Öffentliche Preview und Unterstützer-Vollversion werden als getrennte Verfügbarkeiten dargestellt. | Teilnahme-/Formatbeschreibung, Live-Anleitung und Unterstützer-Hinweise. Keine von Hand duplizierte Episodenliste. |

Die Listen sind deterministische Build-Ausgaben; Filter, Sortierung, Links und Zahlen werden in Tests gegen denselben normalisierten Datensatz geprüft. Eine Storyblok-Änderung an einem Listeneintrag erzeugt so nach dem regulären Build aktuelle Ansichten ohne manuelle Seitenkorrektur.

### Podcast-RSS-Ausgabe

Ein zusätzlicher statischer Astro-Endpoint (vorgeschlagen: `src/pages/feed.xml.ts`) kann einen gemeinsamen RSS-2.0-Feed aus demselben kanonischen Artikel-Datensatz generieren. Er enthält alle veröffentlichten Artikel mit `podcast=true`, unabhängig von `homepage` und `stammtisch`, sofern die Pflichtmetadaten und eine gültige öffentliche Enclosure vorliegen. So kann eine Story als Podcast-RSS-Item erscheinen, ohne dass eine öffentliche Artikelseite oder Listenaufnahme erzeugt wird. Für `homepage=true` verweist das RSS-Item auf die kanonische Artikelseite; bei RSS-only-Artikeln verweist `link` auf die Podcast-Website als Ganzes. Jedes Item enthält eine stabile GUID, Veröffentlichungsdatum, Beschreibung/Shownotes und `enclosure` mit Audio-URL, Byte-Länge und MIME-Typ aus validierten Artikel-/Feed-Metadaten.

Der neue Feed wird zunächst unter einem neuen, expliziten Pfad veröffentlicht und validiert. Der bestehende PodcastGen-Feed und dessen abonnierte URL bleiben unverändert, bis Eigentümerschaft, Feed-Inhalt und ein kontrollierter Redirect/Cutover inklusive Abonnenten-Kompatibilität ausdrücklich freigegeben sind. Niemals werden private/Unterstützer-URLs, Tokens oder nicht öffentliche Vollversionen in einen öffentlichen RSS-Feed geschrieben. Der Podcast-Feed ist eine Ausgabe aus Episoden, keine vierte manuell gepflegte Liste.

### Implementierungsstruktur

```text
src/
  lib/
    content/
      article-index.ts          # Cache + Storyblok normalisieren und deduplizieren
      derived-views.ts           # Archive/Interview/Stammtisch filtern und sortieren
      podcast-rss.ts             # RSS-XML aus validierten öffentlichen Episoden bauen
  components/
    storyblok/
      blocks/
        ArticleListing.astro     # definierte Ansicht anhand article_listing.view
  pages/
    feed.xml.ts                  # statischer RSS-Endpoint, nach Feed-Freigabe
```

`article_listing` erhält nur eine Allowlist bekannter Ansichtstypen, keine frei eingebbaren Querystrings, Feldnamen oder Codefragmente. Unbekannte Typen, doppelte GUIDs, Slug-Konflikte, ungültige Audio-URLs oder unvollständige Pflichtfelder führen zu einem sichtbaren Validierungsfehler. Alle öffentlichen Medien-URLs müssen HTTPS sein. HTML/XML-Inhalte werden korrekt escaped oder über geprüfte Richtext-Serialisierung ausgegeben.

## Konsequenzen

- Die WordPress-Seiten `/bisher/`, `/die-interviews-als-mp3-download/` und `/01-stammtisch/` sind fortan redaktionelle Hüllen um aus Artikeln/Feed-Metadaten generierte Listen. Titel, erklärender Text und CTAs bleiben bearbeitbar; Eintragsdaten werden nicht doppelt gepflegt.
- Die drei Flags sind die explizite Veröffentlichungssteuerung: `podcast` bestimmt ausschließlich RSS, `homepage` Artikelseite plus Homepage-/allgemeine Artikellisten und `stammtisch` die Stammtischliste. Sie sind unabhängig und dürfen kombiniert werden.
- Tests müssen mindestens die vier Fälle prüfen: nur `podcast` ergibt RSS-only; nur `homepage` ergibt Artikelseite und allgemeine Listen; nur `stammtisch` ergibt Stammtischliste; kombinierte Flags erscheinen genau in den jeweils aktivierten Ausgaben. `podcast=true` mit fehlender/nicht öffentlicher MP3 muss als Validierungsfehler auffallen.
- RSS-Daten sind ein temporärer ergänzender Quell-Snapshot, kein zweiter Medien- oder Artikelbestand. Feed-Einträge ohne zugeordneten Artikel müssen vor `CONTENT_MIGRATION_STATUS=complete` aufgelöst sein.
- Ein statisch generierter RSS-Feed erfordert einen neuen Build und kann die bestehende PodcastGen-Feed-URL nicht ohne separate Cutover-Entscheidung ersetzen.
- Patreon/Steady-Zahlungsschutz wird nicht durch statische Website-Logik nachgebildet. Der Generator veröffentlicht ausschließlich freigegebene öffentliche Informationen und öffentliche MP3-Previews.
- Die aktuelle WordPress-Stichprobe zeigt manuelle Freitextlisten und im RSS gemischte Hauptfolgen/Previews. Vor Umsetzung ist ein vollständiger Abgleich von GUIDs, WordPress-IDs, Episodennummern, Interviews, Audio-Varianten und Zugriffsstatus erforderlich.

## Quellen

Untersuchte Seiten und Feed, abgerufen am 2026-11-06:

- [Bisherige Ausgaben](https://blog.retrokompott.de/bisher/) — Hauptfolgen, Themen und Interview-Links.
- [Interviews als MP3-Download](https://blog.retrokompott.de/die-interviews-als-mp3-download/) — Interviewgäste, Kurzbeschreibungen, Daten und Ankerlinks.
- [Audio-Stammtisch](https://blog.retrokompott.de/01-stammtisch/) — Stammtischübersicht, öffentliche/unterstützergebundene Inhalte und Live-Hinweise.
- [PodcastGen RSS-Feed](http://www.medienpublikation.de/retrocompod/podcastgen/feed.xml) — Hauptfolge 285 und Stammtisch 405/404 als Preview-Beispiele mit `guid`, `enclosure`, Dauer, Datum und Shownotes.

Offizielle Dokumentation:

- [Astro: Endpoints](https://docs.astro.build/en/guides/endpoints/) — statische Endpoints können beim Build XML-/RSS-Dateien erzeugen.
- [Storyblok: Retrieve multiple stories](https://www.storyblok.com/docs/api/content-delivery/v2/stories/retrieve-multiple-stories) — veröffentlichte Stories per Content Type, Filter und Pagination abrufen.
- [Storyblok: Fields](https://www.storyblok.com/docs/concepts/fields) — typisierte Felder und Blocks zur Pflege von Artikeln und Listen-Konfiguration.
- [RSS 2.0 Specification](https://www.rssboard.org/rss-specification) — Channel-/Item-Struktur und Enclosures.
- [Apple Podcasts: RSS feed requirements](https://podcasters.apple.com/support/823-podcast-requirements) — öffentlich zugänglicher RSS 2.0 Podcastfeed, stabile GUID, erforderliche Enclosure-Felder und Datumsformat.
- [ADR-0001](./0001-astro-storyblok-static-pipeline.md), [ADR-0002](./0002-wordpress-to-storyblok-migration.md) und [ADR-0004](./0004-storyblok-frontend-components.md) — statischer Build, Migrations-Cache und Artikel-/Audio-Content-Modell.
