# ADR-0004: Storyblok-Content-Blöcke und Astro-Frontend-Komponenten

- **Status:** Vorgeschlagen
- **Datum:** 2026-11-06

## Kontext

ADR-0001 legt Astro als statisches Frontend und Storyblok als Quelle für redaktionelle Inhalte fest. ADR-0002 beschränkt die Migration auf WordPress-Beiträge und -Seiten. Es fehlt eine konkrete Vereinbarung, wie deren unterschiedliche redaktionelle Strukturen in Storyblok bearbeitet und im Frontend sicher, zugänglich und wiederverwendbar dargestellt werden.

Zur Vorbereitung wurden am 2026-11-06 öffentliche WordPress-REST-Daten und gerenderte Seiten stichprobenartig geprüft:

- Der Beitrag [Retrokompott 284 – Raptor](https://blog.retrokompott.de/retrokompott-284-raptor-18-10-2026/) enthält Einleitung, Download-Link, Mitwirkende, Laufzeit, Abschnitte und eine lange Liste von Zeitmarken im Format `HH:MM:SS`. Die Zeitmarken sind Teil der Shownotes, nicht eine verlässlich separate Player-API-Struktur.
- Der Beitrag [Retrokompott 285 – Maniac Part 1](https://blog.retrokompott.de/retrokompott-285-maniac-part-1-01-11-2026/) liefert im WordPress-Auszug Beschreibung und Episode-Kontext. Die [Podlove-Player-API-Antwort](https://blog.retrokompott.de/wp-json/podlove-web-player/shortcode/post/7528) enthält eine externe MP3-URL und ein Poster, aber `duration: null`, `chapters: []` und `transcripts: []`. Kapitel, Laufzeit und Poster sind daher optionale Daten und dürfen weder vorausgesetzt noch erfunden werden.
- Die Seite [Sendeplan](https://blog.retrokompott.de/sendeplan/) kombiniert ein Banner, Sendetermine, redaktionellen Text und Links auf Audiofeed, Unterstützung und Live-Angebote. Diese Inhalte stehen im Altbestand teils in nicht-semantischen `<pre>`-Blöcken.
- Die Seite [Live](https://blog.retrokompott.de/01-live/) enthält lange Anleitungen, Überschriften, Listen, externe Streaming-/Meeting-Links und Zugangsinformationen. Solche Zugangsdaten dürfen nicht ungeprüft in öffentliche Storys übernommen werden.
- WordPress-Inhalte enthalten klassische HTML-Tags, Inline-Stile, Shortcodes und externe Medien. Die REST-Antwort einer geprüften Seite enthielt außerdem unerwartetes, nicht zum Seiteninhalt passendes Markup. Rohes Legacy-HTML ist deshalb keine sichere Rendering-Schnittstelle.

Das Repository verwendet Astro und Tailwind CSS 4.1.13. Tailwind liefert Utility-Klassen und über `@theme` definierbare Tokens, aber keine fertigen redaktionellen UI-Komponenten. Ein zusätzliches UI-Kit ist für die benötigten Muster nicht erforderlich.

## Entscheidung

WordPress-Beiträge werden als `article`-Stories und WordPress-Seiten als `page`-Stories in Storyblok modelliert. Beide Content Types erhalten einen kontrollierten `body`-Blockbereich. Redakteure komponieren Inhalte aus einer begrenzten, dokumentierten Blockbibliothek; ein Astro-Renderer übersetzt nur bekannte Komponentennamen in lokale Frontend-Komponenten. Storyblok-Schemas und Frontend-Renderer werden gemeinsam versioniert und getestet.

Die Struktur erweitert die in ADR-0003 festgelegte `storyblok/components/`-Ablage. Die bereits vorhandene `page`-Definition erhält ein für Seiten zugelassenes `body`-Feld. Der Root-Typ `article` wird ergänzt. Es werden keine separaten Episode-, Show-, Termin-, Medien- oder Autoren-Stories aus WordPress angelegt. Eine Podcastfolge ist ein `article` mit optionalen Podcast-Feldern und einem Audio-Block.

Die Komponentenbibliothek gilt gleichermaßen für WP-importierte und direkt in Storyblok verfasste Inhalte. Die Herkunft eines Inhalts ändert nicht dessen Schema oder Frontend-Darstellung; die Zuständigkeit für Änderungen an WP-verwalteten Stories während des Mischbetriebs richtet sich nach ADR-0002.

### Content Types und redaktionelle Felder

| Storyblok-Typ | Felder und Zweck |
|---|---|
| `article` (Root) | `title`, `published_at`, `excerpt`, optional `article_kind` (z. B. `episode`), `podcast` (Boolean), `homepage` (Boolean), `stammtisch` (Boolean), `episode_number`, `duration`, `contributors`, `cover` und `body`. Die drei unabhängigen Veröffentlichungsflags steuern Podcast-RSS, Website/Artikellisten und Stammtischliste gemäß ADR-0005; sie können beliebig kombiniert werden. Die Story-Metadaten halten Quell-ID und ursprünglichen Permalink gemäß ADR-0002. `body` ist ein geordneter Blocks-Feld mit den unten aufgeführten redaktionellen Blöcken. |
| `page` (Root) | `title`, optional `intro`, `cover`, `body` und `seo`. `body` verwendet dieselbe Bibliothek; optionale Blockbeschränkungen verhindern, dass ungeeignete Inhalte (z. B. Kapitel ohne Player) angeboten werden. |

Alle drei Veröffentlichungsflags sind erforderliche explizite Boolean-Werte für jeden Artikel; es gibt keine implizite Ableitung oder stillschweigende Veröffentlichung. Bei Artikeln mit einer Podcast-MP3 muss `podcast=true` gesetzt werden, wenn diese MP3 im Podcast-RSS erscheinen soll. Ein Artikel ohne öffentliche Artikelseite kann `homepage=false` haben und trotzdem mit `podcast=true` im Feed stehen.

`title` wird als genau eine sichtbare H1 gerendert. Datum, Einleitung und Cover liegen als typisierte Felder statt als frei gesetztes HTML im Fließtext. Kapitel, Termine, Personen und andere wiederholbare Teilinhalte werden als geordnete Nestable Blocks modelliert.

### Redaktionelle Blockbibliothek

Die folgenden technischen Namen werden als Storyblok-Komponenten und lokale Astro-Renderer umgesetzt. Feldbeschreibungen im Storyblok-Editor erklären Format, Pflichtfeld und sichere Verwendung.

| Block | Storyblok-Felder / Redaktioneller Einsatz | Frontend-Darstellung |
|---|---|---|
| `rich_text` | `content` (Richtext). Absätze, Zwischenüberschriften, Listen, Zitate und Inline-Links für den normalen Textfluss. | Semantische Elemente (`p`, `h2`/`h3`, Listen, `blockquote`) in einer begrenzten Textspalte; konsistente Typografie und Abstände. Nur erlaubte Richtext-Knoten und -Marks rendern. |
| `image` | `image` (Asset, erforderlich), `alt` (Text, erforderlich), `caption` und `credit` (optional). Ein Bild pro Block. | Responsives `figure`/`img` mit intrinsischen Abmessungen, `figcaption` und Storyblok-CDN-Transformationen. Kein Herunterladen oder Zwischenspeichern der Bilddatei im Repository. |
| `audio_player` | `title`, `audio_url` (Text/URL), optional `mime_type`, `poster` (Asset), `duration`, optionaler Download-Link und `chapters` (Blocks, nur `chapter`). Für Podcastfolgen und andere redaktionell eingebettete Audios. | Native HTML5-`audio`-Steuerung plus optionale anklickbare Kapitelmarken und optionaler Download-Link; Audio bleibt auf dem externen Host. |
| `chapter` (nur in `audio_player.chapters`) | `timecode` (erforderlicher Text im Format `HH:MM:SS`) und `title` (erforderlicher Text). Die Reihenfolge im Editor ist die Abspielreihenfolge. | Zugängliche geordnete Liste. Kapitelaktion setzt `audio.currentTime` auf die Marke; sie startet Audio nicht automatisch. |
| `quote` | `text` (Richtext oder Text) und optionale `attribution`/`source` (Text bzw. Link). | Semantisches `blockquote` mit optionaler Quellenzeile. |
| `cta` | `label` (Text), `link` (Storyblok-Link-Feld) und `variant` (`primary`/`secondary`). Für „Helft uns“, Newsletter oder andere konkrete nächste Schritte. | Einheitlicher responsiver Link im Button-Stil; interne Story-Links und externe URLs werden nach Linktyp behandelt. |
| `schedule` | `title` und `items` (Blocks, nur `schedule_item`). Für den Sendeplan oder vergleichbare redaktionelle Terminübersichten. | Semantische Liste, Datum als `<time>`, Thema/Format und optionaler Link; kein starres `<pre>`-Textlayout. |
| `schedule_item` (nur in `schedule.items`) | `date` (Date/Datetime), `title` (Text), optional `format`, `contributors` und `link`. | Einzelner Termin in der Sendeplanliste. |
| `video_embed` | `provider` (Auswahl aus freigegebener Liste) und `video_id` (Text). Keine beliebige iframe-HTML- oder URL-Eingabe. | Responsiver Embed mit datensparsamer Vorschau bzw. bewusster Aktivierung; nur erlaubte Anbieter-Domains. |

Horizontale Trennungen, einfache Listen, Zwischenüberschriften und Inline-Links gehören in `rich_text`, nicht in einzelne Komponenten. Archivkarten, Seitencontainer, Abstände und Navigation sind Layout-/Frontend-Bausteine und keine redaktionell verschachtelbaren Storyblok-Blöcke. Das hält die Auswahl im Editor klein und vermeidet Präsentationsfelder wie CSS-Klassen oder freie Farben.

### MP3-Player und Kapitel

- Der Player nutzt das native `<audio controls preload="metadata">` mit einem oder mehreren `<source>`-Elementen. Damit bleiben Abspielen, Pause, Lautstärke und Tastaturbedienung bei Browser/Assistenztechnik statt in einem nachgebauten Player.
- Eine Kapitelmarke besteht aus Storyblok-Zeitcode und Titel. Der Build validiert `HH:MM:SS`, nicht-negative Zeiten und aufsteigende Reihenfolge; ungültige Einträge lassen die Content-Prüfung sichtbar fehlschlagen. Intern wird der Zeitcode in Sekunden umgerechnet.
- Kapitel erscheinen als normale Liste aus Buttons mit Zeitcode und Titel. Ein kleiner, lokal ausgelieferter Astro-Client-Enhancer setzt bei Aktivierung `currentTime`; er lädt keine Player-Bibliothek und startet die Wiedergabe nicht automatisch. Ohne Kapitel bleibt die native Audiosteuerung vollständig benutzbar.
- Laufzeit und Kapitel sind optional. Sie werden nur aus geprüften Quelldaten übernommen. Beim WordPress-Beispiel 284 sind Zeitmarken in Shownotes vorhanden; beim Beispiel 285 sind Dauer und Kapitel in der Player-API leer. Ein Migrationsschritt darf Zeitmarken aus Text nicht stillschweigend als validierte Kapitel behandeln.
- Die öffentliche Site ist HTTPS. Audio-URLs müssen deshalb per HTTPS erreichbar sein; unsichere HTTP-Quellen werden nicht als Mixed Content eingebettet. Eine fehlende HTTPS-Quelle muss vor Veröffentlichung am Host korrigiert oder die Quelle ersetzt werden. MP3-Dateien werden nicht in Git, den Content-Cache oder das statische Site-Artefakt kopiert.
- Optionaler Kapitel-Fortschritt (aktive Marke hervorheben) ist eine progressive Verbesserung. Er darf weder die nativen Controls noch die Bedienung der Kapitel-Liste ersetzen.

### Astro- und Tailwind-Struktur

```text
storyblok/
  components/
    article.json
    page.json
    rich_text.json
    image.json
    audio_player.json
    chapter.json
    quote.json
    cta.json
    schedule.json
    schedule_item.json
    video_embed.json
src/
  components/
    storyblok/
      StoryblokRenderer.astro
      blocks/
        RichText.astro
        ImageBlock.astro
        AudioPlayer.astro
        Quote.astro
        Cta.astro
        Schedule.astro
        VideoEmbed.astro
  layouts/
    Container.astro
    ArticleHeader.astro
  scripts/
    audio-chapters.ts
```

`StoryblokRenderer.astro` löst `blok.component` ausschließlich über eine explizite Registry auf. Unbekannte Komponenten werden im Build als Fehler gemeldet, nicht als HTML ausgegeben oder lautlos versteckt. Daten werden an typisierte Renderer übergeben; Richtext wird mit Storybloks Richtext-Renderer oder einem äquivalenten AST-Renderer zu erlaubten HTML-Elementen umgesetzt. Kein `set:html` für WordPress-HTML oder beliebige CMS-Felder.

Tailwind-Utilities gestalten semantische Elemente responsiv und mit sichtbaren Fokuszuständen. `@theme` in `global.css` definiert bei der Umsetzung wenige semantische Tokens (Text, Oberfläche, Akzent, Rand und Fokus); Komponenten verwenden diese Tokens statt redaktioneller Farb-/Spacing-Eingaben. CMS-Richtext erhält eine gemeinsame, gekapselte Typografie-Regel. Ein UI-Kit und ein zusätzliches Tailwind-Plugin werden zunächst nicht eingeführt.

### Inhalts- und Sicherheitsgrenzen

- WordPress-HTML, Inline-Styles, Skripte und Shortcodes werden nicht direkt gerendert. Die Migration überführt nur geprüfte Inhalte in Richtext und die oben definierten Blöcke; nicht unterstütztes oder unerwartetes Markup wird im Migrationsbericht zur manuellen Prüfung markiert.
- Die Quellseite „Live“ enthält Zugangsinformationen. Sie werden vor der Migration redaktionell geprüft und entfernt, sofern sie nicht ausdrücklich weiterhin veröffentlicht werden sollen. Es gibt keine Storyblok-Felder für Passwörter oder private Zugangsdaten.
- Externe Links erlauben nur die benötigten Protokolle (HTTPS sowie bewusst freigegebene `mailto:`-Links). Für neue Tabs werden `rel="noopener noreferrer"` und ein erkennbarer Linktext gesetzt. Video-Embeds verwenden eine feste Provider-Allowlist; Redakteure können kein beliebiges HTML/iframe einfügen.
- Asset- und Audio-Binärdaten bleiben außerhalb des lokalen Repositories; angezeigt werden URL/Asset-Referenzen mit validierten Feldern.

## Konsequenzen

- Redakteure erhalten für die wiederkehrenden WordPress-Muster Text, Bild, Audio/Kapitel, Zitat, CTA, Sendeplan und Video-Embed als klar benannte, kombinierbare Blöcke.
- Ein einzelner Astro-Renderer und einheitliche Blockkomponenten halten Darstellung, Accessibility, Linkbehandlung und Responsive-Verhalten konsistent. Die Inhaltsstruktur bleibt unabhängig von der konkreten Seitenroute.
- Der Player benötigt ein kleines clientseitiges Script nur für Kapitel-Sprungmarken. Native Audiofunktionen bleiben auch ohne Kapitel verfügbar; es werden keine MP3-Dateien oder Audio-Player-Bibliotheken eingebunden.
- Legacy-Inhalte müssen redaktionell bereinigt und semantisch gemappt werden. Ein verlustfreier Import des alten HTML-Layouts ist nicht Ziel.
- Die Stichprobe belegt eine Kapitel-Liste und einen Player ohne Kapitel, aber keine vollständige Typologie aller WordPress-Inhalte. Blockbibliothek und Allowed-Components-Listen werden nach einem repräsentativen Pilot mit Artikeln und Seiten bestätigt; neue Blöcke benötigen einen konkreten redaktionellen Anwendungsfall.
- Eine Storyblok-Schemaänderung ist erst vollständig, wenn Schema-JSON, Astro-Renderer, Inhaltsvalidierung und mindestens ein repräsentativer Testfall gemeinsam angepasst sind.

## Quellen

Untersuchte WordPress-Seiten und API-Antworten, abgerufen am 2026-11-06:

- [WordPress: Retrokompott 284](https://blog.retrokompott.de/retrokompott-284-raptor-18-10-2026/) — Shownotes, externe MP3-Quelle, Laufzeit und Zeitmarken.
- [WordPress: Retrokompott 285](https://blog.retrokompott.de/retrokompott-285-maniac-part-1-01-11-2026/) und [Podlove-Player-API](https://blog.retrokompott.de/wp-json/podlove-web-player/shortcode/post/7528) — Player mit externer MP3-Quelle, Poster und ohne gelieferte Laufzeit/Kapitel.
- [WordPress: Sendeplan](https://blog.retrokompott.de/sendeplan/) — Banner, Sendetermine, Links und CTA-Muster.
- [WordPress: Live-Informationen](https://blog.retrokompott.de/01-live/) — lange Anleitungen, externe Video-/Meeting-Links und Zugangsinformationen.

Offizielle Dokumentation:

- [Storyblok: Blocks](https://www.storyblok.com/docs/concepts/blocks) — Content-Type-, Nestable- und Universal-Blöcke sowie Organisation der Blockbibliothek.
- [Storyblok: Fields](https://www.storyblok.com/docs/concepts/fields) — Storyblok-Feldtypen, insbesondere Blocks-, Asset-, Date-, Link- und Richtext-Felder.
- [Storyblok: Astro quickstart](https://www.storyblok.com/docs/quickstarts/astro) — Rendering von Storyblok-Komponenten im Astro-Frontend.
- [Astro: Images](https://docs.astro.build/en/guides/images/) — Astro `Image`/`Picture` und externe CMS-/CDN-Bilder.
- [Tailwind CSS: Theme variables](https://tailwindcss.com/docs/theme) — Design-Tokens über `@theme` und zugehörige Utility-Klassen.
- [Tailwind CSS: Hover, focus, and other states](https://tailwindcss.com/docs/hover-focus-and-other-states) — Fokus- und Zustandsvarianten für interaktive Komponenten.
- [MDN: `<audio>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/audio) und [HTMLMediaElement.currentTime](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/currentTime) — native Audiosteuerung und Sprung zu einer Medienposition.
- [ADR-0001](./0001-astro-storyblok-static-pipeline.md), [ADR-0002](./0002-wordpress-to-storyblok-migration.md) und [ADR-0003](./0003-storyblok-repository-structure.md) — Frontend-/Migrationsarchitektur und versionierte Schemaablage.
