import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { KeywordStatus, Website } from '../../src/api/types.js';
import type { ResolvedProfile, StoredProfile } from '../../src/core/index.js';

const state = vi.hoisted(() => ({
  globals: {} as Record<string, unknown>,
  profile: {} as ResolvedProfile,
  stored: {} as Record<string, StoredProfile>,
  websites: [] as Website[],
  rateLimit: undefined as { limit?: number; remaining?: number; reset?: number } | undefined,
  confirmed: true,
  typed: '',
  opened: [] as string[],
  httpConfigured: [] as unknown[],
  saved: [] as Array<{ name: string; input: Record<string, unknown> }>,
  deleted: [] as string[],
  deletedAll: 0,
}));

vi.mock('../../src/api/client.js', () => ({
  listWebsites: async () => ({ websites: state.websites }),
}));

vi.mock('../../src/core/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/index.js')>();
  return {
    ...actual,
    configureHttp: (options: unknown) => {
      state.httpConfigured.push(options);
    },
    getGlobalOptions: () => state.globals,
    getLastRateLimit: () => state.rateLimit,
    getProfile: (name: string) => state.stored[name],
    isDebugEnabled: () => false,
    listProfiles: () =>
      Object.keys(state.stored).map((name) => ({ name, current: name === 'default' })),
    openUrl: (url: string) => {
      state.opened.push(url);
      return true;
    },
    profileDefaults: () => ({}),
    promptConfirm: async (_message: string, options: { assumeYes?: boolean } = {}) =>
      options.assumeYes === true ? true : state.confirmed,
    promptHidden: async () => state.typed,
    resolveApiUrl: () => ({ url: 'https://ai.redreplier.com/ai-app/api/v1', source: 'default' }),
    resolveLanguage: () => undefined,
    resolveProfile: () => state.profile,
    resolveProfileName: () => state.profile.name,
    saveProfile: (name: string, input: Record<string, unknown>) => {
      state.saved.push({ name, input });
      return { type: 'token', ...input } as StoredProfile;
    },
    deleteProfile: (name: string) => {
      state.deleted.push(name);
      return true;
    },
    deleteAllProfiles: () => {
      state.deletedAll = Object.keys(state.stored).length;
      return state.deletedAll;
    },
  };
});

const { initOutput, setInteractive } = await import('../../src/core/index.js');
const { registerAuthCommands, assertTokenShape } = await import('../../src/commands/auth.js');

let stdout = '';

function run(args: string[]): Promise<unknown> {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  registerAuthCommands(program);
  return program.parseAsync(args, { from: 'user' });
}

const site = (id: string, domain: string, statuses: KeywordStatus[] = []): Website => ({
  id,
  accountGroupId: 'ag_1',
  domain,
  url: `https://${domain}`,
  name: null,
  description: 'what it does',
  createdAt: null,
  updatedAt: null,
  keywords: statuses.map((status, index) => ({
    id: `${id}_kw_${index}`,
    websiteId: id,
    value: `keyword ${index}`,
    status,
    createdAt: null,
    updatedAt: null,
  })),
});

beforeEach(() => {
  stdout = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

  state.globals = {};
  state.profile = {
    name: 'default',
    token: 'redreplier_stored9999',
    tokenSource: 'credentials',
    apiUrl: 'https://ai.redreplier.com/ai-app/api/v1',
    defaults: {},
  };
  state.stored = {};
  state.websites = [];
  state.rateLimit = undefined;
  state.confirmed = true;
  state.typed = '';
  state.opened = [];
  state.httpConfigured = [];
  state.saved = [];
  state.deleted = [];
  state.deletedAll = 0;

  initOutput({ isTTY: true, env: {}, command: 'test' });
  setInteractive(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('assertTokenShape', () => {
  it('accepts a RedReplier token', () => {
    expect(() => assertTokenShape('redreplier_abcdef')).not.toThrow();
  });

  it('names the product a foreign token belongs to', () => {
    expect(() => assertTokenShape('adaptly_abc123')).toThrowError(/starts with adaptly_/);
    try {
      assertTokenShape('adaptly_abc123');
    } catch (error) {
      expect((error as { exitCode: number }).exitCode).toBe(3);
      expect((error as { code: string }).code).toBe('wrong_token_prefix');
    }
  });

  it('rejects an OAuth JWT with its own message', () => {
    try {
      assertTokenShape('header.payload.signature');
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as { code: string }).code).toBe('unsupported_token');
      expect((error as { exitCode: number }).exitCode).toBe(3);
    }
  });
});

describe('login', () => {
  it('refuses a foreign token before touching the network', async () => {
    state.globals = { token: 'adaptly_abc123' };
    await expect(run(['login'])).rejects.toMatchObject({ exitCode: 3 });
    expect(state.saved).toHaveLength(0);
    expect(state.httpConfigured).toHaveLength(0);
  });

  it('stores the profile and reports what the token can see', async () => {
    state.globals = { token: 'redreplier_ab12cd34ef' };
    state.websites = [
      site('ws_1', 'acme.com', ['ACTIVE', 'ACTIVE', 'PENDING']),
      site('ws_2', 'acmedocs.io', ['ACTIVE']),
    ];

    await run(['login', '--name', 'personal']);

    expect(state.saved).toEqual([
      {
        name: 'default',
        input: {
          token: 'redreplier_ab12cd34ef',
          apiUrl: 'https://ai.redreplier.com/ai-app/api/v1',
          label: 'personal',
        },
      },
    ]);
    expect(stdout).toContain('Token valid');
    expect(stdout).toContain('2 monitored');
    expect(stdout).toContain('acme.com, acmedocs.io');
    expect(stdout).toContain('3 active');
    expect(stdout).not.toContain('redreplier_ab12cd34ef');
  });

  it('reads the token from a hidden prompt and opens the token page', async () => {
    state.typed = '  redreplier_typed12345  ';

    await run(['login']);

    expect(state.opened).toEqual(['https://redreplier.com/api-tokens']);
    expect(state.saved[0]?.input.token).toBe('redreplier_typed12345');
  });

  it('configures the client with the pasted token before verifying it', async () => {
    state.globals = { token: 'redreplier_ab12cd34ef' };

    await run(['login']);

    expect(state.httpConfigured).toHaveLength(1);
    expect(state.httpConfigured[0]).toMatchObject({
      profile: { name: 'default', token: 'redreplier_ab12cd34ef', tokenSource: 'flag' },
    });
  });

  it('emits the machine envelope under --json', async () => {
    initOutput({ json: true, command: 'login' });
    state.globals = { token: 'redreplier_ab12cd34ef' };
    state.websites = [site('ws_1', 'acme.com', ['ACTIVE'])];

    await run(['login']);

    const payload = JSON.parse(stdout) as {
      ok: boolean;
      command: string;
      data: Record<string, unknown>;
    };
    expect(payload.ok).toBe(true);
    expect(payload.command).toBe('login');
    expect(payload.data).toMatchObject({
      profile: 'default',
      sites: 1,
      domains: ['acme.com'],
      activeKeywords: 1,
    });
    expect(stdout).not.toContain('redreplier_ab12cd34ef');
  });
});

describe('whoami', () => {
  it('prints the profile, the redacted token, the api and what it can see', async () => {
    state.websites = [site('ws_1', 'acme.com', ['ACTIVE', 'DISABLED'])];
    state.rateLimit = { limit: 600, remaining: 598, reset: 41 };

    await run(['whoami']);

    expect(stdout).toContain('profile');
    expect(stdout).toContain('redreplier_stor…');
    expect(stdout).toContain('credentials file');
    expect(stdout).toContain('https://ai.redreplier.com/ai-app/api/v1');
    expect(stdout).toContain('1 site  (acme.com)');
    expect(stdout).toContain('1 active');
    expect(stdout).toContain('598 of 600 requests left this minute');
    expect(stdout).not.toContain('redreplier_stored9999');
  });

  it('names the default site when the profile carries one', async () => {
    state.profile = { ...state.profile, defaults: { defaultSite: 'ws_4f21' } };

    await run(['whoami']);

    expect(stdout).toContain('ws_4f21  (from config.json)');
  });

  it('carries the rate limit in meta under --json', async () => {
    initOutput({ json: true, command: 'whoami' });
    state.websites = [site('ws_1', 'acme.com', ['ACTIVE']), site('ws_2', 'b.com', ['PENDING'])];
    state.rateLimit = { limit: 600, remaining: 598, reset: 41 };

    await run(['whoami']);

    const payload = JSON.parse(stdout) as {
      data: Record<string, unknown>;
      meta: Record<string, unknown>;
    };
    expect(payload.data).toMatchObject({ sites: 2, domains: ['acme.com', 'b.com'], activeKeywords: 1 });
    expect(payload.meta).toEqual({ rateLimit: { limit: 600, remaining: 598, resetSeconds: 41 } });
  });
});

describe('logout', () => {
  beforeEach(() => {
    state.stored = {
      default: { type: 'token', token: 'redreplier_a', tokenPrefix: 'redreplier_a' },
      acme: { type: 'token', token: 'redreplier_b', tokenPrefix: 'redreplier_b' },
    };
  });

  it('removes the resolved profile once confirmed', async () => {
    state.confirmed = true;

    await run(['logout']);

    expect(state.deleted).toEqual(['default']);
    expect(stdout).toContain('Removed profile "default"');
    expect(stdout).toContain('revoke it at https://redreplier.com/api-tokens');
  });

  it('removes every profile with --all', async () => {
    state.globals = { yes: true };

    await run(['logout', '--all']);

    expect(state.deletedAll).toBe(2);
    expect(state.deleted).toEqual([]);
  });

  it('keeps everything when the confirmation is declined', async () => {
    state.confirmed = false;

    await run(['logout']);

    expect(state.deleted).toEqual([]);
    expect(stdout).toContain('Nothing removed.');
  });

  it('fails with exit 4 when the profile is unknown', async () => {
    state.profile = { ...state.profile, name: 'ghost' };
    await expect(run(['logout'])).rejects.toMatchObject({ exitCode: 4, code: 'unknown_profile' });
    expect(state.deleted).toEqual([]);
  });

  it('fails with exit 4 when nothing is stored', async () => {
    state.stored = {};
    await expect(run(['logout'])).rejects.toMatchObject({ exitCode: 4, code: 'no_profiles' });
  });
});
