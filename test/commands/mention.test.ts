import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Mention, MentionSource, MentionStatus } from '../../src/api/types.js';

const state = vi.hoisted(() => ({ defaults: {} as Record<string, unknown> }));

vi.mock('../../src/api/client.js', () => ({
  countMentions: vi.fn(),
  explainMention: vi.fn(),
  listMentions: vi.fn(),
  updateMentionStatus: vi.fn(),
}));

vi.mock('../../src/core/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/index.js')>();
  return {
    ...actual,
    profileDefaults: () => state.defaults,
  };
});

const client = await import('../../src/api/client.js');
const { initOutput } = await import('../../src/core/index.js');
const {
  authorLabel,
  buildFilterQuery,
  mentionDate,
  normalizeBucket,
  normalizeSort,
  normalizeSource,
  normalizeStatus,
  parseMinScore,
  parseTailInterval,
  registerMentionCommands,
  relevanceBucketOf,
  resolveSite,
  sourceLabel,
} = await import('../../src/commands/mention.js');

let stdout = '';
let stderr = '';

const build = (): Command => {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  program.option('-y, --yes').option('--json').option('-q, --quiet').option('--full-ids');
  registerMentionCommands(program);
  return program;
};

const run = (argv: string[]): Promise<unknown> => build().parseAsync(argv, { from: 'user' });

const payload = (): { data: unknown; meta?: Record<string, unknown> } =>
  JSON.parse(stdout) as { data: unknown; meta?: Record<string, unknown> };

const mention = (overrides: Partial<Mention> = {}): Mention => ({
  id: '8f2c1b0e-1111-2222-3333-444455556666',
  websiteId: 'ws_1',
  source: 'REDDIT_POST' as MentionSource,
  keyword: 'reddit monitoring',
  title: 'How do you track brand mentions on Reddit?',
  contentText: 'We keep missing threads about us.',
  url: 'https://reddit.com/r/SaaS/comments/abc',
  author: 'throwaway_pm',
  subreddit: 'SaaS',
  status: 'NEW' as MentionStatus,
  relevanceScore: 92,
  relevanceReason: 'Directly asks for the category of tool acme.com sells.',
  aiReplySuggestion: 'We built acme for exactly this.',
  tags: [],
  publishedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
  ingestedAt: null,
  reviewedAt: null,
  createdAt: null,
  updatedAt: null,
  ...overrides,
});

const page = (mentions: Mention[], total = mentions.length, offset = 0) => ({
  mentions,
  total,
  limit: 500,
  offset,
});

beforeEach(() => {
  stdout = '';
  stderr = '';
  state.defaults = {};
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
  initOutput({ json: true, command: 'test' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('relevanceBucketOf', () => {
  it('maps a score onto the bucket the API filters by', () => {
    expect(relevanceBucketOf(92)).toBe('VERY_HIGH');
    expect(relevanceBucketOf(75)).toBe('VERY_HIGH');
    expect(relevanceBucketOf(74)).toBe('HIGH');
    expect(relevanceBucketOf(50)).toBe('HIGH');
    expect(relevanceBucketOf(49)).toBe('MEDIUM');
    expect(relevanceBucketOf(30)).toBe('MEDIUM');
    expect(relevanceBucketOf(29)).toBe('LOW');
    expect(relevanceBucketOf(10)).toBe('LOW');
    expect(relevanceBucketOf(9)).toBe('VERY_LOW');
    expect(relevanceBucketOf(0)).toBe('VERY_LOW');
  });

  it('has no bucket for an unscored mention', () => {
    expect(relevanceBucketOf(null)).toBeNull();
  });
});

describe('enum normalisation', () => {
  it('accepts any case and both separators', () => {
    expect(normalizeStatus('approved')).toBe('APPROVED');
    expect(normalizeBucket('very-high')).toBe('VERY_HIGH');
    expect(normalizeSource('reddit-comment')).toBe('REDDIT_COMMENT');
    expect(normalizeSort('recent')).toBe('RECENT');
  });

  it('names the offending value and exits 2 on anything else', () => {
    expect(() => normalizeStatus('PENDING')).toThrowError(/Unknown status "PENDING"/);
    try {
      normalizeStatus('PENDING');
    } catch (error) {
      expect((error as { hint: string }).hint).toContain('NEW, APPROVED, REJECTED');
    }
    try {
      normalizeSource('MASTODON');
    } catch (error) {
      expect((error as { hint: string }).hint).toContain('FACEBOOK_GROUP');
    }
    try {
      normalizeBucket('HUGE');
    } catch (error) {
      expect((error as { exitCode: number }).exitCode).toBe(2);
    }
  });
});

describe('buildFilterQuery', () => {
  it('uses the server field names, not the flag spellings', () => {
    expect(
      buildFilterQuery({
        site: 'ws_1',
        status: ['NEW', 'APPROVED'],
        bucket: ['HIGH'],
        includeLow: true,
        keyword: ['reddit monitoring'],
        source: ['HACKERNEWS'],
      }),
    ).toEqual({
      websiteId: 'ws_1',
      statuses: ['NEW', 'APPROVED'],
      scoreBuckets: ['HIGH'],
      includeLowRelevance: true,
      keywords: ['reddit monitoring'],
      sources: ['HACKERNEWS'],
    });
  });

  it('drops empty filters instead of sending empty arrays', () => {
    expect(buildFilterQuery({ status: [], bucket: [], keyword: [], source: [] })).toEqual({});
  });

  it('turns dates into ISO strings', () => {
    expect(buildFilterQuery({ from: '2026-08-01' }).from).toBe('2026-08-01T00:00:00.000Z');
  });
});

describe('resolveSite', () => {
  it('falls back to the profile default', () => {
    state.defaults = { defaultSite: 'ws_4f21' };
    expect(resolveSite(undefined)).toBe('ws_4f21');
    expect(resolveSite('ws_other')).toBe('ws_other');
  });

  it('is undefined when neither the flag nor the config names a site', () => {
    expect(resolveSite(undefined)).toBeUndefined();
  });
});

describe('row helpers', () => {
  it('labels a reddit mention by its subreddit and its author with u/', () => {
    expect(sourceLabel(mention())).toBe('r/SaaS');
    expect(authorLabel(mention())).toBe('u/throwaway_pm');
  });

  it('falls back to the source enum off reddit', () => {
    const hn = mention({ source: 'HACKERNEWS', subreddit: null, author: 'pg' });
    expect(sourceLabel(hn)).toBe('HACKERNEWS');
    expect(authorLabel(hn)).toBe('pg');
  });

  it('prefers publishedAt, then ingestedAt', () => {
    expect(mentionDate(mention({ publishedAt: null, ingestedAt: null, createdAt: null }))).toBeNull();
    expect(
      mentionDate(mention({ publishedAt: null, ingestedAt: '2026-09-01T00:00:00.000Z' }))?.toISOString(),
    ).toBe('2026-09-01T00:00:00.000Z');
  });
});

describe('tail flag validation', () => {
  it('holds the interval at a 30 second floor', () => {
    expect(parseTailInterval(undefined)).toBe(60);
    expect(parseTailInterval('120')).toBe(120);
    expect(() => parseTailInterval('10')).toThrowError(/30 seconds or more/);
  });

  it('keeps --min-score inside 0 to 100', () => {
    expect(parseMinScore(undefined)).toBeUndefined();
    expect(parseMinScore('70')).toBe(70);
    expect(() => parseMinScore('101')).toThrowError(/between 0 and 100/);
  });
});

describe('the mention command tree', () => {
  it('registers every verb with its aliases', () => {
    const command = build().commands.find((entry) => entry.name() === 'mention');
    expect(command?.commands.map((entry) => entry.name())).toEqual([
      'list',
      'count',
      'show',
      'status',
      'explain',
      'tail',
    ]);
    expect(command?.aliases()).toContain('mentions');
    expect(command?.commands.find((entry) => entry.name() === 'list')?.aliases()).toContain('ls');
    expect(command?.commands.find((entry) => entry.name() === 'show')?.aliases()).toContain('get');
  });

  it('gives list, count, show and tail the same filter flags', () => {
    const command = build().commands.find((entry) => entry.name() === 'mention');
    for (const name of ['list', 'count', 'show', 'tail']) {
      const flags = command?.commands
        .find((entry) => entry.name() === name)
        ?.options.map((option) => option.long);
      expect(flags).toEqual(
        expect.arrayContaining([
          '--site',
          '--status',
          '--bucket',
          '--include-low',
          '--keyword',
          '--source',
        ]),
      );
    }
  });
});

describe('mention list', () => {
  it('sends the repeatable filters as arrays and pages with limit and offset', async () => {
    vi.mocked(client.listMentions).mockResolvedValue(page([mention()], 213));

    await run([
      'mention',
      'list',
      '--bucket',
      'HIGH',
      '--bucket',
      'VERY_HIGH',
      '--status',
      'NEW',
      '--sort',
      'RELEVANCE',
      '--limit',
      '5',
    ]);

    expect(client.listMentions).toHaveBeenCalledWith({
      statuses: ['NEW'],
      scoreBuckets: ['HIGH', 'VERY_HIGH'],
      sort: 'RELEVANCE',
      limit: 5,
      offset: 0,
    });
    expect(payload().meta).toMatchObject({ total: 213, limit: 5, offset: 0, hasMore: true });
  });

  it('applies the profile default site', async () => {
    state.defaults = { defaultSite: 'ws_4f21' };
    vi.mocked(client.listMentions).mockResolvedValue(page([mention()]));

    await run(['mention', 'list']);

    expect(client.listMentions).toHaveBeenCalledWith(
      expect.objectContaining({ websiteId: 'ws_4f21' }),
    );
  });

  it('refuses a limit above 500 with exit 2 before any request', async () => {
    await expect(run(['mention', 'list', '--limit', '501'])).rejects.toMatchObject({ exitCode: 2 });
    expect(client.listMentions).not.toHaveBeenCalled();
  });

  it('surfaces both hidden-row rules in human mode', async () => {
    initOutput({ isTTY: true, command: 'mention.list' });
    vi.mocked(client.listMentions).mockResolvedValue(page([mention()], 213));
    vi.mocked(client.countMentions).mockResolvedValue({ total: 254 });

    await run(['mention', 'list']);

    expect(stdout).toContain('1 of 213 · open: redreplier mention show <id>');
    expect(stderr).toContain('REJECTED mentions are hidden unless you pass --status REJECTED.');
    expect(stderr).toContain('41 mentions below');
    expect(stderr).toContain('--include-low');
  });

  it('stays quiet about hidden rows once the filters ask for them', async () => {
    initOutput({ isTTY: true, command: 'mention.list' });
    vi.mocked(client.listMentions).mockResolvedValue(page([mention()], 1));

    await run(['mention', 'list', '--status', 'REJECTED', '--include-low']);

    expect(client.countMentions).not.toHaveBeenCalled();
    expect(stderr).not.toContain('REJECTED mentions are hidden');
  });
});

describe('mention count', () => {
  it('sends the filters and prints one sentence in human mode', async () => {
    initOutput({ isTTY: true, command: 'mention.count' });
    vi.mocked(client.countMentions).mockResolvedValue({ total: 213 });

    await run(['mention', 'count', '--source', 'BLUESKY']);

    expect(client.countMentions).toHaveBeenCalledWith({ sources: ['BLUESKY'] });
    expect(stdout).toContain('213 mentions match');
  });
});

describe('mention show', () => {
  it('pages /mentions with every status and the low-relevance rows included', async () => {
    vi.mocked(client.listMentions).mockResolvedValue(page([mention()], 1));

    await run(['mention', 'show', '8f2c1b0e']);

    expect(client.listMentions).toHaveBeenCalledWith({
      statuses: ['NEW', 'APPROVED', 'REJECTED'],
      includeLowRelevance: true,
      sort: 'RECENT',
      limit: 500,
      offset: 0,
    });
    expect(payload().data).toMatchObject({ id: mention().id });
  });

  it('fails with exit 4 when the id is in no page', async () => {
    vi.mocked(client.listMentions).mockResolvedValue(page([mention({ id: 'other' })], 1));

    await expect(run(['mention', 'show', 'missing'])).rejects.toMatchObject({ exitCode: 4 });
  });

  it('uses the explain endpoint with --explain', async () => {
    vi.mocked(client.explainMention).mockResolvedValue(mention());

    await run(['mention', 'show', mention().id, '--explain']);

    expect(client.explainMention).toHaveBeenCalledWith(mention().id);
    expect(client.listMentions).not.toHaveBeenCalled();
  });

  it('prints the score reason and the suggested reply in human mode', async () => {
    initOutput({ isTTY: true, command: 'mention.show' });
    vi.mocked(client.listMentions).mockResolvedValue(page([mention()], 1));

    await run(['mention', 'show', '8f2c1b0e']);

    expect(stdout).toContain('r/SaaS');
    expect(stdout).toContain('score 92 (VERY_HIGH)');
    expect(stdout).toContain('why it scored 92');
    expect(stdout).toContain('suggested reply');
    expect(stdout).toContain(`approve: redreplier mention status ${mention().id} APPROVED`);
  });
});

describe('mention explain', () => {
  it('turns a null body into exit 4 instead of crashing', async () => {
    vi.mocked(client.explainMention).mockResolvedValue(null);

    await expect(run(['mention', 'explain', 'ghost'])).rejects.toMatchObject({ exitCode: 4 });
  });

  it('warns that the first call generates before it prints', async () => {
    initOutput({ isTTY: true, command: 'mention.explain' });
    vi.mocked(client.explainMention).mockResolvedValue(mention());

    await run(['mention', 'explain', mention().id]);

    expect(stderr).toContain('up to two minutes');
  });
});

describe('mention status', () => {
  it('takes the status as a case-insensitive positional', async () => {
    vi.mocked(client.updateMentionStatus).mockResolvedValue(mention({ status: 'APPROVED' }));

    await run(['mention', 'status', mention().id, 'approved']);

    expect(client.updateMentionStatus).toHaveBeenCalledWith(mention().id, { status: 'APPROVED' });
  });

  it('refuses an unknown status with exit 2', async () => {
    await expect(run(['mention', 'status', 'x', 'MAYBE'])).rejects.toMatchObject({ exitCode: 2 });
    expect(client.updateMentionStatus).not.toHaveBeenCalled();
  });
});
