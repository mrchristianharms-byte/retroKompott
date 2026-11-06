import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import { SyntaxValidator } from "fast-xml-validator";

const defaultWordPressUrl = "https://blog.retrokompott.de";
const defaultPodcastFeedUrl =
  "http://www.medienpublikation.de/retrocompod/podcastgen/feed.xml";
const cacheRoot = path.resolve("migration-cache/wordpress");
const resourceTypes = ["posts", "pages"];
const explicitlyIgnoredOldestFeedIds = new Set([
  "4326954f0e9fa7ae576ee97851e34a0c84c0b7685dc499d7d62aaee5038b728f",
  "4cf2db4aaadd8747fb218f66e2fcce03f61527ba4ae2b154ab599c07b44e14a7",
  "fafd6ae09269e9831fb5cc39676f0b9f7f9a026914cb38a9206a30843f094039",
  "66f3e4a432f6f24a8cb8f1c1bad6348d94aa5d03a81e8d86a90226b96011eba8",
  "c48f3be7903ba58a784569ac7cc978a8c1a70ff30a0b26f5831fe15d55940def",
  "72f216f388c124fc2465d3b4ae3d2c44aa20bcdb593e1e705c1456673b05a7f9",
  "b3e1e035ba6bbd611bfca7f57e0a894fbfddeec925cb7ea66db6c1dccc200a4c",
  "dda235405949e13c79c8cddffa12e1a95a4702144e97e68e5b5adc96caf82c13",
  "ecf65ebbeff72d879723e83034355a6052ae71be110a74f9f3a9f4fe291e66bc",
  "bc991ce6a022e8d87d31e32e5cd45290076141225a1fe97c228dc0522cbe5871",
  "b7f7bbd0bfc7cf6a158235449eefdf9b9bf9a4446052e7d66a5c73c12f8e2655",
  "3ebcbef8ca467c4ed1a2cc338ceb06f01ef9874c369c0ecdae164e031a754d15",
  "09d8675239cc754f49a31d97785fdb61f6bba334fb9b505509430bf154d5e4f3",
  "042bad4be2fe0dd7b06da4c72eedf9a4624a5716d6975b886b316cb8ee256209",
  "be8ade6bbeb43f3067fd7cbeb1c5cad6f2a6864862058da5013e30db1565d496",
  "55586de9a99fe04deaa974cecdada64f9944dede13bed685fc5b48ab9b000018",
  "4ea39ca9521b54015c378fb325cfe3d6ae7d1db0388a55a99b1c080b710cd964",
  "51dd961bf37ff63ecb1a9530797b03e49b16b04697861a7dc354c68e86e71360",
]);
const explicitlyIgnoredSelectedFeedIds = new Set([
  "7b9c8609b63abadd66c6e00a6dc0202f1888562dfba2bb3104a5d63316dabaf9",
  "435a9a32f23cc712d02f28f2e7957c65b4f992389f1b2b740027d82c86b081ea",
  "540403b63af5d5c37f1a0f9eaea4ee60fdcc1b00cdf51d26fd1028f6a69340a2",
  "7108644139fb94dd9d96a1a450f23f0fd7bdcf486b25ab50e2d93766858e9e06",
  "5ae7426aaa21491db088011f750390e3c8cb65cd9fe84162c76c887003195eb7",
  "70ddc7e113d1df3b337f115b537cfd8e812936baf5eb160877c327f6e45249b3",
  "82f90316f7b70c270c4800d3bda941662f03a62ba5340e1bbd41e02a6e533199",
  "5dd4325eaaf9f955367242d6b975b99dc1f69ecf4d65c5bf9e68d8207ca8c2e6",
]);
const pageSize = 100;
const overlapMilliseconds = 2 * 60 * 1000;
const maxAttempts = 4;
const requestTimeoutMilliseconds = 30_000;
const requestFields = [
  "id",
  "date",
  "date_gmt",
  "modified",
  "modified_gmt",
  "slug",
  "status",
  "type",
  "link",
  "title",
  "content",
  "excerpt",
  "categories",
  "tags",
  "featured_media",
  "parent",
  "menu_order",
  "format",
  "sticky",
  "guid",
].join(",");
const assetExtensions =
  /\.(?:avif|gif|jpe?g|mp3|m4a|mp4|ogg|ogv|pdf|png|svg|wav|webm|webp)(?:$|[?#])/i;
const attributeUrlPattern =
  /\b(?:href|src|poster|data-src|data-original|data-url|srcset|data-srcset)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi;

const args = new Set(process.argv.slice(2));
const valueArg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1] ?? fallback;
};

if (args.has("--help")) {
  console.log(`Usage: pnpm wordpress:export [--full] [--dry-run]

Options:
  --full                 Fetch all published posts and pages (reconciliation)
  --dry-run              Fetch and validate sources without writing cache files
  --wordpress-url URL   WordPress site URL (default: ${defaultWordPressUrl})
  --rss-url URL         Podcast RSS URL (default: ${defaultPodcastFeedUrl})`);
  process.exit(0);
}

const dryRun = args.has("--dry-run");
const fullExport = args.has("--full");
const wordpressUrl = normalizeBaseUrl(
  valueArg("--wordpress-url", defaultWordPressUrl),
);
const podcastFeedUrl = valueArg("--rss-url", defaultPodcastFeedUrl);

function normalizeBaseUrl(value) {
  const url = new URL(value);
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableContent(content) {
  if (typeof content?.rendered !== "string") return content;
  return {
    ...content,
    rendered: content.rendered
      .replace(/\baccess_token\s*=\s*[^&\s"'<>]+/gi, "")
      .replace(/\bplayer-[a-f0-9]{10,}\b/gi, "player-VOLATILE"),
  };
}

function sourceHash(item) {
  return hash(
    JSON.stringify({
      id: item.id,
      date: item.date,
      date_gmt: item.date_gmt,
      modified: item.modified,
      modified_gmt: item.modified_gmt,
      slug: item.slug,
      status: item.status,
      type: item.type,
      link: item.link,
      title: item.title,
      // Podlove generates a new DOM player ID on each REST response.
      content: stableContent(item.content),
      excerpt: stableContent(item.excerpt),
      categories: item.categories,
      tags: item.tags,
      featured_media: item.featured_media,
      parent: item.parent,
      menu_order: item.menu_order,
      format: item.format,
      sticky: item.sticky,
      guid: item.guid,
    }),
  );
}

function normalizeRecord(item, resourceType) {
  const record = {
    id: item.id,
    resource_type: resourceType === "posts" ? "post" : "page",
    slug: item.slug,
    status: item.status,
    link: item.link,
    date: item.date,
    date_gmt: item.date_gmt,
    modified: item.modified,
    modified_gmt: item.modified_gmt,
    title: item.title,
    content: stableContent(item.content),
    excerpt: stableContent(item.excerpt),
    categories: item.categories ?? [],
    tags: item.tags ?? [],
    featured_media: item.featured_media ?? 0,
    parent: item.parent ?? 0,
    menu_order: item.menu_order ?? 0,
    format: item.format,
    sticky: item.sticky ?? false,
    guid: item.guid,
  };
  record.source_hash = sourceHash(record);
  return record;
}

async function fetchWithRetry(url, { accept = "application/json" } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { accept },
        signal: AbortSignal.timeout(requestTimeoutMilliseconds),
      });
      if (response.ok) return response;
      const retryable = response.status === 429 || response.status >= 500;
      const detail = `HTTP ${response.status} ${response.statusText}`;
      if (!retryable || attempt === maxAttempts) {
        throw new Error(`${detail} for ${url}`);
      }
      const retryAfter = Number(response.headers.get("retry-after"));
      await delay(
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : 500 * 2 ** (attempt - 1),
      );
      lastError = new Error(`${detail} for ${url}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("HTTP ")) {
        throw error;
      }
      lastError = error;
      if (attempt === maxAttempts) break;
      await delay(500 * 2 ** (attempt - 1));
    }
  }
  throw new Error(`Request failed after ${maxAttempts} attempts: ${url}`, {
    cause: lastError,
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readJsonResponse(response, url) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON from ${url}`, { cause: error });
  }
}

function checkpointSince(value) {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`Invalid cached checkpoint: ${value}`);
  }
  return new Date(timestamp - overlapMilliseconds).toISOString();
}

async function fetchCollection(resourceType, modifiedAfter) {
  const endpoint = new URL(
    `/wp-json/wp/v2/${resourceType}`,
    `${wordpressUrl}/`,
  );
  endpoint.searchParams.set("per_page", String(pageSize));
  endpoint.searchParams.set("_fields", requestFields);
  endpoint.searchParams.set("status", "publish");
  if (modifiedAfter) endpoint.searchParams.set("modified_after", modifiedAfter);

  const items = [];
  let totalPages;
  let total;
  for (let page = 1; totalPages === undefined || page <= totalPages; page += 1) {
    const url = new URL(endpoint);
    url.searchParams.set("page", String(page));
    const response = await fetchWithRetry(url);
    const pageTotal = Number(response.headers.get("x-wp-totalpages"));
    const reportedTotal = Number(response.headers.get("x-wp-total"));
    if (!Number.isInteger(pageTotal) || pageTotal < 0) {
      throw new Error(`Missing or invalid X-WP-TotalPages from ${url}`);
    }
    if (!Number.isInteger(reportedTotal) || reportedTotal < 0) {
      throw new Error(`Missing or invalid X-WP-Total from ${url}`);
    }
    if (totalPages === undefined) {
      totalPages = pageTotal;
      total = reportedTotal;
    } else if (pageTotal !== totalPages || reportedTotal !== total) {
      throw new Error(`WordPress collection changed during pagination: ${url}`);
    }
    const pageItems = await readJsonResponse(response, url);
    if (!Array.isArray(pageItems)) {
      throw new Error(`Expected an array from ${url}`);
    }
    items.push(...pageItems);
  }
  if (items.length !== total) {
    throw new Error(
      `Incomplete ${resourceType} pagination: received ${items.length}, expected ${total}`,
    );
  }
  return { items, total };
}

function xmlText(value) {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (!value || typeof value !== "object") return "";
  if (typeof value["#text"] === "string") return value["#text"];
  if (typeof value["#cdata"] === "string") return value["#cdata"];
  return "";
}

function safeUrl(value) {
  if (typeof value !== "string" || !/^https?:\/\//i.test(value.trim())) {
    return undefined;
  }
  try {
    const url = new URL(value.trim());
    if (url.username || url.password) return undefined;
    if (!url.search && url.href.endsWith("?")) url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function redactedUrl(value) {
  const safe = safeUrl(value);
  if (!safe) return undefined;
  const url = new URL(safe);
  const hasSensitiveParameter = [...url.searchParams.keys()].some((key) =>
    /token|secret|signature|credential|authorization|^auth$|^key$|^expires$|^x-amz-|^x-goog-/i.test(
      key,
    ),
  );
  return hasSensitiveParameter
    ? `${url.origin}${url.pathname}?[redacted]`
    : safe;
}

function normalizedUrl(value) {
  const safe = safeUrl(value);
  if (!safe) return undefined;
  const url = new URL(safe);
  url.hostname = url.hostname.toLowerCase();
  return url.toString();
}

function assetBasename(value) {
  const safe = safeUrl(value);
  if (!safe) return undefined;
  try {
    return decodeURIComponent(path.posix.basename(new URL(safe).pathname))
      .toLowerCase();
  } catch {
    return undefined;
  }
}

function filenameFromUrl(value) {
  if (!value) return undefined;
  try {
    const filename = path.posix.basename(new URL(value).pathname);
    return decodeURIComponent(filename);
  } catch {
    return undefined;
  }
}

function extractAssetUrls(html) {
  if (typeof html !== "string") return [];
  const urls = new Set();
  for (const match of html.matchAll(attributeUrlPattern)) {
    const attributeValue = match[1] ?? match[2] ?? match[3];
    if (!attributeValue) continue;
    for (const candidate of attributeValue.split(",")) {
      const value = candidate.trim().split(/\s+/, 1)[0];
      const url = safeUrl(value.replaceAll("&amp;", "&"));
      if (url && assetExtensions.test(url)) urls.add(url);
    }
  }
  for (const match of html.matchAll(/\bwp-image-(\d+)\b/g)) {
    urls.add(`wordpress-attachment-id:${match[1]}`);
  }
  return [...urls];
}

function normalizeFeedItem(item) {
  const enclosureValue = Array.isArray(item.enclosure)
    ? item.enclosure[0]
    : item.enclosure;
  const guidValue = item.guid;
  const guid = xmlText(guidValue).trim();
  const description = xmlText(item.description);
  const duration = xmlText(item["itunes:duration"]).trim();
  const enclosure = enclosureValue
    ? {
        url: safeUrl(enclosureValue["@_url"]),
        length: Number.isFinite(Number(enclosureValue["@_length"]))
          ? Number(enclosureValue["@_length"])
          : undefined,
        type: enclosureValue["@_type"] || undefined,
      }
    : undefined;
  const normalized = {
    title: xmlText(item.title).trim(),
    link: safeUrl(xmlText(item.link).trim()),
    description,
    pub_date: xmlText(item.pubDate).trim(),
    guid: guid || undefined,
    guid_is_permalink:
      typeof guidValue === "object" ? guidValue["@_isPermaLink"] : undefined,
    enclosure,
    duration: duration || undefined,
  };
  normalized.id = hash(
    normalized.guid ||
      normalized.enclosure?.url ||
      normalized.link ||
      `${normalized.title}\n${normalized.pub_date}`,
  );
  normalized.source_hash = hash(JSON.stringify(normalized));
  return normalized;
}

function slugify(value) {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function toPodcastArticle(item) {
  if (!/stammtisch/i.test(item.title)) return undefined;
  if (!item.guid || !item.enclosure?.url || !item.enclosure.length ||
      !item.enclosure.type || !item.duration || !Date.parse(item.pub_date)) {
    throw new Error(
      `Incomplete RSS-only Stammtisch article metadata: ${item.title}`,
    );
  }
  const publishedAt = new Date(item.pub_date).toISOString();
  const article = {
    id: item.id,
    resource_type: "article",
    source_type: "podcast_rss",
    source_id: redactedUrl(item.guid) ?? item.guid,
    slug: `${slugify(item.title) || "stammtisch"}-${item.id.slice(0, 10)}`,
    title: item.title,
    summary: item.description,
    published_at: publishedAt,
    audio_guid: redactedUrl(item.guid) ?? item.guid,
    audio_url: redactedUrl(item.enclosure.url),
    audio_mime_type: item.enclosure.type,
    audio_length_bytes: item.enclosure.length,
    duration: item.duration,
    podcast: true,
    homepage: false,
    stammtisch: false,
    source_hash: item.source_hash,
  };
  return article;
}

async function fetchPodcastFeed() {
  const response = await fetchWithRetry(podcastFeedUrl, {
    accept: "application/rss+xml, application/xml, text/xml, */*",
  });
  const xml = await response.text();
  if (Buffer.byteLength(xml) > 30 * 1024 * 1024) {
    throw new Error("Podcast RSS response exceeds the 30 MB safety limit");
  }
  if (xml.includes("<!DOCTYPE")) {
    throw new Error("Podcast RSS must not contain a document type declaration");
  }
  try {
    SyntaxValidator.validate(xml);
  } catch (error) {
    throw new Error(
      `Invalid podcast RSS XML: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
    cdataPropName: "#cdata",
    parseAttributeValue: false,
    parseTagValue: false,
    trimValues: false,
    isArray: (name) => name === "item" || name === "enclosure",
  });
  const parsed = parser.parse(xml);
  const channel = parsed.rss?.channel;
  if (!channel || !Array.isArray(channel.item)) {
    throw new Error("Podcast RSS has no valid rss.channel.item list");
  }
  return channel.item.map(normalizeFeedItem);
}

function recordFile(resourceType, id) {
  return path.join(cacheRoot, resourceType, `${id}.json`);
}

function podcastArticleFile(id) {
  return path.join(cacheRoot, "podcast-articles", `${id}.json`);
}

async function readPodcastArticles() {
  const directory = path.join(cacheRoot, "podcast-articles");
  let files;
  try {
    files = await readdir(directory);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const articles = [];
  for (const filename of files.filter((name) => /^[a-f0-9]{64}\.json$/.test(name))) {
    const file = path.join(directory, filename);
    try {
      articles.push(JSON.parse(await readFile(file, "utf8")));
    } catch (error) {
      throw new Error(`Cannot read cached podcast article ${file}`, {
        cause: error,
      });
    }
  }
  return articles;
}

async function readCachedRecords(resourceType) {
  const directory = path.join(cacheRoot, resourceType);
  let files;
  try {
    files = await readdir(directory);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const records = [];
  for (const filename of files.filter((name) => /^\d+\.json$/.test(name))) {
    const file = path.join(directory, filename);
    try {
      records.push(JSON.parse(await readFile(file, "utf8")));
    } catch (error) {
      throw new Error(`Cannot read cached record ${file}`, { cause: error });
    }
  }
  return records;
}

async function writeJsonAtomic(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const tempFile = `${file}.${process.pid}.tmp`;
  try {
    await writeFile(tempFile, `${JSON.stringify(value, null, 2)}\n`, {
      flag: "wx",
    });
    await rename(tempFile, file);
  } finally {
    await rm(tempFile, { force: true });
  }
}

async function removeStaleRecords(resourceType, validIds) {
  const directory = path.join(cacheRoot, resourceType);
  let files;
  try {
    files = await readdir(directory);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const filename of files) {
    const match = /^(\d+)\.json$/.exec(filename);
    if (match && !validIds.has(Number(match[1]))) {
      await rm(path.join(directory, filename));
    }
  }
}

function getModifiedCheckpoint(records, previousValue, full) {
  const maxModified = records.reduce((latest, record) => {
    if (!record.modified_gmt) return latest;
    return !latest || record.modified_gmt > latest ? record.modified_gmt : latest;
  }, undefined);
  return full || !previousValue
    ? maxModified ?? new Date().toISOString()
    : maxModified && maxModified > previousValue
      ? maxModified
      : previousValue;
}

function newAssetManifest(records, feedItems, matches) {
  const assets = new Map();
  const aliases = new Map();
  const getOrCreate = (key, values = {}) => {
    const existing = assets.get(key) ?? {
      source_type: values.source_type,
      source_id: values.source_id,
      source_url: values.source_url,
      file_name: values.file_name,
      mime_type: values.mime_type,
      size_bytes: values.size_bytes,
      referenced_by: [],
      publication_class: "unknown",
      classification_source: "not_classified",
      approved_for_transfer: false,
      transfer_status: "not_started",
      target_object_key: null,
      target_public_url: null,
      target_size_bytes: null,
      checksum: null,
      last_transfer_attempt: null,
      transfer_error: null,
    };
    for (const [field, value] of Object.entries(values)) {
      if (value !== undefined && value !== null && value !== "") {
        existing[field] = value;
      }
    }
    assets.set(key, existing);
    return existing;
  };
  const addReference = (asset, reference) => {
    const key = `${reference.resource_type}:${reference.id}`;
    if (!asset.referenced_by.some((item) => `${item.resource_type}:${item.id}` === key)) {
      asset.referenced_by.push(reference);
    }
  };
  const addUrlAsset = (url, values, reference) => {
    const normalized = normalizedUrl(url);
    if (!normalized) return;
    const key = aliases.get(normalized) ?? `url:${normalized}`;
    const asset = getOrCreate(key, {
      source_url: redactedUrl(url),
      file_name: filenameFromUrl(url),
      ...values,
    });
    aliases.set(normalized, key);
    addReference(asset, reference);
    return asset;
  };

  for (const record of records) {
    const reference = {
      resource_type: record.resource_type,
      id: record.id,
    };
    for (const url of extractAssetUrls(record.content?.rendered)) {
      if (url.startsWith("wordpress-attachment-id:")) {
        const id = Number(url.split(":")[1]);
        const key = aliases.get(`attachment:${id}`) ?? `attachment:${id}`;
        addReference(getOrCreate(key, {
          source_type: "wordpress_attachment",
          source_id: id,
        }), reference);
      } else {
        addUrlAsset(url, { source_type: "wordpress_content" }, reference);
      }
    }
    if (record.featured_media) {
      const attachmentKey = `attachment:${record.featured_media}`;
      const key = aliases.get(attachmentKey) ?? attachmentKey;
      addReference(
        getOrCreate(key, {
          source_type: "wordpress_attachment",
          source_id: record.featured_media,
        }),
        reference,
      );
    }
  }

  for (const item of feedItems) {
    if (!item.enclosure?.url) continue;
    const linkedRecordIds = matches.get(item.id) ?? [];
    const reference = linkedRecordIds.length
      ? linkedRecordIds.map((id) => ({ resource_type: "post", id }))
      : /stammtisch/i.test(item.title)
        ? [{ resource_type: "podcast_article", id: item.id }]
        : [{ resource_type: "podcast_feed", id: item.id }];
    const asset = addUrlAsset(
      item.enclosure.url,
      {
        source_type: "podcast_rss",
        source_id: item.guid ?? item.id,
        mime_type: item.enclosure.type,
        size_bytes: item.enclosure.length,
      },
      reference[0],
    );
    for (const additionalReference of reference.slice(1)) {
      addReference(asset, additionalReference);
    }
  }

  for (const asset of assets.values()) {
    asset.referenced_by.sort(
      (left, right) =>
        left.resource_type.localeCompare(right.resource_type) || left.id - right.id,
    );
  }
  return [...assets.values()].sort((left, right) =>
    String(left.source_url ?? left.source_id).localeCompare(
      String(right.source_url ?? right.source_id),
    ),
  );
}

function makeReferenceIndex(records) {
  const index = new Map();
  for (const record of records) {
    const urls = new Set([
      normalizedUrl(record.link),
      ...extractAssetUrls(record.content?.rendered).map(normalizedUrl),
    ]);
    for (const url of urls) {
      if (!url) continue;
      const matches = index.get(url) ?? [];
      matches.push(record.id);
      index.set(url, matches);
    }
  }
  return index;
}

function mapFeedToPosts(feedItems, posts) {
  const referenceIndex = makeReferenceIndex(posts);
  const basenameIndex = new Map();
  for (const post of posts) {
    const content = post.content?.rendered ?? "";
    const referencedFiles = [
      ...extractAssetUrls(content),
      ...[...content.matchAll(/[\w.%+-]+\.(?:mp3|m4a|ogg|wav)(?=["'\\?&\s]|$)/gi)]
        .map((match) => match[0]),
    ];
    for (const url of referencedFiles) {
      const basename = assetBasename(url) ?? url.toLowerCase();
      if (!basename) continue;
      const postIds = basenameIndex.get(basename) ?? new Set();
      postIds.add(post.id);
      basenameIndex.set(basename, postIds);
    }
  }
  const matches = new Map();
  const unmatched = [];
  const ambiguous = [];
  for (const item of feedItems) {
    const candidateUrls = new Set([
      normalizedUrl(item.enclosure?.url),
      normalizedUrl(item.link),
      normalizedUrl(item.guid),
      ...extractAssetUrls(item.description).map(normalizedUrl),
    ]);
    const postIds = new Set();
    for (const candidate of candidateUrls) {
      if (!candidate) continue;
      for (const id of referenceIndex.get(candidate) ?? []) postIds.add(id);
    }
    const enclosureBasename = assetBasename(item.enclosure?.url);
    for (const id of basenameIndex.get(enclosureBasename) ?? []) {
      postIds.add(id);
    }
    if (postIds.size === 1) {
      matches.set(item.id, [...postIds]);
    } else if (postIds.size > 1) {
      ambiguous.push({ feed_item_id: item.id, post_ids: [...postIds] });
    } else {
      unmatched.push(item.id);
    }
  }
  return { matches, unmatched, ambiguous };
}

async function writeFetchedRecords(resourceType, records) {
  for (const record of records) {
    await writeJsonAtomic(recordFile(resourceType, record.id), record);
  }
}

function mergeAssetsByUrl(assets) {
  const merged = new Map();
  for (const asset of assets) {
    const key = normalizedUrl(asset.source_url) ??
      `attachment:${asset.source_id ?? asset.file_name ?? merged.size}`;
    const current = merged.get(key);
    if (!current) {
      merged.set(key, asset);
      continue;
    }
    if (asset.source_type === "wordpress_attachment") {
      current.source_type = asset.source_type;
      current.source_id = asset.source_id;
    }
    for (const field of [
      "source_url",
      "file_name",
      "mime_type",
      "size_bytes",
      "metadata_status",
      "alt_text",
      "attachment_link",
    ]) {
      if ((current[field] === undefined || current[field] === null) && asset[field] !== undefined) {
        current[field] = asset[field];
      }
    }
    for (const reference of asset.referenced_by) {
      if (
        !current.referenced_by.some(
          (existing) =>
            existing.resource_type === reference.resource_type &&
            existing.id === reference.id,
        )
      ) {
        current.referenced_by.push(reference);
      }
    }
  }
  return [...merged.values()].sort((left, right) =>
    String(left.source_url ?? left.source_id).localeCompare(
      String(right.source_url ?? right.source_id),
    ),
  );
}

async function run() {
  const previousManifestPath = path.join(cacheRoot, "manifest.json");
  let previousManifest;
  try {
    previousManifest = JSON.parse(await readFile(previousManifestPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw new Error(`Cannot read cache manifest ${previousManifestPath}`, {
        cause: error,
      });
    }
  }

  const doFullExport = fullExport || !previousManifest;
  const fetched = {};
  for (const resourceType of resourceTypes) {
    const checkpoint = previousManifest?.resources?.[resourceType]?.last_modified_gmt;
    const modifiedAfter = doFullExport ? undefined : checkpointSince(checkpoint);
    fetched[resourceType] = await fetchCollection(resourceType, modifiedAfter);
  }
  const feedItems = await fetchPodcastFeed();
  const downloadedAt = new Date().toISOString();

  const cachedRecords = {};
  const updatedRecords = {};
  for (const resourceType of resourceTypes) {
    cachedRecords[resourceType] = doFullExport
      ? []
      : await readCachedRecords(resourceType);
    if (
      !doFullExport &&
      cachedRecords[resourceType].length !==
        previousManifest.resources[resourceType].published_count
    ) {
      throw new Error(
        `Cached ${resourceType} count does not match manifest; run a full export to repair the cache`,
      );
    }
    const previousById = new Map(
      cachedRecords[resourceType].map((record) => [record.id, record]),
    );
    const normalized = fetched[resourceType].items.map((item) =>
      normalizeRecord(item, resourceType),
    );
    updatedRecords[resourceType] = doFullExport
      ? normalized
      : normalized.filter(
          (record) =>
            previousById.get(record.id)?.source_hash !== record.source_hash,
        );
  }
  const allRecords = {
    posts: doFullExport
      ? updatedRecords.posts
      : [
          ...cachedRecords.posts.filter(
            (cached) =>
              !updatedRecords.posts.some((updated) => updated.id === cached.id),
          ),
          ...updatedRecords.posts,
        ],
    pages: doFullExport
      ? updatedRecords.pages
      : [
          ...cachedRecords.pages.filter(
            (cached) =>
              !updatedRecords.pages.some((updated) => updated.id === cached.id),
          ),
          ...updatedRecords.pages,
        ],
  };
  const ignoredItems = feedItems.filter(
    (item) =>
      explicitlyIgnoredOldestFeedIds.has(item.id) ||
      explicitlyIgnoredSelectedFeedIds.has(item.id) ||
      /cachekompott/i.test(item.title),
  );
  const ignoredReasons = new Map(
    ignoredItems.map((item) => [
      item.id,
      explicitlyIgnoredOldestFeedIds.has(item.id)
        ? "explicit_oldest_feed_entries_exclusion"
        : explicitlyIgnoredSelectedFeedIds.has(item.id)
          ? "explicit_selected_feed_item_exclusion"
          : "cachekompott_excluded_by_editorial_rule",
    ]),
  );
  const ignoredItemIds = new Set(ignoredItems.map((item) => item.id));
  const { matches, unmatched, ambiguous } = mapFeedToPosts(
    feedItems.filter((item) => !ignoredItemIds.has(item.id)),
    allRecords.posts,
  );
  const podcastArticles = feedItems
    .filter(
      (item) =>
        unmatched.includes(item.id) && !ignoredItemIds.has(item.id),
    )
    .map(toPodcastArticle)
    .filter(Boolean);
  const podcastArticleIds = new Set(podcastArticles.map((article) => article.id));
  const unresolvedItems = feedItems.filter(
    (item) =>
      unmatched.includes(item.id) &&
      !podcastArticleIds.has(item.id) &&
      !ignoredItemIds.has(item.id),
  );
  const cachedPodcastArticles = await readPodcastArticles();
  const previousPodcastArticles = new Map(
    cachedPodcastArticles.map((article) => [article.id, article]),
  );
  const changedPodcastArticles = podcastArticles.filter(
    (article) =>
      previousPodcastArticles.get(article.id)?.source_hash !==
      article.source_hash,
  );

  const itemsByPostId = new Map();
  for (const item of feedItems) {
    for (const postId of matches.get(item.id) ?? []) {
      const matched = itemsByPostId.get(postId) ?? [];
      matched.push({
        id: item.id,
        guid: item.guid,
        title: item.title,
        link: item.link,
        pub_date: item.pub_date,
        enclosure: item.enclosure,
        duration: item.duration,
        source_hash: item.source_hash,
      });
      itemsByPostId.set(postId, matched);
    }
  }
  const feedUpdatedPostIds = new Set();
  for (const post of allRecords.posts) {
    const podcastFeed = (itemsByPostId.get(post.id) ?? []).sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    const previousHash = post.podcast_feed_hash;
    const nextHash = hash(JSON.stringify(podcastFeed));
    if (previousHash !== nextHash) {
      post.podcast_feed = podcastFeed;
      post.podcast_feed_hash = nextHash;
      feedUpdatedPostIds.add(post.id);
    }
  }

  const cachedPosts = allRecords.posts;
  const cachedPages = allRecords.pages;
  const assets = newAssetManifest(
    [...cachedPosts, ...cachedPages],
    feedItems,
    matches,
  );
  const attachmentIds = new Set();
  for (const record of [...cachedPosts, ...cachedPages]) {
    if (record.featured_media) attachmentIds.add(record.featured_media);
    for (const url of extractAssetUrls(record.content?.rendered)) {
      const match = /^wordpress-attachment-id:(\d+)$/.exec(url);
      if (match) attachmentIds.add(Number(match[1]));
    }
  }
  const attachments = await fetchAttachments([...attachmentIds]);
  enrichAttachmentAssets(assets, attachments);
  const assetManifest = mergeAssetsByUrl(assets);
  const missingAttachmentCount = assetManifest.filter(
    (asset) => asset.metadata_status === "not_found_in_public_api",
  ).length;

  const resourceManifest = {};
  for (const resourceType of resourceTypes) {
    const cachedRecords =
      resourceType === "posts" ? cachedPosts : cachedPages;
    const oldCheckpoint =
      previousManifest?.resources?.[resourceType]?.last_modified_gmt;
    resourceManifest[resourceType] = {
      published_count: cachedRecords.length,
      fetched_count: fetched[resourceType].items.length,
      changed_count: updatedRecords[resourceType].length,
      last_modified_gmt: getModifiedCheckpoint(
        cachedRecords,
        oldCheckpoint,
        doFullExport,
      ),
      delta_overlap_minutes: doFullExport
        ? 0
        : overlapMilliseconds / 60_000,
    };
  }

  const outputManifest = {
    schema_version: 1,
    source: wordpressUrl,
    podcast_feed_url: podcastFeedUrl,
    exported_at: downloadedAt,
    mode: doFullExport ? "full" : "delta",
    resources: resourceManifest,
    podcast_feed: {
      item_count: feedItems.length,
      matched_item_count: matches.size,
      rss_only_article_count: podcastArticles.length,
      ignored_item_count: ignoredItems.length,
      ignored_selected_exception_count: ignoredItems.filter((item) =>
        explicitlyIgnoredSelectedFeedIds.has(item.id),
      ).length,
      ignored_oldest_entry_count: ignoredItems.filter((item) =>
        explicitlyIgnoredOldestFeedIds.has(item.id),
      ).length,
      ignored_cachekompott_count: ignoredItems.filter(
        (item) =>
          !explicitlyIgnoredOldestFeedIds.has(item.id) &&
          !explicitlyIgnoredSelectedFeedIds.has(item.id),
      ).length,
      unresolved_item_count: unresolvedItems.length,
      ambiguous_item_count: ambiguous.length,
      snapshot: "podcast-feed.json",
      rss_only_articles: "podcast-articles/",
    },
    assets: {
      count: assetManifest.length,
      attachment_metadata_missing: missingAttachmentCount,
      manifest: "assets/manifest.json",
      binary_files_downloaded: 0,
    },
  };

  console.log(
    `${doFullExport ? "Full" : "Incremental"} export from ${wordpressUrl}`,
  );
  for (const resourceType of resourceTypes) {
    const result = fetched[resourceType];
    console.log(
      `  ${resourceType}: ${result.items.length} fetched; ${updatedRecords[resourceType].length} changed; ${resourceManifest[resourceType].published_count} published in cache`,
    );
  }
  console.log(
    `  podcast RSS: ${feedItems.length} entries; ${matches.size} matched to posts; ${podcastArticles.length} RSS-only Stammtisch articles; ${ignoredReasons.size} ignored (${ignoredItems.filter((item) => explicitlyIgnoredOldestFeedIds.has(item.id)).length} old entries, ${ignoredItems.filter((item) => explicitlyIgnoredSelectedFeedIds.has(item.id)).length} selected exclusions, ${ignoredItems.filter((item) => !explicitlyIgnoredOldestFeedIds.has(item.id) && !explicitlyIgnoredSelectedFeedIds.has(item.id)).length} Cachekompott); ${unresolvedItems.length} unresolved; ${ambiguous.length} ambiguous`,
  );
  console.log(
    `  assets: ${assetManifest.length} metadata records; no binaries downloaded`,
  );
  if (ambiguous.length) {
    console.warn(
      `  WARNING: ${ambiguous.length} RSS entries match multiple WordPress posts; see podcast-feed.json`,
    );
  }
  if (unresolvedItems.length) {
    console.warn(
      `  WARNING: ${unresolvedItems.length} RSS entries are not yet mapped to a post or RSS-only article; they remain metadata-only`,
    );
  }
  if (missingAttachmentCount) {
    console.warn(
      `  WARNING: metadata is unavailable for ${missingAttachmentCount} WordPress attachments`,
    );
  }
  if (dryRun) {
    console.log("Dry run: cache files were not written.");
    return;
  }

  for (const resourceType of resourceTypes) {
    await writeFetchedRecords(resourceType, updatedRecords[resourceType]);
  }
  for (const article of changedPodcastArticles) {
    await writeJsonAtomic(podcastArticleFile(article.id), article);
  }
  await removeStalePodcastArticles(
    new Set(podcastArticles.map((article) => article.id)),
  );
  if (doFullExport) {
    for (const resourceType of resourceTypes) {
      await removeStaleRecords(
        resourceType,
        new Set(updatedRecords[resourceType].map((record) => record.id)),
      );
    }
  }
  for (const post of allRecords.posts) {
    if (feedUpdatedPostIds.has(post.id)) {
      await writeJsonAtomic(recordFile("posts", post.id), post);
    }
  }

  await writeJsonAtomic(
    path.join(cacheRoot, "podcast-feed.json"),
    {
      schema_version: 1,
      source_url: podcastFeedUrl,
      fetched_at: downloadedAt,
      item_count: feedItems.length,
      rss_only_article_ids: [...podcastArticleIds],
      ignored_item_ids: [...ignoredItemIds],
      ignored_items: ignoredItems.map(({ id, title, pub_date }) => ({
        id,
        title,
        pub_date,
        reason: ignoredReasons.get(id),
      })),
      unresolved_item_ids: unresolvedItems.map((item) => item.id),
      unresolved_items: unresolvedItems
        .map(({ id, title, pub_date, guid, enclosure }) => ({
          id,
          title,
          pub_date,
          guid: redactedUrl(guid) ?? guid,
          enclosure: enclosure
            ? {
                ...enclosure,
                url: redactedUrl(enclosure.url),
              }
            : undefined,
        })),
      ambiguous_matches: ambiguous,
      items: feedItems.map((item) => ({
        ...item,
        link: redactedUrl(item.link),
        guid: redactedUrl(item.guid) ?? item.guid,
        enclosure: item.enclosure
          ? {
              ...item.enclosure,
              url: redactedUrl(item.enclosure.url),
            }
          : undefined,
      })),
    },
  );
  await writeJsonAtomic(path.join(cacheRoot, "assets/manifest.json"), {
    schema_version: 1,
    generated_at: downloadedAt,
    count: assetManifest.length,
    assets: assetManifest,
  });
  await writeJsonAtomic(previousManifestPath, outputManifest);
  console.log(`Cache written to ${path.relative(process.cwd(), cacheRoot)}`);
}

async function removeStalePodcastArticles(validIds) {
  const directory = path.join(cacheRoot, "podcast-articles");
  let files;
  try {
    files = await readdir(directory);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const filename of files) {
    const match = /^([a-f0-9]{64})\.json$/.exec(filename);
    if (match && !validIds.has(match[1])) {
      await rm(path.join(directory, filename));
    }
  }
}

async function fetchAttachments(ids) {
  const attachments = new Map();
  for (let start = 0; start < ids.length; start += 50) {
    const batch = ids.slice(start, start + 50);
    const endpoint = new URL(
      `/wp-json/wp/v2/media`,
      `${wordpressUrl}/`,
    );
    endpoint.searchParams.set("include", batch.join(","));
    endpoint.searchParams.set("per_page", "100");
    endpoint.searchParams.set(
      "_fields",
      "id,date,slug,link,source_url,alt_text,caption,media_type,mime_type,media_details,post",
    );
    const response = await fetchWithRetry(endpoint);
    const items = await readJsonResponse(response, endpoint);
    if (!Array.isArray(items)) {
      throw new Error(`Expected media array from ${endpoint}`);
    }
    for (const item of items) attachments.set(item.id, item);
  }
  return attachments;
}

function enrichAttachmentAssets(assets, attachments) {
  const byAttachmentId = new Map(
    assets
      .filter((asset) => asset.source_type === "wordpress_attachment")
      .map((asset) => [asset.source_id, asset]),
  );
  for (const [id, attachment] of attachments) {
    const asset = byAttachmentId.get(id);
    if (!asset) continue;
    asset.source_url = redactedUrl(attachment.source_url);
    asset.file_name = filenameFromUrl(attachment.source_url);
    asset.mime_type = attachment.mime_type;
    asset.size_bytes = attachment.media_details?.filesize;
    asset.metadata_status = "available";
    asset.alt_text = xmlText(attachment.alt_text);
    asset.attachment_link = safeUrl(attachment.link);
  }
  for (const [id, asset] of byAttachmentId) {
    if (!attachments.has(id)) {
      asset.metadata_status = "not_found_in_public_api";
    }
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
