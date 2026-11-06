import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const definitionsRoot = path.join(root, 'storyblok');
const pageSize = 1000;
const minimumRequestInterval = 350;
const maxAttempts = 5;

function usage() {
  console.log(`Usage:
  pnpm storyblok:check
  pnpm storyblok:deploy -- [--dry-run] [--publish]

Required environment variables for API access:
  STORYBLOK_SPACE_ID
  STORYBLOK_MANAGEMENT_TOKEN
Optional:
  STORYBLOK_MANAGEMENT_API_URL (default: https://mapi.storyblok.com/v1)`);
}

function parseArgs(args) {
  const options = { check: false, dryRun: false, publish: false };
  for (const arg of args) {
    if (arg === '--') continue;
    if (arg === '--check') options.check = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--publish') options.publish = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (options.check && (options.dryRun || options.publish)) {
    throw new Error('--check cannot be combined with --dry-run or --publish.');
  }
  return options;
}

async function readJsonFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await readJsonFiles(filePath));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      files.push(filePath);
    }
  }
  return files;
}

async function loadDefinitions() {
  const componentFiles = await readJsonFiles(path.join(definitionsRoot, 'components'));
  const storyFiles = await readJsonFiles(path.join(definitionsRoot, 'stories'));
  const components = [];
  const stories = [];

  for (const filePath of componentFiles) {
    const relativePath = path.relative(path.join(definitionsRoot, 'components'), filePath);
    const definition = await parseJson(filePath);
    if (!isRecord(definition) || !isComponentName(definition.name)) {
      throw new Error(`${filePath}: expected a valid component name.`);
    }
    if (path.basename(relativePath, '.json') !== definition.name) {
      throw new Error(`${filePath}: filename must match component.name "${definition.name}".`);
    }
    components.push({ filePath, definition });
  }

  for (const filePath of storyFiles) {
    const relativePath = path.relative(path.join(definitionsRoot, 'stories'), filePath);
    const fullSlug = relativePath.slice(0, -'.json'.length).split(path.sep).join('/');
    stories.push({ filePath, fullSlug, definition: await parseJson(filePath) });
  }

  return { components, stories };
}

async function parseJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${filePath}: ${error.message}`, { cause: error });
  }
}

function validateDefinitions({ components, stories }) {
  if (components.length === 0) {
    throw new Error('No component definitions found under storyblok/components/.');
  }

  const componentNames = new Set();
  for (const { filePath, definition } of components) {
    if (!isRecord(definition) || !isComponentName(definition.name) || !isRecord(definition.schema)) {
      throw new Error(`${filePath}: expected a component name and schema object.`);
    }
    if (componentNames.has(definition.name)) {
      throw new Error(`Duplicate component name "${definition.name}".`);
    }
    componentNames.add(definition.name);
  }

  const storySlugs = new Set();
  for (const { filePath, fullSlug, definition } of stories) {
    if (!fullSlug.split('/').every(isSlug)) {
      throw new Error(`${filePath}: path segments must use lowercase letters, digits, and hyphens.`);
    }
    if (storySlugs.has(fullSlug)) throw new Error(`Duplicate story full_slug "${fullSlug}".`);
    storySlugs.add(fullSlug);
    if (!isRecord(definition) || typeof definition.name !== 'string' || !definition.name.trim()) {
      throw new Error(`${filePath}: expected a non-empty name.`);
    }
    if (!isRecord(definition.content) || !isComponentName(definition.content.component)) {
      throw new Error(`${filePath}: content must have a component name.`);
    }
    validateContentComponents(definition.content, componentNames, filePath, true);
  }

  return { componentCount: components.length, storyCount: stories.length };
}

function validateContentComponents(value, componentNames, filePath, isRoot = false) {
  if (Array.isArray(value)) {
    for (const item of value) validateContentComponents(item, componentNames, filePath);
    return;
  }
  if (!isRecord(value)) return;

  if (typeof value.component === 'string') {
    if (!componentNames.has(value.component)) {
      throw new Error(`${filePath}: unknown component "${value.component}".`);
    }
    if (!isRoot && typeof value._uid !== 'string') {
      throw new Error(`${filePath}: nested component "${value.component}" requires a stable _uid.`);
    }
  }
  for (const child of Object.values(value)) validateContentComponents(child, componentNames, filePath);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSlug(value) {
  return typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function isComponentName(value) {
  return typeof value === 'string' && /^[a-z][a-z0-9_]*$/.test(value);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (!isRecord(value)) return JSON.stringify(value);
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function componentMatches(remote, desired) {
  for (const [key, value] of Object.entries(desired)) {
    if (key === 'schema') {
      if (!isRecord(remote.schema) || !sameKeys(remote.schema, value)) return false;
      for (const [field, fieldDefinition] of Object.entries(value)) {
        const remoteField = remote.schema[field];
        if (!isRecord(remoteField) || !isRecord(fieldDefinition)) return false;
        const remoteManagedField = Object.fromEntries(
          Object.entries(remoteField).filter(([fieldKey]) => fieldKey !== 'id'),
        );
        if (stableStringify(remoteManagedField) !== stableStringify(fieldDefinition)) return false;
      }
    } else if (stableStringify(remote[key]) !== stableStringify(value)) {
      return false;
    }
  }
  return true;
}

function sameKeys(left, right) {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return stableStringify(leftKeys) === stableStringify(rightKeys);
}

function storyMatches(remote, desiredStory) {
  const { definition, slug, parentId } = desiredStory;
  if (remote.name !== definition.name || remote.slug !== slug || remote.parent_id !== parentId || remote.is_folder) {
    return false;
  }
  if (stableStringify(remote.content) !== stableStringify(definition.content)) return false;
  if ('is_startpage' in definition && remote.is_startpage !== definition.is_startpage) return false;
  return true;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryDelay(response, attempt) {
  const retryAfter = response?.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const retryAt = Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) return Math.max(0, retryAt - Date.now());
  }
  return 500 * (2 ** attempt);
}

function getApiConfig() {
  const spaceId = process.env.STORYBLOK_SPACE_ID;
  const token = process.env.STORYBLOK_MANAGEMENT_TOKEN;
  if (!spaceId || !/^\d+$/.test(spaceId)) {
    throw new Error('Set STORYBLOK_SPACE_ID to the numeric ID of the target Storyblok space.');
  }
  if (!token) throw new Error('Set STORYBLOK_MANAGEMENT_TOKEN before accessing the Management API.');

  const apiUrl = (process.env.STORYBLOK_MANAGEMENT_API_URL || 'https://mapi.storyblok.com/v1').replace(/\/+$/, '');
  const parsedUrl = new URL(apiUrl);
  if (parsedUrl.protocol !== 'https:') throw new Error('STORYBLOK_MANAGEMENT_API_URL must use HTTPS.');
  return { spaceId, token, apiUrl };
}

function createApi({ spaceId, token, apiUrl }) {
  let lastRequestAt = 0;
  const baseUrl = `${apiUrl}/spaces/${spaceId}`;

  return async function request(endpoint, options = {}) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const waitFor = minimumRequestInterval - (Date.now() - lastRequestAt);
      if (waitFor > 0) await sleep(waitFor);
      lastRequestAt = Date.now();

      let response;
      try {
        response = await fetch(`${baseUrl}${endpoint}`, {
          method: options.method || 'GET',
          headers: {
            Authorization: token,
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(options.body ? { body: JSON.stringify(options.body) } : {}),
        });
      } catch (error) {
        if (attempt === maxAttempts - 1) {
          throw new Error(`Management API request failed for ${endpoint}: ${error.message}`, { cause: error });
        }
        await sleep(retryDelay(null, attempt));
        continue;
      }

      if (response.ok) {
        if (response.status === 204) return null;
        try {
          return await response.json();
        } catch (error) {
          throw new Error(`Management API returned invalid JSON for ${endpoint}.`, { cause: error });
        }
      }

      const details = (await response.text()).slice(0, 500);
      if ((response.status === 429 || response.status >= 500) && attempt < maxAttempts - 1) {
        await sleep(retryDelay(response, attempt));
        continue;
      }
      throw new Error(`Management API ${options.method || 'GET'} ${endpoint} failed (${response.status}): ${details}`);
    }
    throw new Error(`Management API request exhausted retries for ${endpoint}.`);
  };
}

async function getAll(api, endpoint, property) {
  const entries = [];
  for (let page = 1; ; page += 1) {
    const query = new URLSearchParams({ page: String(page), per_page: String(pageSize) });
    const response = await api(`${endpoint}?${query}`);
    if (!Array.isArray(response?.[property])) {
      throw new Error(`Management API response for ${endpoint} did not include a ${property} array.`);
    }
    entries.push(...response[property]);
    if (response[property].length < pageSize) return entries;
  }
}

function printChange(action, resource, identifier, dryRun) {
  console.log(`${dryRun ? 'Would ' : ''}${action} ${resource}: ${identifier}`);
}

async function deployComponents(api, components, dryRun) {
  const currentComponents = await getAll(api, '/components/', 'components');
  const byName = new Map(currentComponents.map((component) => [component.name, component]));

  for (const { definition } of components) {
    const current = byName.get(definition.name);
    if (current && componentMatches(current, definition)) continue;
    if (current) {
      printChange('update', 'component', definition.name, dryRun);
      if (!dryRun) {
        await api(`/components/${current.id}`, {
          method: 'PUT',
          body: { component: { ...definition, id: current.id } },
        });
      }
    } else {
      printChange('create', 'component', definition.name, dryRun);
      if (!dryRun) {
        const response = await api('/components/', { method: 'POST', body: { component: definition } });
        if (!response?.component?.id) {
          throw new Error(`Management API did not return the created component "${definition.name}".`);
        }
        byName.set(definition.name, response.component);
      }
    }
  }
}

function folderName(slug) {
  return slug.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

async function ensureParentFolders(api, storyPath, byFullSlug, dryRun, virtualIds) {
  let parentId = 0;
  let parentSlug = '';
  const segments = storyPath.split('/');

  for (const segment of segments.slice(0, -1)) {
    parentSlug = parentSlug ? `${parentSlug}/${segment}` : segment;
    let folder = byFullSlug.get(parentSlug);
    if (folder && !folder.is_folder) {
      throw new Error(`Cannot create story under "${parentSlug}": that slug is not a folder.`);
    }
    if (!folder) {
      printChange('create', 'folder', parentSlug, dryRun);
      if (dryRun) {
        folder = { id: virtualIds.next, is_folder: true };
        virtualIds.next -= 1;
      } else {
        const response = await api('/stories', {
          method: 'POST',
          body: {
            story: {
              name: folderName(segment),
              slug: segment,
              parent_id: parentId,
              is_folder: true,
            },
          },
        });
        folder = response?.story;
        if (!folder?.id) throw new Error(`Management API did not return the created folder "${parentSlug}".`);
        byFullSlug.set(parentSlug, folder);
      }
    }
    parentId = folder.id;
  }

  return parentId;
}

async function deployStories(api, stories, dryRun, publish) {
  const currentStories = await getAll(api, '/stories', 'stories');
  const byFullSlug = new Map(currentStories.map((story) => [story.full_slug, story]));
  const virtualIds = { next: -1 };

  for (const item of stories) {
    const parentId = await ensureParentFolders(api, item.fullSlug, byFullSlug, dryRun, virtualIds);
    const slug = item.fullSlug.split('/').at(-1);
    const desiredStory = { ...item, slug, parentId };
    const current = byFullSlug.get(item.fullSlug);
    if (current && current.is_folder) {
      throw new Error(`Cannot deploy story at "${item.fullSlug}": that slug is a folder.`);
    }
    if (current && storyMatches(current, desiredStory)) continue;

    const story = {
      name: item.definition.name,
      slug,
      parent_id: parentId,
      is_folder: false,
      content: item.definition.content,
      ...(item.definition.is_startpage === undefined ? {} : { is_startpage: item.definition.is_startpage }),
    };

    if (current) {
      printChange('update', 'story', item.fullSlug, dryRun);
      if (!dryRun) {
        await api(`/stories/${current.id}`, {
          method: 'PUT',
          body: { story: { ...story, id: current.id }, publish },
        });
      }
    } else {
      printChange('create', 'story', item.fullSlug, dryRun);
      if (!dryRun) {
        const response = await api('/stories', {
          method: 'POST',
          body: { story, publish },
        });
        if (!response?.story?.id) throw new Error(`Management API did not return the created story "${item.fullSlug}".`);
        byFullSlug.set(item.fullSlug, response.story);
      }
    }
  }
}

async function main(args) {
  const options = parseArgs(args);
  if (options.help) {
    usage();
    return;
  }

  const definitions = await loadDefinitions();
  const counts = validateDefinitions(definitions);
  if (options.check) {
    console.log(`Validated ${counts.componentCount} component(s) and ${counts.storyCount} story/stories.`);
    return;
  }

  const api = createApi(getApiConfig());
  await deployComponents(api, definitions.components, options.dryRun);
  await deployStories(api, definitions.stories, options.dryRun, options.publish);
  console.log(options.dryRun ? 'Dry-run complete; no API writes were made.' : 'Storyblok sync complete.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
