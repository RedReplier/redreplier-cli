import { readFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';

import type { Command } from 'commander';

import {
  analyzeWebsiteDescription,
  countMentions,
  createWebsite,
  deleteWebsite,
  getWebsite,
  listWebsites,
  updateWebsite,
} from '../api/client.js';
import {
  MAX_WEBSITE_DESCRIPTION_LENGTH,
  MENTION_STATUSES,
  type Keyword,
  type KeywordStatus,
  type Website,
} from '../api/types.js';
import {
  CliError,
  ExitCode,
  PRODUCT,
  envVar,
  failure,
  formatAbsolute,
  formatId,
  formatRelative,
  hint,
  isMachine,
  isQuiet,
  print,
  printFieldHints,
  printKeyValues,
  printResult,
  printTable,
  promptConfirm,
  promptText,
  spinner,
  success,
  usageError,
  warn,
  type Column,
} from '../core/index.js';
import { collectKeyword, normalizeKeywords } from './keyword.js';

const STATUS_ORDER: KeywordStatus[] = ['ACTIVE', 'PENDING', 'DISABLED', 'SUSPENDED'];

export function keywordCounts(website: Website): Record<KeywordStatus, number> {
  const counts: Record<KeywordStatus, number> = {
    ACTIVE: 0,
    PENDING: 0,
    DISABLED: 0,
    SUSPENDED: 0,
  };
  for (const keyword of website.keywords) counts[keyword.status] += 1;
  return counts;
}

export function describeKeywords(website: Website): string {
  const counts = keywordCounts(website);
  const parts = STATUS_ORDER.filter((status) => counts[status] > 0).map(
    (status) => `${counts[status]} ${status.toLowerCase()}`,
  );
  return parts.length === 0 ? 'none' : parts.join(', ');
}

export function assertWebsiteUrl(value: string, flag = '--url'): string {
  const text = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw usageError(
      `${flag} must be a full URL, got "${value}"`,
      `${PRODUCT.binName} site create --url https://acme.com`,
    );
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw usageError(`${flag} must be an http or https URL, got "${value}"`);
  }
  return text;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

export async function readDescription(value: string): Promise<string> {
  const source = value === '-' ? await readStdin() : value.startsWith('@') ? await readTextFile(value.slice(1)) : value;
  const description = source.trim();
  if (description.length > MAX_WEBSITE_DESCRIPTION_LENGTH) {
    throw usageError(
      `--description is ${description.length} characters, the limit is ${MAX_WEBSITE_DESCRIPTION_LENGTH}`,
    );
  }
  return description;
}

async function readTextFile(path: string): Promise<string> {
  try {
    return await readFile(resolvePath(path), 'utf8');
  } catch (error) {
    throw new CliError(`Cannot read ${path}: ${(error as Error).message}`, {
      exitCode: ExitCode.USAGE,
      cause: error,
    });
  }
}

const LIST_COLUMNS: Column<Website>[] = [
  { header: 'ID', value: (website) => formatId(website.id) },
  { header: 'DOMAIN', value: (website) => website.domain },
  { header: 'NAME', value: (website) => website.name || '—' },
  { header: 'KEYWORDS', value: (website) => describeKeywords(website) },
  { header: 'DESCRIPTION', value: (website) => (website.description ? 'yes' : 'missing') },
];

const KEYWORD_COLUMNS: Column<Keyword>[] = [
  { header: 'ID', value: (keyword) => formatId(keyword.id) },
  { header: 'KEYWORD', value: (keyword) => keyword.value },
  { header: 'STATUS', value: (keyword) => keyword.status },
  {
    header: 'ADDED',
    value: (keyword) => (keyword.createdAt ? formatRelative(new Date(keyword.createdAt)) : '—'),
  },
];

async function withProgress<T>(label: string, operation: () => Promise<T>): Promise<T> {
  const progress = isQuiet() || isMachine() ? null : spinner(label);
  try {
    return await operation();
  } finally {
    progress?.stop();
  }
}

async function runList(): Promise<void> {
  const { websites } = await withProgress('Loading sites…', listWebsites);

  if (isMachine()) {
    printResult('site.list', websites, { total: websites.length, hasMore: false });
    printFieldHints(websites);
    return;
  }

  if (websites.length === 0) {
    print('No sites yet.');
    hint(`add one: ${PRODUCT.binName} site create --url https://acme.com -k "your keyword"`);
    return;
  }

  printTable(websites, LIST_COLUMNS);
  print('');
  print(`${websites.length} ${websites.length === 1 ? 'site' : 'sites'}`);

  for (const website of websites) {
    if (website.description) continue;
    warn(`${website.domain} has no description. Its mentions are not scored.`);
    hint(`  fix: ${PRODUCT.binName} site analyze --url ${website.url}`);
  }

  const pending = websites.reduce((total, website) => total + keywordCounts(website).PENDING, 0);
  hint('Listing sites activates any PENDING keyword that fits your plan’s free headroom.');
  if (pending > 0) {
    hint(
      `${pending} keyword${pending === 1 ? '' : 's'} still PENDING, there was no free slot. Price an upgrade: ${PRODUCT.binName} keyword plan`,
    );
  }
}

async function runGet(id: string): Promise<void> {
  const website = await withProgress('Loading site…', () => getWebsite(id));

  if (isMachine()) {
    printResult('site.get', website);
    return;
  }

  print(website.id);
  printKeyValues([
    ['domain', website.domain],
    ['url', website.url],
    ['name', website.name || '—'],
    [
      'description',
      website.description ? `${website.description.length} characters` : 'missing, mentions are not scored',
    ],
    ['keywords', describeKeywords(website)],
    [
      'created',
      website.createdAt ? formatAbsolute(new Date(website.createdAt), { timezone: 'UTC' }) : '—',
    ],
  ]);

  if (website.keywords.length > 0) {
    print('');
    printTable(website.keywords, KEYWORD_COLUMNS);
  }

  if (!website.description) {
    print('');
    hint(`fix: ${PRODUCT.binName} site analyze --url ${website.url}`);
  }
}

interface CreateOptions {
  url: string;
  name?: string;
  keyword: string[];
  description?: string;
  analyze?: boolean;
  yes?: boolean;
}

async function runCreate(options: CreateOptions): Promise<void> {
  const url = assertWebsiteUrl(options.url);
  const keywords = normalizeKeywords(options.keyword);
  const description =
    options.description === undefined ? undefined : await readDescription(options.description);

  let body: Parameters<typeof createWebsite>[0];

  if (description !== undefined) {
    body = { url, keywords, description, ...(options.name ? { name: options.name } : {}) };
  } else if (options.analyze === false) {
    body = { url, keywords, description: '', ...(options.name ? { name: options.name } : {}) };
    warn('--no-analyze sends an empty description, so nothing this site collects will be scored.');
  } else {
    const domain = new URL(url).hostname;
    warn(
      `No --description given. The server will scrape ${domain} and spend one AI generation from this month’s quota.`,
    );
    if (!isMachine()) {
      const proceed = await promptConfirm('Continue?', {
        assumeYes: options.yes === true,
        initialValue: true,
      });
      if (!proceed) throw new CliError('Cancelled.', { exitCode: ExitCode.CANCELLED });
    }
    body = { url, keywords, ...(options.name ? { name: options.name } : {}) };
  }

  const website = await withProgress('Creating site…', () => createWebsite(body));

  if (isMachine()) {
    printResult('site.create', website);
    return;
  }

  success(`Created ${formatId(website.id)}  ${website.domain}`);
  printKeyValues([
    [
      'description',
      website.description
        ? `${description === undefined ? 'generated' : 'stored'} (${website.description.length} chars)`
        : 'missing',
    ],
    ['keywords', describeKeywords(website)],
  ]);

  if (!website.description && options.analyze !== false) {
    print('');
    failure(
      'Description generation failed. Mentions will be unscored ("Scoring skipped: website description missing").',
    );
    hint(`retry: ${PRODUCT.binName} site analyze --url ${website.url}`);
  }

  if (keywordCounts(website).PENDING > 0) {
    hint(`Some keywords are PENDING. Price an upgrade: ${PRODUCT.binName} keyword plan`);
  }
}

interface UpdateOptions {
  name?: string;
  description?: string;
}

async function runUpdate(id: string, options: UpdateOptions): Promise<void> {
  const body: Parameters<typeof updateWebsite>[1] = {};
  if (options.name !== undefined) body.name = options.name;
  if (options.description !== undefined) body.description = await readDescription(options.description);

  if (Object.keys(body).length === 0) {
    throw usageError('Nothing to update.', 'Pass --name, --description, or both');
  }

  const website = await withProgress('Updating site…', () => updateWebsite(id, body));

  if (isMachine()) {
    printResult('site.update', website);
    return;
  }

  success(`Updated ${formatId(website.id)}  ${website.domain}`);
  printKeyValues([
    ['name', website.name || '—'],
    ['description', website.description ? `${website.description.length} characters` : 'missing'],
  ]);
  print('Existing mentions are not rescored.');
}

async function runDelete(id: string, options: { yes?: boolean }): Promise<void> {
  const website = await withProgress('Loading site…', () => getWebsite(id));
  const { total } = await countMentions({
    websiteId: website.id,
    statuses: [...MENTION_STATUSES],
    includeLowRelevance: true,
  });

  if (options.yes !== true) {
    print(
      `This deletes ${website.domain}, its ${website.keywords.length} keyword${
        website.keywords.length === 1 ? '' : 's'
      } and ${total} collected mention${total === 1 ? '' : 's'}.`,
    );
    const typed = await promptText('Type the domain to confirm', {
      hint: `Pass --yes to delete without typing the domain`,
    });
    if (typed.trim() !== website.domain) {
      throw new CliError(`That is not "${website.domain}", nothing was deleted.`, {
        exitCode: ExitCode.CANCELLED,
      });
    }
  }

  const deleted = await deleteWebsite(website.id);

  if (isMachine()) {
    printResult('site.delete', deleted);
    return;
  }

  success('Deleted');
}

async function runAnalyze(options: { url: string; yes?: boolean }): Promise<void> {
  const url = assertWebsiteUrl(options.url);

  warn(
    'This spends one AI generation from this month’s quota unless a precomputed description exists for the domain. A failed generation is refunded.',
  );
  if (!isMachine()) {
    const proceed = await promptConfirm('Continue?', {
      assumeYes: options.yes === true,
      initialValue: true,
    });
    if (!proceed) throw new CliError('Cancelled.', { exitCode: ExitCode.CANCELLED });
  }

  const { description } = await withProgress('Analysing…', () =>
    analyzeWebsiteDescription({ url }),
  );

  if (isMachine()) {
    printResult('site.analyze', { description });
    return;
  }

  process.stdout.write(`${description}\n`);
  hint(
    `store it: ${envVar('FORCE_TTY')}=1 ${PRODUCT.binName} site analyze --url ${url} | ${PRODUCT.binName} site update <id> --description -`,
  );
}

export function registerSiteCommands(program: Command): void {
  const site = program
    .command('site')
    .alias('sites')
    .description('monitored websites and their keywords');

  site
    .command('list')
    .alias('ls')
    .description('list every monitored site')
    .action(async () => {
      await runList();
    });

  site
    .command('get <id>')
    .alias('view')
    .description('show one site with its full keyword table')
    .action(async (id: string) => {
      await runGet(id);
    });

  site
    .command('create')
    .description('start monitoring a website')
    .requiredOption('--url <url>', 'the website to monitor')
    .option('--name <name>', 'label for the site')
    .option('-k, --keyword <keyword>', 'keyword to watch, repeatable', collectKeyword, [] as string[])
    .option('--description <text>', 'what the site does; @file reads a file, - reads stdin')
    .option('--no-analyze', 'send an empty description and skip the paid scrape')
    .action(async (_options: CreateOptions, command: Command) => {
      await runCreate(command.optsWithGlobals() as CreateOptions);
    });

  site
    .command('update <id>')
    .description('rename a site or replace its description')
    .option('--name <name>', 'new label for the site')
    .option('--description <text>', 'new description; @file reads a file, - reads stdin')
    .action(async (id: string, options: UpdateOptions) => {
      await runUpdate(id, options);
    });

  site
    .command('delete <id>')
    .alias('rm')
    .description('delete a site, its keywords and every mention they produced')
    .action(async (id: string, _options: unknown, command: Command) => {
      await runDelete(id, command.optsWithGlobals() as { yes?: boolean });
    });

  site
    .command('analyze')
    .description('generate a site description from its URL')
    .requiredOption('--url <url>', 'the website to read')
    .action(async (_options: { url: string }, command: Command) => {
      await runAnalyze(command.optsWithGlobals() as { url: string; yes?: boolean });
    });
}
