import type { Command } from 'commander';

import {
  activatePendingKeywords,
  addKeywords,
  countMentions,
  deleteKeyword,
  disableKeyword,
  editKeyword,
  enableKeyword,
  getKeywordChangeUsage,
  listWebsites,
  previewActivatePendingKeywords,
  previewKeywordBilling,
} from '../api/client.js';
import {
  MAX_KEYWORD_LENGTH,
  MENTION_STATUSES,
  type Keyword,
  type KeywordBillingPreview,
  type Website,
} from '../api/types.js';
import {
  CliError,
  ExitCode,
  PRODUCT,
  formatId,
  hint,
  isMachine,
  isQuiet,
  notFoundError,
  print,
  printKeyValues,
  printResult,
  printRows,
  printTable,
  promptText,
  spinner,
  success,
  usageError,
  warn,
  type Column,
} from '../core/index.js';

const BILLING_URL = `${PRODUCT.appUrl}/billing`;

export function normalizeKeyword(value: string): string {
  const keyword = value.trim().toLowerCase();
  if (keyword === '') throw usageError('A keyword cannot be empty');
  if (keyword.length > MAX_KEYWORD_LENGTH) {
    throw usageError(
      `"${keyword.slice(0, 32)}…" is ${keyword.length} characters, the limit is ${MAX_KEYWORD_LENGTH}`,
    );
  }
  return keyword;
}

export function normalizeKeywords(values: readonly string[]): string[] {
  return [...new Set(values.map(normalizeKeyword))];
}

export const collectKeyword = (value: string, previous: string[] = []): string[] => [
  ...previous,
  normalizeKeyword(value),
];

export function formatMoney(value: number): string {
  return `$${value.toFixed(2)}`;
}

export interface KeywordLocation {
  website: Website;
  keyword: Keyword;
}

export function findKeyword(websites: readonly Website[], id: string): KeywordLocation | undefined {
  for (const website of websites) {
    const keyword = website.keywords.find((entry) => entry.id === id);
    if (keyword) return { website, keyword };
  }
  return undefined;
}

const KEYWORD_COLUMNS: Column<Keyword>[] = [
  { header: 'ID', value: (keyword) => formatId(keyword.id) },
  { header: 'KEYWORD', value: (keyword) => keyword.value },
  { header: 'STATUS', value: (keyword) => keyword.status },
  {
    header: 'NOTE',
    value: (keyword) => (keyword.status === 'PENDING' ? 'no free slot on this plan' : '—'),
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

async function locate(id: string): Promise<KeywordLocation> {
  const { websites } = await withProgress('Loading keywords…', listWebsites);
  const found = findKeyword(websites, id);
  if (!found) {
    throw notFoundError(
      `No keyword with id "${id}" in this workspace`,
      `list them with: ${PRODUCT.binName} site list`,
    );
  }
  return found;
}

function pendingNote(website: Website): void {
  const pending = website.keywords.filter((keyword) => keyword.status === 'PENDING').length;
  if (pending === 0) return;
  print('');
  print(
    `${pending} pending. Price an upgrade: ${PRODUCT.binName} keyword plan --count ${
      website.keywords.filter((keyword) => keyword.status !== 'DISABLED').length
    }`,
  );
}

async function runAdd(siteId: string, values: string[]): Promise<void> {
  const keywords = normalizeKeywords(values);
  if (keywords.length === 0) throw usageError('Pass at least one keyword');

  const website = await withProgress('Adding keywords…', () => addKeywords(siteId, { keywords }));

  if (isMachine()) {
    printResult('keyword.add', website);
    return;
  }

  const added = website.keywords.filter((keyword) => keywords.includes(keyword.value));
  const active = website.keywords.filter((keyword) => keyword.status === 'ACTIVE').length;

  success(`${website.domain} now has ${website.keywords.length} keywords (${active} active)`);
  if (added.length > 0) {
    print('');
    printTable(added, KEYWORD_COLUMNS);
  }
  pendingNote(website);
}

async function runEdit(id: string, options: { value: string }): Promise<void> {
  const value = normalizeKeyword(options.value);
  const { keyword } = await locate(id);

  if (keyword.value === value) {
    if (isMachine()) {
      printResult('keyword.edit', keyword);
      return;
    }
    print('No change (case-only edit).');
    return;
  }

  const updated = await withProgress('Renaming keyword…', () => editKeyword(id, { value }));

  if (isMachine()) {
    printResult('keyword.edit', updated);
    return;
  }

  success(`${keyword.value} → ${updated.value}`);
  printKeyValues([
    ['status', updated.status],
    ['slot', 'kept, editing is free and unlimited'],
  ]);
}

async function runDisable(id: string): Promise<void> {
  const keyword = await withProgress('Disabling keyword…', () => disableKeyword(id));

  if (isMachine()) {
    printResult('keyword.disable', keyword);
    return;
  }

  success(`"${keyword.value}" is ${keyword.status}`);
  print('Its mentions are kept and it no longer occupies a paid slot. Nothing was charged.');
}

async function runEnable(id: string): Promise<void> {
  const keyword = await withProgress('Enabling keyword…', () => enableKeyword(id));

  if (isMachine()) {
    printResult('keyword.enable', keyword);
    return;
  }

  if (keyword.status === 'PENDING') {
    success(`"${keyword.value}" is PENDING`);
    print('No free slot on this plan, so it is not collecting yet. Nothing was charged.');
    hint(`price an upgrade: ${PRODUCT.binName} keyword plan`);
    return;
  }

  success(`"${keyword.value}" is ${keyword.status}`);
  print('Nothing was charged.');
}

async function runDelete(id: string, options: { yes?: boolean }): Promise<void> {
  const { website, keyword } = await locate(id);
  const { total } = await countMentions({
    websiteId: website.id,
    keywords: [keyword.value],
    statuses: [...MENTION_STATUSES],
    includeLowRelevance: true,
  });

  if (options.yes !== true) {
    warn(
      `Deleting "${keyword.value}" also deletes the ${total} mention${
        total === 1 ? '' : 's'
      } it produced. There is no undo and no refund.`,
    );
    hint(`To pause instead, keeping the mentions: ${PRODUCT.binName} keyword disable ${keyword.id}`);
    const typed = await promptText('Type DELETE to confirm', {
      hint: 'Pass --yes to delete without typing DELETE',
    });
    if (typed.trim() !== 'DELETE') {
      throw new CliError('That is not DELETE, nothing was deleted.', {
        exitCode: ExitCode.CANCELLED,
      });
    }
  }

  const deleted = await deleteKeyword(keyword.id);

  if (isMachine()) {
    printResult('keyword.delete', deleted);
    return;
  }

  success('Deleted');
}

async function runActivatePending(): Promise<void> {
  const { websites } = await withProgress('Activating pending keywords…', activatePendingKeywords);

  if (isMachine()) {
    printResult('keyword.activate-pending', websites, { total: websites.length, hasMore: false });
    return;
  }

  const active = websites.reduce(
    (total, website) => total + website.keywords.filter((keyword) => keyword.status === 'ACTIVE').length,
    0,
  );
  const pending = websites.reduce(
    (total, website) => total + website.keywords.filter((keyword) => keyword.status === 'PENDING').length,
    0,
  );

  success(`${active} active keyword${active === 1 ? '' : 's'} across ${websites.length} site${
    websites.length === 1 ? '' : 's'
  }`);
  print(
    pending === 0
      ? 'Nothing left pending. This never charges.'
      : `${pending} still pending, there was no free slot. This never charges.`,
  );
  if (pending > 0) hint(`price an upgrade: ${PRODUCT.binName} keyword plan --count ${active + pending}`);
}

function printPlan(preview: KeywordBillingPreview): void {
  printRows(
    ['CURRENT', 'TARGET'],
    [
      [
        `${preview.currentPlanName ?? 'no plan'}  ${formatMoney(preview.currentMonthlyPrice)}/mo`,
        `${preview.targetPlanName ?? 'no plan'}  ${formatMoney(preview.targetMonthlyPrice)}/mo  (${
          preview.targetKeywords
        } keywords)`,
      ],
    ],
  );
  print('');
  printKeyValues([
    ['upgrade', preview.isUpgrade ? 'yes' : preview.isDowngrade ? 'no, downgrade' : 'no change'],
    ['charged now', `${formatMoney(preview.immediateCharge)}${preview.isUpgrade ? '   (prorated)' : ''}`],
    ['payment needed', preview.requiresImmediatePayment ? 'yes' : 'no'],
  ]);
  print('');
  print(`Plans change in the ${PRODUCT.displayName} app: ${BILLING_URL}`);
}

async function runPlan(options: { count?: string }): Promise<void> {
  let preview: KeywordBillingPreview;

  if (options.count === undefined) {
    preview = await withProgress('Pricing your pending keywords…', previewActivatePendingKeywords);
  } else {
    const desiredKeywordCount = Number(options.count);
    if (!Number.isInteger(desiredKeywordCount) || desiredKeywordCount < 1) {
      throw usageError(
        `--count must be a whole number of 1 or more, got "${options.count}"`,
        '--count is the account-wide total of active keywords you want, not how many to add',
      );
    }
    preview = await withProgress('Pricing that keyword count…', () =>
      previewKeywordBilling({ desiredKeywordCount }),
    );
  }

  if (isMachine()) {
    printResult('keyword.plan', preview);
    return;
  }

  printPlan(preview);
}

async function runUsage(): Promise<void> {
  const usage = await withProgress('Reading keyword edit usage…', getKeywordChangeUsage);

  if (isMachine()) {
    printResult('keyword.usage', usage);
    return;
  }

  if (usage.unlimited) {
    print('Keyword edits: unlimited (this plan does not meter them).');
    return;
  }

  printKeyValues([
    ['used', String(usage.used)],
    ['limit', String(usage.limit)],
    ['remaining', String(usage.remaining)],
  ]);
}

export function registerKeywordCommands(program: Command): void {
  const keyword = program
    .command('keyword')
    .alias('keywords')
    .alias('kw')
    .description('keywords a site listens for');

  keyword
    .command('add <siteId> <keyword...>')
    .description('add keywords to a site')
    .action(async (siteId: string, values: string[]) => {
      await runAdd(siteId, values);
    });

  keyword
    .command('edit <id>')
    .description('rename a keyword, free and unlimited')
    .requiredOption('--value <keyword>', 'the new keyword')
    .action(async (id: string, options: { value: string }) => {
      await runEdit(id, options);
    });

  keyword
    .command('disable <id>')
    .description('stop collecting for a keyword, keeping its mentions')
    .action(async (id: string) => {
      await runDisable(id);
    });

  keyword
    .command('enable <id>')
    .description('start collecting for a disabled keyword')
    .action(async (id: string) => {
      await runEnable(id);
    });

  keyword
    .command('delete <id>')
    .alias('rm')
    .description('delete a keyword and every mention it produced')
    .action(async (id: string, _options: unknown, command: Command) => {
      await runDelete(id, command.optsWithGlobals() as { yes?: boolean });
    });

  keyword
    .command('activate-pending')
    .description('promote pending keywords into any free slots')
    .action(async () => {
      await runActivatePending();
    });

  keyword
    .command('plan')
    .description('price the plan a keyword count needs')
    .option('--count <n>', 'account-wide total of active keywords you want, not an increment')
    .action(async (options: { count?: string }) => {
      await runPlan(options);
    });

  keyword
    .command('usage')
    .description('how many keyword edits this plan allows')
    .action(async () => {
      await runUsage();
    });
}
