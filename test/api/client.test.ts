import { beforeEach, describe, expect, it, vi } from 'vitest';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock('../../src/core/index.js', () => ({ request }));

import * as client from '../../src/api/client.js';

const lastCall = () => request.mock.calls.at(-1)?.[0] as Record<string, unknown>;

beforeEach(() => {
  request.mockReset();
  request.mockResolvedValue({ ok: true });
});

describe('endpoint mapping', () => {
  const cases: [string, () => Promise<unknown>, Record<string, unknown>][] = [
    [
      'listWebsites',
      () => client.listWebsites(),
      { method: 'GET', path: '/websites' },
    ],
    [
      'getWebsite',
      () => client.getWebsite('4f21a0c8-1d3e-4b77-9f0a-6c2b81e5d930'),
      {
        method: 'GET',
        path: '/websites/4f21a0c8-1d3e-4b77-9f0a-6c2b81e5d930',
      },
    ],
    [
      'createWebsite',
      () =>
        client.createWebsite({
          url: 'https://acme.com',
          name: 'Acme',
          keywords: ['reddit monitoring', 'lead finder'],
        }),
      {
        method: 'POST',
        path: '/websites',
        body: {
          url: 'https://acme.com',
          name: 'Acme',
          keywords: ['reddit monitoring', 'lead finder'],
        },
      },
    ],
    [
      'updateWebsite',
      () =>
        client.updateWebsite('4f21a0c8-1d3e-4b77-9f0a-6c2b81e5d930', {
          description: 'Reddit lead monitoring for SaaS teams.',
        }),
      {
        method: 'PATCH',
        path: '/websites/4f21a0c8-1d3e-4b77-9f0a-6c2b81e5d930',
        body: { description: 'Reddit lead monitoring for SaaS teams.' },
      },
    ],
    [
      'deleteWebsite',
      () => client.deleteWebsite('9b031c7a-52e4-4a11-8d6f-30c9a7b41e28'),
      {
        method: 'DELETE',
        path: '/websites/9b031c7a-52e4-4a11-8d6f-30c9a7b41e28',
      },
    ],
    [
      'analyzeWebsiteDescription',
      () => client.analyzeWebsiteDescription({ url: 'https://acme.com' }),
      {
        method: 'POST',
        path: '/websites/analyze-description',
        body: { url: 'https://acme.com' },
      },
    ],
    [
      'addKeywords',
      () =>
        client.addKeywords('4f21a0c8-1d3e-4b77-9f0a-6c2b81e5d930', {
          keywords: ['social listening', 'reddit leads'],
        }),
      {
        method: 'POST',
        path: '/websites/4f21a0c8-1d3e-4b77-9f0a-6c2b81e5d930/keywords',
        body: { keywords: ['social listening', 'reddit leads'] },
      },
    ],
    [
      'editKeyword',
      () =>
        client.editKeyword('7c19f4b2-8a05-41d6-b3ce-1f8047d92a6b', {
          value: 'reddit monitoring',
        }),
      {
        method: 'PATCH',
        path: '/keywords/7c19f4b2-8a05-41d6-b3ce-1f8047d92a6b',
        body: { value: 'reddit monitoring' },
      },
    ],
    [
      'disableKeyword',
      () => client.disableKeyword('7c19f4b2-8a05-41d6-b3ce-1f8047d92a6b'),
      {
        method: 'POST',
        path: '/keywords/7c19f4b2-8a05-41d6-b3ce-1f8047d92a6b/disable',
        idempotent: true,
      },
    ],
    [
      'enableKeyword',
      () => client.enableKeyword('7c19f4b2-8a05-41d6-b3ce-1f8047d92a6b'),
      {
        method: 'POST',
        path: '/keywords/7c19f4b2-8a05-41d6-b3ce-1f8047d92a6b/enable',
        idempotent: true,
      },
    ],
    [
      'deleteKeyword',
      () => client.deleteKeyword('7c19f4b2-8a05-41d6-b3ce-1f8047d92a6b'),
      {
        method: 'DELETE',
        path: '/keywords/7c19f4b2-8a05-41d6-b3ce-1f8047d92a6b',
      },
    ],
    [
      'activatePendingKeywords',
      () => client.activatePendingKeywords(),
      {
        method: 'POST',
        path: '/keywords/activate-pending',
        idempotent: true,
      },
    ],
    [
      'previewActivatePendingKeywords',
      () => client.previewActivatePendingKeywords(),
      { method: 'GET', path: '/keywords/activate-pending/preview' },
    ],
    [
      'previewKeywordBilling',
      () => client.previewKeywordBilling({ desiredKeywordCount: 25 }),
      {
        method: 'GET',
        path: '/keywords/billing-preview',
        query: { desiredKeywordCount: 25 },
      },
    ],
    [
      'getKeywordChangeUsage',
      () => client.getKeywordChangeUsage(),
      { method: 'GET', path: '/keywords/change-usage' },
    ],
    [
      'listMentions',
      () =>
        client.listMentions({
          websiteId: '4f21a0c8-1d3e-4b77-9f0a-6c2b81e5d930',
          statuses: ['NEW'],
          scoreBuckets: ['HIGH', 'VERY_HIGH'],
          sources: ['REDDIT_POST', 'HACKERNEWS'],
          sort: 'RELEVANCE',
          limit: 5,
          offset: 0,
        }),
      {
        method: 'GET',
        path: '/mentions',
        query: {
          websiteId: '4f21a0c8-1d3e-4b77-9f0a-6c2b81e5d930',
          statuses: ['NEW'],
          scoreBuckets: ['HIGH', 'VERY_HIGH'],
          sources: ['REDDIT_POST', 'HACKERNEWS'],
          sort: 'RELEVANCE',
          limit: 5,
          offset: 0,
        },
      },
    ],
    [
      'listMentions without arguments',
      () => client.listMentions(),
      { method: 'GET', path: '/mentions', query: {} },
    ],
    [
      'countMentions',
      () =>
        client.countMentions({
          includeLowRelevance: true,
          keywords: ['reddit monitoring'],
        }),
      {
        method: 'GET',
        path: '/mentions/count',
        query: {
          includeLowRelevance: true,
          keywords: ['reddit monitoring'],
        },
      },
    ],
    [
      'countMentions without arguments',
      () => client.countMentions(),
      { method: 'GET', path: '/mentions/count', query: {} },
    ],
    [
      'updateMentionStatus',
      () =>
        client.updateMentionStatus('8f2c1b0e-4d73-4c2f-9a18-5b6e0d3f7c41', {
          status: 'APPROVED',
        }),
      {
        method: 'PATCH',
        path: '/mentions/8f2c1b0e-4d73-4c2f-9a18-5b6e0d3f7c41/status',
        body: { status: 'APPROVED' },
      },
    ],
    [
      'explainMention',
      () => client.explainMention('8f2c1b0e-4d73-4c2f-9a18-5b6e0d3f7c41'),
      {
        method: 'POST',
        path: '/mentions/8f2c1b0e-4d73-4c2f-9a18-5b6e0d3f7c41/explain',
        idempotent: true,
      },
    ],
    [
      'getAlertSettings',
      () => client.getAlertSettings(),
      { method: 'GET', path: '/alert-settings' },
    ],
    [
      'updateAlertSettings',
      () => client.updateAlertSettings({ enabled: false, cadenceMinutes: 60 }),
      {
        method: 'PUT',
        path: '/alert-settings',
        body: { enabled: false, cadenceMinutes: 60 },
      },
    ],
    [
      'getMeanMarketerConfig',
      () => client.getMeanMarketerConfig(),
      { method: 'GET', path: '/mean-marketer/config' },
    ],
    [
      'updateMeanMarketerConfig',
      () => client.updateMeanMarketerConfig({ enabled: true, minScore: 75 }),
      {
        method: 'PUT',
        path: '/mean-marketer/config',
        body: { enabled: true, minScore: 75 },
      },
    ],
    [
      'pollMeanMarketer',
      () => client.pollMeanMarketer(),
      { method: 'POST', path: '/mean-marketer/poll' },
    ],
    [
      'resetMeanMarketer',
      () => client.resetMeanMarketer(),
      { method: 'POST', path: '/mean-marketer/reset', idempotent: true },
    ],
  ];

  it.each(cases)('%s', async (_name, call, expected) => {
    await call();

    expect(request).toHaveBeenCalledTimes(1);
    expect(lastCall()).toEqual(expected);
  });
});

describe('path building', () => {
  it('encodes ids into a single path segment', async () => {
    await client.getWebsite('ws 4f21/a0');

    expect(lastCall().path).toBe('/websites/ws%204f21%2Fa0');
  });

  it('never sends an absolute url as the path', async () => {
    await client.listWebsites();
    await client.listMentions();
    await client.getAlertSettings();

    for (const [opts] of request.mock.calls) {
      expect(opts.path).toMatch(/^\//);
    }
  });
});

describe('return value', () => {
  it('passes the parsed response through untouched', async () => {
    const websites = { websites: [{ id: '4f21a0c8' }] };
    request.mockResolvedValueOnce(websites);

    await expect(client.listWebsites()).resolves.toBe(websites);
  });

  it('passes a null explain response through instead of throwing', async () => {
    request.mockResolvedValueOnce(null);

    await expect(
      client.explainMention('8f2c1b0e-4d73-4c2f-9a18-5b6e0d3f7c41'),
    ).resolves.toBeNull();
  });
});
