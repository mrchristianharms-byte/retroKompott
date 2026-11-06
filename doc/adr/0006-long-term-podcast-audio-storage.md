# ADR-0006: Langfristige Speicherung und Auslieferung von Podcast-Audio

- **Status:** Vorgeschlagen
- **Datum:** 2026-11-06

## Kontext

Podcast-Episoden enthalten MP3-Dateien von teils ungefähr 400 MB. Die geprüften öffentlichen Podcast-RSS-Einträge verweisen derzeit auf Dateien unter dem PodcastGen-Medienpfad auf `medienpublikation.de`. WordPress- und Storyblok-Inhalte enthalten bzw. sollen künftig Audio-URLs und Metadaten enthalten; weder das Git-Repository noch der statische Astro-Build sind geeignete Speicherorte für diese großen Dateien.

Zusätzlich betreibt Retrokompott einen bezahlten Patreon-Kanal unter [Patreon / Retrokompott](https://www.patreon.com/c/retrokompott/posts). Dort werden zusätzliche MP3-Inhalte angeboten, die nicht Teil des öffentlichen Podcast-RSS-Angebots sind. Der Kanal soll als bezahlter Distributions- und Zugangsweg bestehen bleiben.

Die Website soll öffentliche Episoden künftig mit einem nativen Audio-Player wiedergeben und sie in den öffentlichen RSS-Feed aufnehmen können. Dafür werden stabile, öffentlich erreichbare HTTPS-URLs, zuverlässige Byte-Range-Auslieferung zum Springen/Wiedereinstieg sowie unveränderte RSS-GUIDs benötigt. Assets werden gemäß ADR-0002 nicht lokal im Content-Cache oder Repository gehalten.

## Entscheidung

Öffentliche Podcast-MP3s werden langfristig in Cloudflare R2 gespeichert und über eine kontrollierte öffentliche Domain/CDN ausgeliefert. Die Entscheidung für R2 und den abschließenden Bestands-Transfer ist in ADR-0007 konkretisiert. Bucket, öffentliche Domain und Zugangsdaten müssen vor dem Transfer eingerichtet und geprüft werden.

Der Object Storage ist die dauerhafte Dateiablage; das CDN liefert die Dateien an Website und Podcast-Clients aus. Veröffentlichte Audiodateien werden nicht in Git, GitHub-Pages-Artefakte, den WordPress-/Storyblok-Content-Cache oder den Storyblok Asset Manager kopiert. Storyblok und der Migrationscache speichern nur Metadaten und die öffentliche, stabile Auslieferungs-URL.

### Öffentliche Podcast-Dateien

- Für öffentliche Episoden wird eine eigene, kontrollierte Medienadresse verwendet, vorzugsweise eine Subdomain unter der eigenen Domain (beispielsweise `audio.retrokompott.de`). Die CDN-Origin-URL bzw. ein anbieterspezifischer Bucket-Pfad wird nicht in RSS oder Storyblok veröffentlicht.
- Die Ablage erhält einen stabilen, nicht aus dem Titel abgeleiteten Objektpfad, der auf eine Episode und eine Audio-Version verweist. Bereits veröffentlichte URLs werden nicht bei jeder neuen Kodierung ersetzt. Bei notwendigem Umzug werden die bisherigen URLs so lange wie möglich per HTTP-Redirect auf die neue URL weitergeleitet; RSS-GUIDs bleiben unverändert.
- Der öffentliche Abruf erfolgt ohne Anmeldung und ohne kurzlebige signierte URLs. Die Veröffentlichung eines Artikels mit `podcast=true` setzt ein öffentlich abrufbares Audioobjekt voraus. Schreibzugriff auf Storage bleibt auf einen eingeschränkten Upload-Prozess beschränkt; öffentliche Leser erhalten nur Lesezugriff.
- Vor Freigabe müssen HTTPS, korrekter `Content-Type` (`audio/mpeg`), `Content-Length`, HTTP-Range-Anfragen mit `206 Partial Content` und korrektem `Content-Range`, Caching-Verhalten sowie die Wiedergabe und das Springen in den unterstützten Browsern und Podcast-Clients geprüft werden. `HEAD`-Antworten sollen die verfügbaren Metadaten liefern.
- Pro freigegebener Datei werden mindestens Objektpfad, Byte-Größe, MIME-Typ, Prüfsumme (SHA-256), Upload-/Freigabestatus und ein Verweis auf die zugehörige Episode festgehalten. Die Prüfsumme dient Integritätsprüfung und Wiederherstellung, nicht als Ersatz für die stabile RSS-GUID.
- Die Quelldatei wird vor dem Upload geprüft. Ein Upload wird erst nach Größen-/Prüfsummenabgleich und einem erfolgreichen Range-/Playback-Test als veröffentlicht markiert. Erneute Uploads sind idempotent und überschreiben keine bereits publizierte Datei unbemerkt.
- Speicheranbieter und CDN müssen eine dokumentierte Sicherungs- und Wiederherstellungsstrategie unterstützen. Versionierung oder getrennte Sicherungskopien werden nach Kosten-/Risikoabwägung eingerichtet; ein CDN-Cache gilt nicht als Backup. Lebenszyklusregeln dürfen keine noch referenzierten Episoden löschen.

### Patreon und bezahlte MP3s

Patreon bleibt der separate, bezahlte Kanal für zusätzliche MP3-Inhalte und ist Quelle für Zugang, Zahlung und Veröffentlichung dieser Inhalte. Diese Dateien werden nicht in den öffentlichen Podcast-Storage gespiegelt, nicht in den öffentlichen RSS-Feed aufgenommen und nicht mit einer öffentlichen Audio-URL in Storyblok veröffentlicht. Insbesondere dürfen keine privaten oder kurzlebigen Patreon-Download-URLs in statischen Seiten, öffentlichen Storys, Build-Artefakten oder öffentlichen Logs landen.

Die Website kann redaktionelle Hinweise und einen Link zum Patreon-Angebot anzeigen. Eine spätere Verknüpfung muss auf die von Patreon vorgesehenen öffentlichen Seiten oder offiziellen Integrationen verweisen; sie implementiert keine eigene Umgehung des Patreon-Zugriffsschutzes. Eine gemeinsame Verwaltung von öffentlichen und bezahlten Audios in einem Speicher oder eine Synchronisation zwischen den Kanälen ist nicht Teil dieser Entscheidung.

### Website-, Storyblok- und RSS-Integration

- Ein `article` hält die fachlichen Episodenmetadaten und die Veröffentlichungsflags aus ADR-0004/0005. Der Audio-Player und der Podcast-RSS-Generator verwenden dieselbe freigegebene öffentliche Audio-URL und Audio-Version; es werden keine konkurrierenden URLs in separaten Feldern gepflegt.
- Für `podcast=true` müssen öffentliche Audio-URL, stabile GUID, Byte-Größe, MIME-Typ, Titel und Veröffentlichungsdatum vollständig und validiert sein. `homepage` und `stammtisch` bleiben unabhängig davon steuerbar. Ein RSS-only-Artikel (`podcast=true`, `homepage=false`) verlinkt auf die öffentliche Podcast-/Website-Adresse und stellt keine Artikelseite für die Audiodatei bereit.
- Eine spätere Migration von PodcastGen auf den neuen Speicher wird in Batches durchgeführt: Datei aus der autorisierten Quelle übertragen, Prüfsumme und Range-Auslieferung validieren, die Medien-URL im Content-Datensatz aktualisieren, RSS mit unveränderter GUID prüfen und erst danach den Altbestand umleiten oder stilllegen.
- Die bisherige PodcastGen-Datei bleibt verfügbar, bis die neue Datei und deren öffentliche URL nachweislich funktionieren. Der Wechsel wird nicht mit einer stillen Entfernung alter URLs gekoppelt; Redirects bzw. eine ausreichende Übergangsfrist und Feed-Client-Kompatibilität sind Teil der Freigabe.
- MP3-URLs und Storyblok-Felder werden so modelliert, dass der spätere Storage-Wechsel nicht die Frontend-Komponente ändert: Der `audio_player` erhält eine öffentliche HTTPS-URL, während Upload, Storage-Anbieter und CDN-Konfiguration außerhalb der statischen Website liegen.

## Nicht entschieden

- Ob alle historischen Dateien übernommen werden oder nur neue Episoden plus ausgewählte Backfills.
- Upload-Werkzeug und Berechtigungsablauf, einschließlich Redaktions- oder CI-Integration.
- Aufbewahrungs-/Backup-Zeitraum für Originaldateien und gegebenenfalls alternative Audioformate.
- Der genaue Canonical-Hostname und Redirect-Zeitraum für bestehende PodcastGen-URLs.

Diese Punkte benötigen eine Betriebsprüfung, bevor ein Upload-Prozess produktiv eingerichtet oder eine bestehende RSS-Enclosure-URL geändert wird.

## Konsequenzen

- Sehr große Audiodateien bleiben von Repository-, CMS- und Website-Build-Limits getrennt; die statische Site bleibt klein und schnell deploybar.
- Object-Storage-/CDN-Kosten, Datentransfer, Verfügbarkeit und Backups werden laufende Betriebsaufgaben. Vor einer Anbieterwahl sind Speicherbedarf und erwarteter ausgehender Traffic anhand realer Episoden- und Downloadzahlen zu kalkulieren.
- Ein stabiler eigener Medien-Hostname entkoppelt öffentliche RSS- und Website-URLs vom Anbieter. Ein Anbieterwechsel benötigt dennoch Dateiübertragung, Integritätsprüfung und abgestimmte Redirects.
- Die Website kann öffentliche MP3s direkt in ihrem nativen Player wiedergeben, sobald die Dateien erreichbar sind. Der Patreon-Kanal bleibt getrennt und weiterhin für zusätzliche bezahlte Inhalte zuständig.
- Ein RSS-Eintrag ist nur dann freigabefähig, wenn seine öffentliche Datei ohne Authentifizierung erreichbar ist und Podcast-Clients die MP3 streamen sowie in ihr navigieren können. Bezahlte Patreon-Dateien erfüllen diese Voraussetzung absichtlich nicht.

## Quellen

- [Bestehender PodcastGen RSS-Feed](http://www.medienpublikation.de/retrocompod/podcastgen/feed.xml) — geprüfte `enclosure`-URLs, Dateigrößen, MIME-Typen und GUIDs.
- [PodcastGen-Medienpfad](http://www.medienpublikation.de/retrocompod/podcastgen/media/) — aktuell im Feed referenzierter externer Medienhost.
- [Patreon / Retrokompott](https://www.patreon.com/c/retrokompott/posts) — separater bezahlter Kanal für zusätzliche MP3-Inhalte.
- [HTTP Semantics: Range Requests](https://www.rfc-editor.org/rfc/rfc9110.html#name-range-requests) — HTTP-Byte-Range-Anfragen für Medienwiedergabe und Navigation.
- [RSS 2.0 Specification](https://www.rssboard.org/rss-specification) — Podcast-Enclosure-Felder.
- [Apple Podcasts: RSS feed requirements](https://podcasters.apple.com/support/823-podcast-requirements) — öffentlich zugängliche Enclosures und stabile Podcast-Feed-Metadaten.
- [ADR-0002](./0002-wordpress-to-storyblok-migration.md) — WordPress-Migration und Ausschluss von Medien-Binärdateien aus dem lokalen Cache.
- [ADR-0004](./0004-storyblok-frontend-components.md) — Storyblok-Artikel und Audio-Player.
- [ADR-0005](./0005-generated-article-views-and-podcast-feed.md) — unabhängige Podcast-, Homepage- und Stammtisch-Veröffentlichungsflags.
- [ADR-0007](./0007-final-mp3-migration-to-cloudflare-r2.md) — Inventar, Zugangsdaten und abschließender Transfer der öffentlichen MP3s nach R2.
