# ADR-0007: Abschließende Migration öffentlicher MP3s nach Cloudflare R2

- **Status:** Vorgeschlagen
- **Datum:** 2026-11-06

## Kontext

Die WordPress-Migration überträgt Artikel und Seiten inkrementell nach Storyblok. Große MP3-Dateien werden dabei nicht in den Storyblok-Asset-Manager, den lokalen Content-Cache oder das Repository kopiert. Während die Inhalte migriert und die Website erstmals deployed wird, bleiben bestehende PodcastGen-Enclosures die aktive Quelle.

ADR-0002 sieht ein Asset-Inventar als Metadatenliste beim Auslesen von WordPress-Inhalten vor. ADR-0006 bestimmt Cloudflare R2 als langfristigen Speicher für öffentliche Podcast-MP3s. Die eigentliche Dateiübertragung ist ein eigener, abschließender Migrationsschritt: Sie beginnt erst, wenn die Artikel-/Seitenmigration abgeschlossen und der Content-Stand erfolgreich deployed ist. Patreon enthält zusätzliche bezahlte MP3s; diese bleiben ein getrennter Kanal und werden nicht in dieses öffentliche Asset-Inventar zur Übertragung aufgenommen.

Für den Zugriff auf R2 benötigt der Upload-Prozess R2-S3-Zugangsdaten. Sie werden ausschließlich lokal in `.env` bereitgestellt. Diese Datei und lokale `.env.*`-Varianten sind durch `.gitignore` ausgeschlossen; vor jedem Transfer ist zu prüfen, dass die Credentials nicht bereits in Git nachverfolgt werden.

## Entscheidung

Die öffentlichen, zu Podcast-Artikeln gehörenden MP3-Dateien werden als letzte Datenmigration nach Cloudflare R2 übertragen. Der initiale Content-Deploy nutzt bis zum erfolgreichen Audio-Transfer weiter die vorhandenen PodcastGen-URLs. Nach dem Transfer werden die Artikel-/Feed-Metadaten auf die verifizierten R2-Public-URLs umgestellt und ein finaler Site-/RSS-Build deployed. Die Medienmigration ist damit der letzte Datenbestand vor dem finalen Go-live, nicht ein Schritt, der ohne abschließenden Build abgeschlossen werden kann.

Die Quellliste ist `migration-cache/wordpress/assets/manifest.json` gemäß ADR-0002. Nur Assets mit expliziter Freigabe als öffentliche Podcast-MP3 werden übertragen. Andere Bild-/Dokumentdateien bleiben nach den bestehenden Entscheidungen extern oder werden separat behandelt; private, supporter-only oder Patreon-MP3s werden ausgeschlossen.

### Asset-Inventar

Beim initialen Auslesen der WordPress-Posts/-Pages und des öffentlichen Podcast-RSS werden referenzierte Assets als Metadaten erfasst. Das Inventar enthält keine Medien-Binärdaten und keine Zugangsdaten. Ein Eintrag für eine öffentliche Podcast-MP3 enthält mindestens:

- Quelltyp und stabile Quellkennung (WordPress-Attachment-ID, falls vorhanden; andernfalls Feed-GUID/Enclosure-Identität).
- Quell-URL, nur wenn sie öffentlich und frei von Zugangsdaten/signierten privaten Query-Parametern ist; sonst eine redigierte Referenz.
- Dateiname, MIME-Typ, bekannte Byte-Größe und zugeordnete WordPress-Post-ID/Storyblok-Story-ID.
- Veröffentlichungsklasse (`public`, `public_preview`, `supporters`, `unknown`), Freigabestatus und Quelle der Klassifikation.
- deterministischer R2-Objekt-Key, Ziel-Public-URL, Uploadstatus, Zielgröße, Prüfsummen-/HTTP-Prüfergebnis, letzter Versuch und Fehlerstatus.

Eine MP3 mit `unknown` oder `supporters` wird niemals automatisch in den öffentlichen Bucket hochgeladen. Die Kennzeichnung als `public` muss redaktionell oder durch eindeutig validierte Feed-Daten freigegeben sein. Der Manifest-Eintrag erhält keine Patreon-Download-URL und keine vertraulichen Query-Werte. Größe und Dateiname werden nicht aus dem Titel erraten; fehlende Werte gehen als ungeklärte Ausnahme in den Transferbericht.

### Reihenfolge und Freigabe

1. **Content-Migration abschließen:** WordPress-Posts/Pages und native Storyblok-Inhalte sind abgeglichen; `CONTENT_MIGRATION_STATUS=complete` ist gesetzt. Der Content-only Website-Build ist erfolgreich deployed. Dieser erste Deploy behält noch die bisherigen öffentlichen Audio-URLs.
2. **R2-Ziel vorbereiten:** Ein dedizierter Bucket und eine kontrollierte öffentliche Custom Domain/CDN-URL sind eingerichtet. Der Bucket ist nicht über einen offenen Root-Listing-Endpunkt durchsuchbar. HTTPS, MIME-Typ, Caching, Range-Requests und `HEAD`-Antworten sind getestet.
3. **Lokale Zugangsdaten bereitstellen:** Eine R2-S3-Access-Key-ID und ein Secret Access Key mit minimalen, auf den Ziel-Bucket beschränkten Object Read & Write-Rechten werden lokal in `.env` konfiguriert. Zusätzlich werden Account-ID und Bucket-Name benötigt. Der Transfer verwendet den R2-S3-Endpunkt und Region `auto`. Der Secret Access Key wird nach Erstellung sicher kopiert und nicht in Logs ausgegeben.
4. **Dry Run und Quellabgleich:** Der Transfer prüft Inventar, öffentliche Freigabe, Quell-Erreichbarkeit, bekannte Dateigröße, Ziel-Key-Kollisionen und Story-Zuordnung. Er zeigt Anzahl, Byte-Volumen, Zielpfade und Ausnahmen an, ohne Dateien zu schreiben. Fehlende Credentials verhindern den echten Transfer mit einer klaren Fehlermeldung; ein Dry Run bleibt ohne Credentials möglich.
5. **Übertragbare MP3s kopieren:** Uploads erfolgen in wiederanlaufbaren Multipart-Uploads, geeignet für Dateien von mehreren hundert MB. Quelldaten werden gestreamt oder nur in einem temporären Verzeichnis außerhalb des Repositories gepuffert; dauerhaft abgelegt werden sie ausschließlich in R2. Temporäre Dateien werden nach Erfolg oder Abbruch entfernt. Bereits verifizierte Zielobjekte werden anhand Manifest/Prüfsumme nicht blind überschrieben. Teilfehler verbleiben als Fehlerstatus und können gezielt erneut versucht werden. Unbekannte oder nicht öffentliche Assets werden übersprungen und im Bericht ausgewiesen, nicht stillschweigend als Erfolg markiert.
6. **Ziel verifizieren:** Zielgröße und verfügbare Prüfsummen werden mit der Quelle verglichen. Da Multipart-ETags nicht verlässlich einer vollständigen Datei-Prüfsumme entsprechen, ist ein ETag allein kein Integritätsnachweis. Ein `HEAD`-Request sowie mindestens ein Byte-Range-Request müssen den erwarteten Content-Type, die Byte-Länge und `206 Partial Content` mit passendem `Content-Range` bestätigen. Ein repräsentativer Browser-/Podcastclient-Test bestätigt die Wiedergabe und Navigation.
7. **URLs umstellen und final deployen:** Erst nach bestandener Verifikation wird die öffentliche R2-URL in der zugehörigen Storyblok-Artikel-/Podcast-Metadatenquelle eingetragen. Audio-Player und RSS verwenden dieselbe URL; RSS-GUIDs bleiben unverändert. Danach erfolgen Schema-/RSS-Validierung und der finale Site-Deploy. Die PodcastGen-Quelle bleibt bestehen, bis finaler RSS und Website bestätigt sind; erst dann darf ein separater Redirect-/Abschaltplan umgesetzt werden.
8. **Abschluss sichern:** Manifeststatus und Prüfergebnisse werden reviewt und versioniert; Quell- und Zielbestand werden auf ungeklärte öffentliche Podcast-MP3s abgeglichen. Der Transfer ist erst abgeschlossen, wenn alle freigegebenen öffentlichen MP3s `verified` oder mit einer expliziten dokumentierten Ausnahme versehen sind.

### Lokale Konfiguration und Secrets

Die lokalen Variablennamen für den Transfer sind:

```dotenv
CLOUDFLARE_R2_ACCOUNT_ID=
CLOUDFLARE_R2_BUCKET=
CLOUDFLARE_R2_ACCESS_KEY_ID=
CLOUDFLARE_R2_SECRET_ACCESS_KEY=
CLOUDFLARE_R2_PUBLIC_BASE_URL=
```

`.env` und lokale Varianten (`.env.*`) werden durch `.gitignore` ausgeschlossen; nur eine `.env.example` mit leeren Platzhaltern darf versioniert werden. Vor dem ersten Transfer ist sicherzustellen, dass die lokale `.env` nicht bereits getrackt wird. Secrets dürfen weder im Asset-Manifest noch in Fehlermeldungen, CI-Artefakten, Storyblok, RSS oder Browser-Code landen. Diese R2-Zugangsdaten werden für den manuellen/lokalen Medien-Transfer verwendet und nicht als Secret an den normalen Content-Build oder GitHub Pages gegeben. Ein eigener eng begrenzter Upload-Prozess protokolliert nur Asset-ID, Ziel-Key und Ergebnis, nicht Credentials.

## Konsequenzen

- Die WordPress-Inhaltsmigration und ihr erster Deploy bleiben unabhängig vom MP3-Transfer lauffähig. Audio-Dateien werden erst nach diesem bestätigten Content-Stand kopiert; anschließend ist ein finaler Build/Deploy der umgestellten URLs erforderlich.
- Ein versioniertes Metadaten-Inventar macht den großen Datei-Transfer überprüfbar, inkrementell und wiederaufnehmbar, ohne Binärdateien im Repository abzulegen.
- Die lokale `.env` erhält später R2-Zugangsdaten und muss deshalb ignoriert bleiben. `CONTENT_MIGRATION_STATUS` bleibt ein Content-Status; der Audio-Transfer wird separat über die Asset-Manifeststatus verfolgt.
- Die Medienmigration wird nicht durch Setzen des Status `complete` allein ausgelöst. Sie benötigt expliziten Dry Run, Freigabe der öffentlichen Dateien und einen separat gestarteten Transfer.
- Der Transfer verursacht Netzwerk- und R2-Speicherkosten. Vor dem Lauf werden Gesamtzahl und Gesamtgröße der freigegebenen MP3s ausgewiesen.
- Der Status ist Vorgeschlagen, bis der R2-Bucket, die öffentliche Domain und der lokale Upload-Ablauf eingerichtet und mit repräsentativen Dateien getestet sind.

## Quellen

- [Cloudflare R2: Authentication](https://developers.cloudflare.com/r2/api/tokens/) — R2 Access Key ID/Secret Access Key, S3-Endpunkt und Bucket-scoped Object Read & Write Rechte.
- [Cloudflare R2: S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/) — S3-kompatible API und Endpunkt.
- [Cloudflare R2: Upload objects](https://developers.cloudflare.com/r2/objects/upload-objects/) — Multipart-Upload und Wiederaufnahme für große Dateien.
- [Cloudflare R2: Public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/) — öffentlicher Zugriff über Custom Domain oder `r2.dev`; Custom Domain unterstützt CDN-Funktionen.
- [ADR-0002](./0002-wordpress-to-storyblok-migration.md) — Asset-Inventar und WordPress-Content-Migration.
- [ADR-0004](./0004-storyblok-frontend-components.md) — Audio-Player-Komponente.
- [ADR-0005](./0005-generated-article-views-and-podcast-feed.md) — RSS- und Veröffentlichungsregeln.
- [ADR-0006](./0006-long-term-podcast-audio-storage.md) — langfristige Speicherung öffentlicher MP3s und Trennung von Patreon.
