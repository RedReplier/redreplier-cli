import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CONFIG_KEYS,
  productConfigKeys,
  PRODUCT,
  configDir,
  configPath,
  getConfigValue,
  listConfigValues,
  readConfig,
  resolveApiUrl,
  resolveProfile,
  resolveProfileName,
  setConfigValue,
  unsetConfigValue,
} from '../../src/core/config.js';
import { saveProfile } from '../../src/core/credentials.js';

let home: string;
const envKeys = [
  'XDG_CONFIG_HOME',
  'REDREPLIER_API_TOKEN',
  'REDREPLIER_API_KEY',
  'REDREPLIER_API_URL',
  'REDREPLIER_PROFILE',
  'REDREPLIER_WORKSPACE_ID',
];
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  for (const key of envKeys) delete process.env[key];
  home = mkdtempSync(join(tmpdir(), 'rr-config-'));
  process.env.XDG_CONFIG_HOME = home;
});

afterEach(() => {
  for (const key of envKeys) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  rmSync(home, { recursive: true, force: true });
});

describe('paths', () => {
  it('honours XDG_CONFIG_HOME', () => {
    expect(configDir()).toBe(join(home, PRODUCT.id));
    expect(configPath()).toBe(join(home, PRODUCT.id, 'config.json'));
  });
});

describe('profile name resolution', () => {
  it('prefers the flag, then the env var, then the stored current profile', () => {
    saveProfile('acme', { token: 'redreplier_2222bbbb' });
    expect(resolveProfileName()).toBe('acme');

    process.env.REDREPLIER_PROFILE = 'from-env';
    expect(resolveProfileName()).toBe('from-env');
    expect(resolveProfileName({ profile: 'from-flag' })).toBe('from-flag');
  });

  it('falls back to default with no credentials file', () => {
    expect(resolveProfileName()).toBe('default');
  });
});

describe('resolveProfile', () => {
  it('applies the token precedence from --token down to the file', () => {
    saveProfile('default', { token: 'redreplier_file0000' });

    expect(resolveProfile().tokenSource).toBe('credentials');
    expect(resolveProfile().token).toBe('redreplier_file0000');

    process.env.REDREPLIER_API_KEY = 'redreplier_key00000';
    expect(resolveProfile()).toMatchObject({ token: 'redreplier_key00000', tokenSource: 'env-key' });

    process.env.REDREPLIER_API_TOKEN = 'redreplier_tok00000';
    expect(resolveProfile()).toMatchObject({ token: 'redreplier_tok00000', tokenSource: 'env-token' });

    expect(resolveProfile({ token: 'redreplier_flag0000' })).toMatchObject({
      token: 'redreplier_flag0000',
      tokenSource: 'flag',
    });
  });

  it('returns only the documented fields', () => {
    saveProfile('default', { token: 'redreplier_file0000' });
    expect(Object.keys(resolveProfile()).sort()).toEqual(['apiUrl', 'defaults', 'name', 'token', 'tokenSource']);
  });

  it('fails with exit 3 when no token can be found', () => {
    try {
      resolveProfile();
      expect.unreachable('resolveProfile should have thrown');
    } catch (error) {
      const failure = error as Error & { exitCode?: number; hint?: string };
      expect(failure.exitCode).toBe(3);
      expect(failure.hint).toContain('login');
    }
  });

  it('applies the base URL precedence and carries per-profile defaults', () => {
    saveProfile('default', { token: 'redreplier_file0000', apiUrl: 'https://stored.test/api/v1' });
    setConfigValue('defaultSite', 'ws_4f21');

    expect(resolveProfile().apiUrl).toBe('https://stored.test/api/v1');
    expect(resolveProfile().defaults.defaultSite).toBe('ws_4f21');

    process.env.REDREPLIER_API_URL = 'https://env.test/api/v1/';
    expect(resolveProfile().apiUrl).toBe('https://env.test/api/v1');
    expect(resolveProfile({ apiUrl: 'https://flag.test/api/v1' }).apiUrl).toBe('https://flag.test/api/v1');
  });

  it('falls back to the compiled-in default base URL', () => {
    expect(resolveApiUrl()).toEqual({ url: PRODUCT.defaultApiUrl, source: 'default' });
  });

  it('rejects a base URL that is not http', () => {
    expect(() => resolveApiUrl({ apiUrl: 'ftp://example.test' })).toThrowError(/http/);
  });

  it('picks up a workspace id from the environment', () => {
    saveProfile('default', { token: 'redreplier_file0000' });
    process.env.REDREPLIER_WORKSPACE_ID = 'ws_4f21';
    expect(resolveProfile().workspaceId).toBe('ws_4f21');
  });
});

describe('config values', () => {
  it('stores global keys globally and profile keys per profile', () => {
    setConfigValue('updateCheck', 'false');
    setConfigValue('language', 'fr');
    setConfigValue('defaultSite', 'ws_4f21', 'acme');

    const config = readConfig();
    expect(config.updateCheck).toBe(false);
    expect(config.language).toBe('fr');
    expect(config.profiles.acme.defaultSite).toBe('ws_4f21');
    expect(getConfigValue('defaultSite', 'acme')).toBe('ws_4f21');
  });

  it('writes config.json 0644', () => {
    setConfigValue('language', 'en');
    expect(statSync(configPath()).mode & 0o777).toBe(0o644);
  });

  it('rejects unknown keys and bad values with exit 2', () => {
    for (const call of [
      () => setConfigValue('nope', 'x'),
      () => setConfigValue('language', 'klingon'),
      () => setConfigValue('updateCheck', 'maybe'),
      () => setConfigValue('defaultSite', '   '),
    ]) {
      try {
        call();
        expect.unreachable('setConfigValue should have thrown');
      } catch (error) {
        expect((error as { exitCode?: number }).exitCode).toBe(2);
      }
    }
  });

  it('unsets a key and reports whether it existed', () => {
    setConfigValue('defaultSite', 'ws_4f21', 'default');
    expect(unsetConfigValue('defaultSite', 'default')).toBe(true);
    expect(unsetConfigValue('defaultSite', 'default')).toBe(false);
    expect(getConfigValue('defaultSite', 'default')).toBeUndefined();
  });

  it('lists every key this product uses for a profile', () => {
    setConfigValue('defaultSite', 'ws_4f21', 'default');
    const listing = listConfigValues('default');
    expect(listing.profile).toBe('default');
    expect(listing.entries).toHaveLength(productConfigKeys().length);
    expect(listing.entries.find((entry) => entry.key === 'defaultSite')?.value).toBe('ws_4f21');
  });

  it('hides keys that belong to a sibling product', () => {
    const listed = listConfigValues('default').entries.map((entry) => entry.key);
    expect(listed).toContain('defaultSite');
    expect(listed).not.toContain('defaultPlatforms');
    expect(listed).not.toContain('defaultWebsite');
    expect(Object.keys(CONFIG_KEYS)).toContain('defaultPlatforms');
  });

  it('rejects a sibling product key as unknown', () => {
    expect(() => getConfigValue('defaultWebsite', 'default')).toThrow(/Unknown config key/);
    expect(() => setConfigValue('defaultPlatforms', 'twitter', 'default')).toThrow(/Unknown config key/);
  });
});
