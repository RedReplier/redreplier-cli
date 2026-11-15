import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Website } from '../../src/api/types.js';

vi.mock('../../src/api/client.js', () => ({
  analyzeWebsiteDescription: vi.fn(),
  countMentions: vi.fn(),
  createWebsite: vi.fn(),
  deleteWebsite: vi.fn(),
  getWebsite: vi.fn(),
  listWebsites: vi.fn(),
  updateWebsite: vi.fn(),
}));

const client = await import('../../src/api/client.js');
const { initOutput } = await import('../../src/core/index.js');
const { registerSiteCommands } = await import('../../src/commands/site.js');

const build = (): Command => {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  program.option('-y, --yes').option('--json').option('-q, --quiet').option('--full-ids');
  registerSiteCommands(program);
  return program;
};

const run = (argv: string[]): Promise<unknown> => build().parseAsync(argv, { from: 'user' });

const created: Website = {
  id: 'ws_1',
  accountGroupId: 'ag_1',
  domain: 'acme.com',
  url: 'https://acme.com',
  name: null,
  description: null,
  ignoredKeywords: [],
  createdAt: null,
  updatedAt: null,
  keywords: [],
};

beforeEach(() => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  initOutput({ json: true, command: 'test' });
  vi.mocked(client.createWebsite).mockResolvedValue(created);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('site create', () => {
  it('sends an empty description with --no-analyze so the server skips the analysis', async () => {
    await run(['site', 'create', '--url', 'https://acme.com', '-k', 'leads', '--no-analyze']);

    expect(client.createWebsite).toHaveBeenCalledWith({
      url: 'https://acme.com',
      keywords: ['leads'],
      description: '',
    });
  });

  it('leaves description out without --no-analyze so the server analyzes the site', async () => {
    await run(['site', 'create', '--url', 'https://acme.com', '-k', 'leads']);

    const body = vi.mocked(client.createWebsite).mock.calls[0]?.[0];
    expect(body).toBeDefined();
    expect(body).not.toHaveProperty('description');
  });
});

describe('site update', () => {
  beforeEach(() => {
    vi.mocked(client.updateWebsite).mockResolvedValue({ ...created, ignoredKeywords: ['hiring'] });
  });

  it('sends every --ignore as the whole ignore list, lowercased and de-duplicated', async () => {
    await run(['site', 'update', 'ws_1', '--ignore', ' Hiring ', '--ignore', 'job post', '--ignore', 'hiring']);

    expect(client.updateWebsite).toHaveBeenCalledWith('ws_1', {
      ignoredKeywords: ['hiring', 'job post'],
    });
  });

  it('sends an empty list with --clear-ignore', async () => {
    await run(['site', 'update', 'ws_1', '--clear-ignore']);

    expect(client.updateWebsite).toHaveBeenCalledWith('ws_1', { ignoredKeywords: [] });
  });

  it('leaves the ignore list out when neither flag is passed', async () => {
    await run(['site', 'update', 'ws_1', '--name', 'Acme']);

    expect(client.updateWebsite).toHaveBeenCalledWith('ws_1', { name: 'Acme' });
  });

  it('refuses --ignore together with --clear-ignore', async () => {
    await expect(
      run(['site', 'update', 'ws_1', '--ignore', 'hiring', '--clear-ignore']),
    ).rejects.toMatchObject({ exitCode: 2 });
    expect(client.updateWebsite).not.toHaveBeenCalled();
  });

  it('refuses an empty --ignore value', async () => {
    await expect(run(['site', 'update', 'ws_1', '--ignore', '  '])).rejects.toMatchObject({
      exitCode: 2,
    });
    expect(client.updateWebsite).not.toHaveBeenCalled();
  });

  it('refuses more phrases than the API keeps', async () => {
    const flags = Array.from({ length: 101 }, (_, index) => ['--ignore', `phrase ${index}`]).flat();

    await expect(run(['site', 'update', 'ws_1', ...flags])).rejects.toMatchObject({ exitCode: 2 });
    expect(client.updateWebsite).not.toHaveBeenCalled();
  });

  it('asks for a flag when nothing would change', async () => {
    await expect(run(['site', 'update', 'ws_1'])).rejects.toMatchObject({ exitCode: 2 });
  });
});

describe('site get', () => {
  it('shows the ignore list in human mode', async () => {
    let stdout = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });
    initOutput({ isTTY: true, env: {}, command: 'site.get' });
    vi.mocked(client.getWebsite).mockResolvedValue({
      ...created,
      description: 'what it does',
      ignoredKeywords: ['hiring', 'job post'],
    });

    await run(['site', 'get', 'ws_1']);

    expect(stdout).toContain('hiring, job post');
  });
});
