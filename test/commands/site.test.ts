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
