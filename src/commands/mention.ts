import { spawn } from 'node:child_process';

import type { Command } from 'commander';

import { countMentions, explainMention, listMentions, updateMentionStatus } from '../api/client.js';
import {
  MENTION_LIMIT_MAX,
  MENTION_LIMIT_MIN,
  MENTION_SORTS,
  MENTION_SOURCES,
  MENTION_STATUSES,
  RELEVANCE_BUCKETS,
  type Mention,
  type MentionFilterQuery,
  type MentionSort,
  type MentionSource,
  type MentionStatus,
  type RelevanceBucket,
} from '../api/types.js';
import {
  PRODUCT,
  dim,
  formatAbsolute,
  formatId,
  formatRelative,
  hint,
  isMachine,
  isQuiet,
  notFoundError,
  paginateAll,
  parseWhen,
  poll,
  print,
  printFieldHints,
  printKeyValues,
  printResult,
  printTable,
  profileDefaults,
  spinner,
  success,
  systemTimeZone,
  terminalWidth,
  toIso,
  usageError,
  validateLimit,
  validateOffset,
  warn,
  type Column,
  type Cursor,
} from '../core/index.js';

const DEFAULT_LIMIT = 50;
const SEARCH_PAGES = 20;
const TAIL_INTERVAL_FLOOR_S = 30;
const TAIL_DEFAULT_INTERVAL_S = 60;
const TAIL_MAX_INTERVAL_MS = 300_000;
const TAIL_PAGE_SIZE = 50;

const BUCKET_FLOORS: Array<[floor: number, bucket: RelevanceBucket]> = [
  [75, 'VERY_HIGH'],
  [50, 'HIGH'],
  [30, 'MEDIUM'],
  [10, 'LOW'],
  [0, 'VERY_LOW'],
];

export function relevanceBucketOf(score: number | null): RelevanceBucket | null {
  if (score === null || !Number.isFinite(score)) return null;
  for (const [floor, bucket] of BUCKET_FLOORS) {
    if (score >= floor) return bucket;
  }
  return 'VERY_LOW';
}

export function normalizeStatus(value: string): MentionStatus {
  const status = value.trim().toUpperCase();
  if (!(MENTION_STATUSES as readonly string[]).includes(status)) {
    throw usageError(`Unknown status "${value}"`, `valid statuses: ${MENTION_STATUSES.join(', ')}`);
  }
  return status as MentionStatus;
}

export function normalizeBucket(value: string): RelevanceBucket {
  const bucket = value.trim().toUpperCase().replace(/-/g, '_');
  if (!(RELEVANCE_BUCKETS as readonly string[]).includes(bucket)) {
    throw usageError(`Unknown bucket "${value}"`, `valid buckets: ${RELEVANCE_BUCKETS.join(', ')}`);
  }
  return bucket as RelevanceBucket;
}

export function normalizeSource(value: string): MentionSource {
  const source = value.trim().toUpperCase().replace(/-/g, '_');
  if (!(MENTION_SOURCES as readonly string[]).includes(source)) {
    throw usageError(`Unknown source "${value}"`, `valid sources: ${MENTION_SOURCES.join(', ')}`);
  }
  return source as MentionSource;
}

export function normalizeSort(value: string): MentionSort {
  const sort = value.trim().toUpperCase();
  if (!(MENTION_SORTS as readonly string[]).includes(sort)) {
    throw usageError(`Unknown sort "${value}"`, `valid sorts: ${MENTION_SORTS.join(', ')}`);
  }
  return sort as MentionSort;
}

const collect = (value: string, previous: string[] = []): string[] => [...previous, value];

const collectStatus = (value: string, previous: MentionStatus[] = []): MentionStatus[] => [
  ...previous,
  normalizeStatus(value),
];

const collectBucket = (value: string, previous: RelevanceBucket[] = []): RelevanceBucket[] => [
  ...previous,
  normalizeBucket(value),
];

const collectSource = (value: string, previous: MentionSource[] = []): MentionSource[] => [
  ...previous,
  normalizeSource(value),
];

export interface FilterOptions {
  site?: string;
  status?: MentionStatus[];
  bucket?: RelevanceBucket[];
  includeLow?: boolean;
  keyword?: string[];
  source?: MentionSource[];
  from?: string;
  to?: string;
}

export function buildFilterQuery(options: FilterOptions): MentionFilterQuery {
  const query: MentionFilterQuery = {};
  if (options.site !== undefined && options.site !== '') query.websiteId = options.site;
  if (options.status && options.status.length > 0) query.statuses = options.status;
  if (options.bucket && options.bucket.length > 0) query.scoreBuckets = options.bucket;
  if (options.includeLow === true) query.includeLowRelevance = true;
  if (options.keyword && options.keyword.length > 0) query.keywords = options.keyword;
  if (options.source && options.source.length > 0) query.sources = options.source;
  if (options.from !== undefined) query.from = toIso(parseWhen(options.from));
  if (options.to !== undefined) query.to = toIso(parseWhen(options.to));
  return query;
}

export function resolveSite(site?: string): string | undefined {
  if (site !== undefined && site !== '') return site;
  const fallback = profileDefaults().defaultSite;
  return typeof fallback === 'string' && fallback !== '' ? fallback : undefined;
}

export function sourceLabel(mention: Mention): string {
  return mention.subreddit ? `r/${mention.subreddit}` : mention.source;
}

export function authorLabel(mention: Mention): string {
  if (!mention.author) return '—';
  if (mention.source === 'REDDIT_POST' || mention.source === 'REDDIT_COMMENT') {
    return mention.author.startsWith('u/') ? mention.author : `u/${mention.author}`;
  }
  return mention.author;
}

export function mentionDate(mention: Mention): Date | null {
  const iso = mention.publishedAt ?? mention.ingestedAt ?? mention.createdAt;
  if (iso === null) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

const whenCell = (mention: Mention): string => {
  const date = mentionDate(mention);
  return date === null ? '—' : formatRelative(date);
};

const oneLine = (text: string | null): string => (text ?? '').replace(/\s+/g, ' ').trim() || '—';

const LIST_COLUMNS: Column<Mention>[] = [
  { header: 'SCORE', value: (mention) => mention.relevanceScore ?? '—', align: 'right' },
  { header: 'SOURCE', value: sourceLabel },
  { header: 'WHEN', value: whenCell },
  { header: 'KEYWORD', value: (mention) => mention.keyword || '—' },
  { header: 'TITLE', value: (mention) => oneLine(mention.title ?? mention.contentText) },
];

async function withProgress<T>(label: string, operation: () => Promise<T>): Promise<T> {
  const progress = isQuiet() || isMachine() ? null : spinner(label);
  try {
    return await operation();
  } finally {
    progress?.stop();
  }
}

function wrap(text: string, width: number, indent: string): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line === '') {
      line = word;
      continue;
    }
    if (`${line} ${word}`.length + indent.length > width) {
      lines.push(`${indent}${line}`);
      line = word;
      continue;
    }
    line = `${line} ${word}`;
  }
  if (line !== '') lines.push(`${indent}${line}`);
  return lines;
}

function printParagraph(text: string, indent = '  '): void {
  for (const line of wrap(text, Math.max(40, terminalWidth() - 2), indent)) print(line);
}

interface ListOptions extends FilterOptions {
  sort?: MentionSort;
  limit?: string;
  offset?: string;
  all?: boolean;
  quiet?: boolean;
}

async function hiddenLowRelevance(filters: MentionFilterQuery, total: number): Promise<number> {
  try {
    const { total: withLow } = await countMentions({ ...filters, includeLowRelevance: true });
    return Math.max(0, withLow - total);
  } catch {
    return 0;
  }
}

async function runList(options: ListOptions): Promise<void> {
  const filters = buildFilterQuery({ ...options, site: resolveSite(options.site) });
  const limit = options.limit === undefined
    ? DEFAULT_LIMIT
    : validateLimit(options.limit, MENTION_LIMIT_MIN, MENTION_LIMIT_MAX);
  const offset = validateOffset(options.offset);
  const sort = options.sort;

  let mentions: Mention[];
  let total: number | undefined;
  let hasMore = false;

  if (options.all) {
    const paged = await paginateAll<Mention>({
      pageSize: MENTION_LIMIT_MAX,
      offset,
      quiet: options.quiet === true || isQuiet(),
      fetchPage: async (page) => {
        const response = await listMentions({ ...filters, sort, limit: page.limit, offset: page.offset });
        return {
          items: response.mentions,
          total: response.total,
          hasMore: response.offset + response.mentions.length < response.total,
        };
      },
    });
    mentions = paged.items;
    total = paged.total;
  } else {
    const response = await withProgress('Loading mentions…', () =>
      listMentions({ ...filters, sort, limit, offset }),
    );
    mentions = response.mentions;
    total = response.total;
    hasMore = response.offset + response.mentions.length < response.total;
  }

  if (isMachine()) {
    printResult('mention.list', mentions, {
      total,
      limit: options.all ? undefined : limit,
      offset: options.all ? undefined : offset,
      hasMore,
    });
    printFieldHints(mentions);
    return;
  }

  if (mentions.length === 0) {
    print('No mentions match those filters.');
  } else {
    printTable(mentions, LIST_COLUMNS);
    print('');
    print(`${mentions.length} of ${total ?? mentions.length} · open: ${PRODUCT.binName} mention show <id>`);
    if (hasMore) print(`next: --offset ${offset + mentions.length}`);
  }

  if (!filters.statuses?.includes('REJECTED')) {
    hint('REJECTED mentions are hidden unless you pass --status REJECTED.');
  }
  if (options.includeLow !== true) {
    const hidden = await hiddenLowRelevance(filters, total ?? mentions.length);
    if (hidden > 0) {
      hint(
        `${hidden} mention${hidden === 1 ? '' : 's'} below the site’s minimum score ${
          hidden === 1 ? 'is' : 'are'
        } hidden. Add --include-low.`,
      );
    }
  }
}

async function runCount(options: FilterOptions): Promise<void> {
  const filters = buildFilterQuery({ ...options, site: resolveSite(options.site) });
  const response = await withProgress('Counting mentions…', () => countMentions(filters));

  if (isMachine()) {
    printResult('mention.count', response);
    return;
  }

  print(`${response.total} mention${response.total === 1 ? '' : 's'} match`);
}

async function findMention(id: string, filters: MentionFilterQuery): Promise<Mention | undefined> {
  const query: MentionFilterQuery = {
    ...filters,
    statuses: filters.statuses ?? [...MENTION_STATUSES],
    includeLowRelevance: true,
  };

  for (let page = 0; page < SEARCH_PAGES; page += 1) {
    const offset = page * MENTION_LIMIT_MAX;
    const response = await listMentions({
      ...query,
      sort: 'RECENT',
      limit: MENTION_LIMIT_MAX,
      offset,
    });
    const found = response.mentions.find(
      (mention) => mention.id === id || mention.id.startsWith(id),
    );
    if (found) return found;
    if (response.mentions.length === 0) return undefined;
    if (offset + response.mentions.length >= response.total) return undefined;
  }
  return undefined;
}

function printMention(mention: Mention): void {
  const date = mentionDate(mention);
  const bucket = relevanceBucketOf(mention.relevanceScore);
  const header = [
    sourceLabel(mention),
    date === null ? 'unknown time' : formatRelative(date),
    mention.relevanceScore === null
      ? 'unscored'
      : `score ${mention.relevanceScore}${bucket === null ? '' : ` (${bucket})`}`,
    mention.status,
  ].join(' · ');

  print(header);
  printKeyValues([
    ['id', mention.id],
    ['keyword', mention.keyword || '—'],
    ['author', authorLabel(mention)],
    ['url', mention.url],
    ...(date === null
      ? []
      : [['posted', formatAbsolute(date, { timezone: systemTimeZone() })] as [string, string]]),
    ...(mention.tags.length > 0 ? [['tags', mention.tags.join(', ')] as [string, string]] : []),
  ]);

  if (mention.title) {
    print('');
    printParagraph(mention.title);
  }
  if (mention.contentText) {
    print('');
    printParagraph(mention.contentText);
  }
  if (mention.relevanceReason) {
    print('');
    print(
      dim(
        mention.relevanceScore === null
          ? 'why it was scored'
          : `why it scored ${mention.relevanceScore}`,
      ),
    );
    printParagraph(mention.relevanceReason, '    ');
  }
  if (mention.aiReplySuggestion) {
    print('');
    print(dim('suggested reply'));
    printParagraph(mention.aiReplySuggestion, '    ');
  }
  print('');
  print(`approve: ${PRODUCT.binName} mention status ${mention.id} APPROVED`);
}

async function runShow(id: string, options: FilterOptions & { explain?: boolean }): Promise<void> {
  const mention = options.explain
    ? await withProgress('Explaining mention…', () => explainMention(id))
    : await withProgress('Searching mentions…', () =>
        findMention(id, buildFilterQuery({ ...options, site: resolveSite(options.site) })),
      );

  if (!mention) {
    throw notFoundError(
      'Mention not found in this workspace',
      options.explain
        ? `drop --explain to page through /mentions instead`
        : `${PRODUCT.binName} mention list --limit 20`,
    );
  }

  if (isMachine()) {
    printResult('mention.show', mention);
    return;
  }

  printMention(mention);
}

async function runStatus(id: string, rawStatus: string): Promise<void> {
  const status = normalizeStatus(rawStatus);
  const mention = await withProgress('Updating status…', () =>
    updateMentionStatus(id, { status }),
  );

  if (isMachine()) {
    printResult('mention.status', mention);
    return;
  }

  success(`${formatId(mention.id)} is ${mention.status}`);
  print(`Reversible: ${PRODUCT.binName} mention status ${mention.id} NEW`);
}

async function runExplain(id: string): Promise<void> {
  hint('The first call runs generation and can take up to two minutes. Later calls are instant reads.');

  const mention = await withProgress('Explaining mention…', () => explainMention(id));

  if (!mention) {
    throw notFoundError(
      'Mention not found in this workspace',
      `${PRODUCT.binName} mention list --limit 20`,
    );
  }

  if (isMachine()) {
    printResult('mention.explain', mention);
    return;
  }

  printMention(mention);
}

interface TailOptions extends FilterOptions {
  minScore?: string;
  interval?: string;
  since?: string;
  exec?: string;
  approveOnExecSuccess?: boolean;
}

export function parseTailInterval(value: string | undefined): number {
  if (value === undefined) return TAIL_DEFAULT_INTERVAL_S;
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < TAIL_INTERVAL_FLOOR_S) {
    throw usageError(
      `--interval must be a whole number of ${TAIL_INTERVAL_FLOOR_S} seconds or more, got "${value}"`,
      'every poll spends from the 600 requests per minute budget',
    );
  }
  return seconds;
}

export function parseMinScore(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const score = Number(value);
  if (!Number.isInteger(score) || score < 0 || score > 100) {
    throw usageError(`--min-score must be a whole number between 0 and 100, got "${value}"`);
  }
  return score;
}

function execEnv(mention: Mention): Record<string, string> {
  return {
    RR_ID: mention.id,
    RR_SCORE: mention.relevanceScore === null ? '' : String(mention.relevanceScore),
    RR_URL: mention.url,
    RR_SOURCE: mention.source,
    RR_KEYWORD: mention.keyword ?? '',
    RR_TITLE: mention.title ?? '',
  };
}

async function runChild(command: string, mention: Mention): Promise<number> {
  return new Promise<number>((resolve) => {
    const child = spawn(command, {
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...execEnv(mention) },
    });
    child.stdout?.on('data', (chunk: Buffer) => process.stderr.write(chunk));
    child.stderr?.on('data', (chunk: Buffer) => process.stderr.write(chunk));
    child.on('error', (error) => {
      process.stderr.write(`${error.message}\n`);
      resolve(1);
    });
    child.on('close', (code) => resolve(code ?? 1));
    child.stdin?.end(`${JSON.stringify(mention)}\n`);
  });
}

async function runTail(options: TailOptions): Promise<void> {
  const minScore = parseMinScore(options.minScore);
  const intervalSeconds = parseTailInterval(options.interval);
  const since = options.since === undefined ? new Date() : parseWhen(options.since);
  const timezone = systemTimeZone();
  const filters = buildFilterQuery({ ...options, site: resolveSite(options.site), from: undefined });
  const query = { ...filters, from: toIso(since), sort: 'RECENT' as MentionSort, limit: TAIL_PAGE_SIZE };

  if (!isMachine()) {
    print(
      `Tailing new mentions ${
        filters.websiteId === undefined ? 'for every site' : `for site ${formatId(filters.websiteId)}`
      }${minScore === undefined ? '' : `, score ≥ ${minScore}`}, every ${intervalSeconds}s. Ctrl-C to stop.`,
    );
  }

  await poll<Mention>({
    intervalMs: intervalSeconds * 1000,
    maxIntervalMs: TAIL_MAX_INTERVAL_MS,
    label: 'mentions',
    key: (mention) => mention.id,
    fetchPage: async (cursor: Cursor) => {
      const response = await listMentions(query);
      const items = [...response.mentions]
        .reverse()
        .filter((mention) =>
          minScore === undefined ? true : (mention.relevanceScore ?? -1) >= minScore,
        );
      return { items, cursor };
    },
    onItem: async (mention) => {
      if (isMachine()) {
        process.stdout.write(`${JSON.stringify(mention)}\n`);
      } else {
        const date = mentionDate(mention) ?? new Date();
        print(
          [
            formatAbsolute(date, { timezone, seconds: true, withZone: false }).slice(11),
            String(mention.relevanceScore ?? '—').padStart(3),
            sourceLabel(mention).padEnd(12),
            oneLine(mention.title ?? mention.contentText),
          ].join('  '),
        );
      }

      if (options.exec === undefined) return;

      const code = await runChild(options.exec, mention);
      if (code !== 0) {
        warn(`--exec exited ${code} for ${mention.id}, the tail continues`);
        return;
      }
      if (options.approveOnExecSuccess !== true) return;

      try {
        await updateMentionStatus(mention.id, { status: 'APPROVED' });
      } catch (error) {
        warn(
          `could not approve ${mention.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  });
}

const withFilterOptions = (command: Command): Command =>
  command
    .option('--site <id>', 'only this site')
    .option('--status <status>', `filter by status, repeatable: ${MENTION_STATUSES.join(', ')}`, collectStatus, [] as MentionStatus[])
    .option('--bucket <bucket>', `filter by score bucket, repeatable: ${RELEVANCE_BUCKETS.join(', ')}`, collectBucket, [] as RelevanceBucket[])
    .option('--include-low', 'include mentions below the site’s minimum score')
    .option('--keyword <keyword>', 'filter by keyword, repeatable', collect, [] as string[])
    .option('--source <source>', `filter by source, repeatable: ${MENTION_SOURCES.join(', ')}`, collectSource, [] as MentionSource[])
    .option('--from <date>', 'lower bound on ingestion time')
    .option('--to <date>', 'upper bound on ingestion time');

export function registerMentionCommands(program: Command): void {
  const mention = program
    .command('mention')
    .alias('mentions')
    .description('lead mentions found across Reddit, Hacker News, X and Bluesky');

  withFilterOptions(mention.command('list'))
    .alias('ls')
    .description('list mentions')
    .option('--sort <order>', `${MENTION_SORTS.join(' or ')}`, normalizeSort)
    .option('--limit <n>', `mentions per page, ${MENTION_LIMIT_MIN} to ${MENTION_LIMIT_MAX}`)
    .option('--offset <n>', 'mentions to skip')
    .option('--all', 'page until the server runs out')
    .action(async (_options: ListOptions, command: Command) => {
      await runList(command.optsWithGlobals() as ListOptions);
    });

  withFilterOptions(mention.command('count'))
    .description('count the mentions matching the filters')
    .action(async (options: FilterOptions) => {
      await runCount(options);
    });

  withFilterOptions(mention.command('show <id>'))
    .alias('get')
    .description('show one mention, its score reason and its suggested reply')
    .option('--explain', 'fetch it through /mentions/{id}/explain instead of paging /mentions')
    .action(async (id: string, options: FilterOptions & { explain?: boolean }) => {
      await runShow(id, options);
    });

  mention
    .command('status <id> <status>')
    .description(`set a mention's status: ${MENTION_STATUSES.join(', ')}`)
    .action(async (id: string, status: string) => {
      await runStatus(id, status);
    });

  mention
    .command('explain <id>')
    .description('generate, then read, why a mention scored as it did')
    .action(async (id: string) => {
      await runExplain(id);
    });

  withFilterOptions(mention.command('tail'))
    .description('follow new mentions as they arrive')
    .option('--min-score <n>', 'skip mentions scoring below this')
    .option('--interval <seconds>', `poll every N seconds, floor ${TAIL_INTERVAL_FLOOR_S}`)
    .option('--since <date>', 'start from this time instead of now')
    .option('--exec <command>', 'run this command once per mention, JSON on its stdin')
    .option('--approve-on-exec-success', 'approve a mention when --exec exits 0')
    .action(async (_options: TailOptions, command: Command) => {
      await runTail(command.optsWithGlobals() as TailOptions);
    });
}
