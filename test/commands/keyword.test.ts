import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Keyword, KeywordStatus, Website } from '../../src/api/types.js';

const state = vi.hoisted(() => ({ typed: 'DELETE' }));

vi.mock('../../src/api/client.js', () => ({
  activatePendingKeywords: vi.fn(),
  addKeywords: vi.fn(),
  countMentions: vi.fn(),
  deleteKeyword: vi.fn(),
  disableKeyword: vi.fn(),
  editKeyword: vi.fn(),
  enableKeyword: vi.fn(),
  getKeywordChangeUsage: vi.fn(),
  listWebsites: vi.fn(),
  previewActivatePendingKeywords: vi.fn(),
  previewKeywordBilling: vi.fn(),
}));

vi.mock('../../src/core/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/index.js')>();
  return {
    ...actual,
    promptText: async () => state.typed,
  };
});

const client = await import('../../src/api/client.js');
const { initOutput } = await import('../../src/core/index.js');
const {
  collectKeyword,
  findKeyword,
  formatMoney,
  normalizeKeyword,
  normalizeKeywords,
  registerKeywordCommands,
} = await import('../../src/commands/keyword.js');

let stdout = '';

const build = (): Command => {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  program.option('-y, --yes').option('--json').option('-q, --quiet').option('--full-ids');
  registerKeywordCommands(program);
  return program;
};

const run = (argv: string[]): Promise<unknown> => build().parseAsync(argv, { from: 'user' });

const payload = (): { data: unknown; meta?: Record<string, unknown> } =>
  JSON.parse(stdout) as { data: unknown; meta?: Record<string, unknown> };

const keyword = (id: string, value: string, status: KeywordStatus = 'ACTIVE'): Keyword => ({
  id,
  websiteId: 'ws_1',
  value,
  status,
  createdAt: null,
  updatedAt: null,
});

const site = (keywords: Keyword[]): Website => ({
  id: 'ws_1',
  accountGroupId: 'ag_1',
  domain: 'acme.com',
  url: 'https://acme.com',
  name: 'Acme',
  description: 'what it does',
  createdAt: null,
  updatedAt: null,
  keywords,
});

beforeEach(() => {
  stdout = '';
  state.typed = 'DELETE';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  initOutput({ json: true, command: 'test' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('keyword normalisation', () => {
  it('trims and lowercases', () => {
    expect(normalizeKeyword('  Reddit Monitoring ')).toBe('reddit monitoring');
  });

  it('de-duplicates after normalising', () => {
    expect(normalizeKeywords(['Reddit', 'reddit ', 'leads'])).toEqual(['reddit', 'leads']);
  });

  it('refuses an empty keyword with exit 2', () => {
    expect(() => normalizeKeyword('   ')).toThrowError(/cannot be empty/);
    try {
      normalizeKeyword('');
    } catch (error) {
      expect((error as { exitCode: number }).exitCode).toBe(2);
    }
  });

  it('refuses a keyword longer than 255 characters', () => {
    expect(() => normalizeKeyword('a'.repeat(256))).toThrowError(/the limit is 255/);
  });

  it('collects repeatable flags in order', () => {
    expect(collectKeyword('Second', collectKeyword('First'))).toEqual(['first', 'second']);
  });
});

describe('findKeyword', () => {
  it('returns the keyword and the site that owns it', () => {
    const websites = [site([keyword('kw_1', 'reddit monitoring')])];
    expect(findKeyword(websites, 'kw_1')?.website.domain).toBe('acme.com');
    expect(findKeyword(websites, 'kw_nope')).toBeUndefined();
  });
});

describe('formatMoney', () => {
  it('prints major units with two decimals', () => {
    expect(formatMoney(23.4)).toBe('$23.40');
    expect(formatMoney(0)).toBe('$0.00');
  });
});

describe('the keyword command tree', () => {
  it('registers every verb', () => {
    const command = build().commands.find((entry) => entry.name() === 'keyword');
    expect(command?.commands.map((entry) => entry.name())).toEqual([
      'add',
      'edit',
      'disable',
      'enable',
      'delete',
      'activate-pending',
      'plan',
      'usage',
    ]);
    expect(command?.aliases()).toEqual(expect.arrayContaining(['keywords', 'kw']));
    expect(
      command?.commands.find((entry) => entry.name() === 'delete')?.aliases(),
    ).toContain('rm');
  });
});

describe('keyword add', () => {
  it('normalises the keywords before sending them', async () => {
    vi.mocked(client.addKeywords).mockResolvedValue(
      site([keyword('kw_1', 'social listening'), keyword('kw_2', 'reddit leads', 'PENDING')]),
    );

    await run(['keyword', 'add', 'ws_1', 'Social Listening', ' social listening ', 'Reddit Leads']);

    expect(client.addKeywords).toHaveBeenCalledWith('ws_1', {
      keywords: ['social listening', 'reddit leads'],
    });
    expect(payload().data).toMatchObject({ domain: 'acme.com' });
  });

  it('names the pending keyword and the upgrade command in human mode', async () => {
    initOutput({ isTTY: true, command: 'keyword.add' });
    vi.mocked(client.addKeywords).mockResolvedValue(
      site([keyword('kw_1', 'social listening'), keyword('kw_2', 'reddit leads', 'PENDING')]),
    );

    await run(['keyword', 'add', 'ws_1', 'social listening', 'reddit leads']);

    expect(stdout).toContain('acme.com now has 2 keywords');
    expect(stdout).toContain('no free slot on this plan');
    expect(stdout).toContain('1 pending. Price an upgrade: redreplier keyword plan');
  });
});

describe('keyword edit', () => {
  it('sends nothing when the change is case-only', async () => {
    initOutput({ isTTY: true, command: 'keyword.edit' });
    vi.mocked(client.listWebsites).mockResolvedValue({
      websites: [site([keyword('kw_1', 'reddit monitoring')])],
    });

    await run(['keyword', 'edit', 'kw_1', '--value', 'Reddit Monitoring']);

    expect(client.editKeyword).not.toHaveBeenCalled();
    expect(stdout).toContain('No change (case-only edit).');
  });

  it('renames the keyword when the value really changes', async () => {
    vi.mocked(client.listWebsites).mockResolvedValue({
      websites: [site([keyword('kw_1', 'reddit monitoring')])],
    });
    vi.mocked(client.editKeyword).mockResolvedValue(keyword('kw_1', 'reddit alerts'));

    await run(['keyword', 'edit', 'kw_1', '--value', 'Reddit Alerts']);

    expect(client.editKeyword).toHaveBeenCalledWith('kw_1', { value: 'reddit alerts' });
    expect(payload().data).toMatchObject({ value: 'reddit alerts' });
  });

  it('fails with exit 4 when the id belongs to no site', async () => {
    vi.mocked(client.listWebsites).mockResolvedValue({ websites: [site([])] });

    await expect(run(['keyword', 'edit', 'kw_nope', '--value', 'x'])).rejects.toMatchObject({
      exitCode: 4,
    });
  });
});

describe('keyword enable', () => {
  it('says plainly that a pending keyword is not collecting', async () => {
    initOutput({ isTTY: true, command: 'keyword.enable' });
    vi.mocked(client.enableKeyword).mockResolvedValue(keyword('kw_1', 'reddit leads', 'PENDING'));

    await run(['keyword', 'enable', 'kw_1']);

    expect(stdout).toContain('is PENDING');
    expect(stdout).toContain('Nothing was charged.');
  });
});

describe('keyword delete', () => {
  beforeEach(() => {
    vi.mocked(client.listWebsites).mockResolvedValue({
      websites: [site([keyword('kw_1', 'reddit monitoring')])],
    });
    vi.mocked(client.countMentions).mockResolvedValue({ total: 1204 });
    vi.mocked(client.deleteKeyword).mockResolvedValue({ deleted: true });
  });

  it('counts every mention the keyword produced, hidden ones included', async () => {
    await run(['keyword', 'delete', 'kw_1']);

    expect(client.countMentions).toHaveBeenCalledWith({
      websiteId: 'ws_1',
      keywords: ['reddit monitoring'],
      statuses: ['NEW', 'APPROVED', 'REJECTED'],
      includeLowRelevance: true,
    });
    expect(client.deleteKeyword).toHaveBeenCalledWith('kw_1');
  });

  it('refuses when the typed confirmation is not DELETE', async () => {
    state.typed = 'delete';

    await expect(run(['keyword', 'delete', 'kw_1'])).rejects.toMatchObject({ exitCode: 130 });
    expect(client.deleteKeyword).not.toHaveBeenCalled();
  });

  it('skips the typed confirmation with --yes', async () => {
    state.typed = 'nope';

    await run(['--yes', 'keyword', 'delete', 'kw_1']);

    expect(client.deleteKeyword).toHaveBeenCalledWith('kw_1');
  });
});

describe('keyword plan', () => {
  const preview = {
    currentPlanName: 'Starter',
    currentMonthlyPrice: 19,
    targetPlanName: 'Growth',
    targetMonthlyPrice: 49,
    targetKeywords: 25,
    immediateCharge: 23.4,
    isUpgrade: true,
    isDowngrade: false,
    requiresImmediatePayment: true,
  };

  it('prices the pending keywords when no count is given', async () => {
    vi.mocked(client.previewActivatePendingKeywords).mockResolvedValue(preview);

    await run(['keyword', 'plan']);

    expect(client.previewActivatePendingKeywords).toHaveBeenCalled();
    expect(client.previewKeywordBilling).not.toHaveBeenCalled();
  });

  it('prices an absolute keyword total with --count', async () => {
    initOutput({ isTTY: true, command: 'keyword.plan' });
    vi.mocked(client.previewKeywordBilling).mockResolvedValue(preview);

    await run(['keyword', 'plan', '--count', '25']);

    expect(client.previewKeywordBilling).toHaveBeenCalledWith({ desiredKeywordCount: 25 });
    expect(stdout).toContain('Starter  $19.00/mo');
    expect(stdout).toContain('Growth  $49.00/mo  (25 keywords)');
    expect(stdout).toContain('$23.40');
    expect(stdout).toContain('https://redreplier.com/billing');
  });

  it('rejects a non-numeric count with exit 2 before any request', async () => {
    await expect(run(['keyword', 'plan', '--count', 'lots'])).rejects.toMatchObject({
      exitCode: 2,
    });
    expect(client.previewKeywordBilling).not.toHaveBeenCalled();
  });
});

describe('keyword usage', () => {
  it('says unlimited rather than pretending to be a meter', async () => {
    initOutput({ isTTY: true, command: 'keyword.usage' });
    vi.mocked(client.getKeywordChangeUsage).mockResolvedValue({
      limit: -1,
      used: 3,
      remaining: -1,
      unlimited: true,
    });

    await run(['keyword', 'usage']);

    expect(stdout).toContain('Keyword edits: unlimited (this plan does not meter them).');
  });

  it('prints the meter when the plan has one', async () => {
    initOutput({ isTTY: true, command: 'keyword.usage' });
    vi.mocked(client.getKeywordChangeUsage).mockResolvedValue({
      limit: 10,
      used: 4,
      remaining: 6,
      unlimited: false,
    });

    await run(['keyword', 'usage']);

    expect(stdout).toContain('remaining');
    expect(stdout).toContain('6');
  });
});

describe('keyword activate-pending', () => {
  it('reports what is still pending and that nothing was charged', async () => {
    initOutput({ isTTY: true, command: 'keyword.activate-pending' });
    vi.mocked(client.activatePendingKeywords).mockResolvedValue({
      websites: [site([keyword('kw_1', 'a'), keyword('kw_2', 'b', 'PENDING')])],
    });

    await run(['keyword', 'activate-pending']);

    expect(stdout).toContain('1 active keyword across 1 site');
    expect(stdout).toContain('1 still pending');
    expect(stdout).toContain('never charges');
  });
});
