import type { Command } from 'commander';

import {
  getAlertSettings,
  getMeanMarketerConfig,
  pollMeanMarketer,
  resetMeanMarketer,
  updateAlertSettings,
  updateMeanMarketerConfig,
} from '../api/client.js';
import {
  ALERT_CADENCES,
  MEAN_MARKETER_MAX_SCORE,
  MEAN_MARKETER_MIN_SCORE,
  type AlertSettings,
  type MeanMarketerConfig,
  type MeanMarketerPollResult,
  type UpdateMeanMarketerConfigRequest,
} from '../api/types.js';
import {
  PRODUCT,
  formatId,
  hint,
  isMachine,
  isQuiet,
  print,
  printKeyValues,
  printResult,
  spinner,
  success,
  usageError,
  warn,
} from '../core/index.js';

const EXPERIMENTAL = 'experimental, undocumented API';

export function formatCadence(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

export function assertCadence(value: string): number {
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || !(ALERT_CADENCES as readonly number[]).includes(minutes)) {
    throw usageError(
      `--cadence must be one of ${ALERT_CADENCES.join(', ')} minutes, got "${value}"`,
      'the server rejects anything else with a generic 400',
    );
  }
  return minutes;
}

export function assertMinScore(value: string): number {
  const score = Number(value);
  if (
    !Number.isInteger(score) ||
    score < MEAN_MARKETER_MIN_SCORE ||
    score > MEAN_MARKETER_MAX_SCORE
  ) {
    throw usageError(
      `--min-score must be a whole number between ${MEAN_MARKETER_MIN_SCORE} and ${MEAN_MARKETER_MAX_SCORE}, got "${value}"`,
    );
  }
  return score;
}

async function withProgress<T>(label: string, operation: () => Promise<T>): Promise<T> {
  const progress = isQuiet() || isMachine() ? null : spinner(label);
  try {
    return await operation();
  } finally {
    progress?.stop();
  }
}

function printAlertSettings(settings: AlertSettings): void {
  printKeyValues([
    ['enabled', settings.enabled ? 'yes' : 'no'],
    ['cadence', formatCadence(settings.cadenceMinutes)],
    ['fastest', `${formatCadence(settings.minIntervalMinutes)} on this plan`],
    ['options', settings.availableCadences.join(', ')],
  ]);
}

async function runAlertsGet(): Promise<void> {
  const settings = await withProgress('Reading alert settings…', getAlertSettings);

  if (isMachine()) {
    printResult('alerts.get', settings);
    return;
  }

  printAlertSettings(settings);
  hint(`the full server list is ${ALERT_CADENCES.join(', ')}; yours is what the plan allows`);
}

interface AlertsSetOptions {
  on?: boolean;
  off?: boolean;
  cadence?: string;
}

async function runAlertsSet(options: AlertsSetOptions): Promise<void> {
  if (options.on === true && options.off === true) {
    throw usageError('Pass either --on or --off, not both');
  }
  if (options.on !== true && options.off !== true) {
    throw usageError('Pass --on or --off', `${PRODUCT.binName} alerts set --on --cadence 60`);
  }

  const cadence = options.cadence === undefined ? undefined : assertCadence(options.cadence);
  const current = await withProgress('Reading alert settings…', getAlertSettings);

  if (cadence !== undefined && !current.availableCadences.includes(cadence)) {
    warn(
      `${formatCadence(cadence)} is not in this plan's cadences (${current.availableCadences.join(
        ', ',
      )}), so the server may refuse it.`,
    );
  }

  const cadenceMinutes = cadence ?? current.cadenceMinutes;
  const settings = await withProgress('Saving alert settings…', () =>
    updateAlertSettings({ enabled: options.on === true, cadenceMinutes }),
  );

  if (isMachine()) {
    printResult('alerts.set', settings);
    return;
  }

  success(
    settings.enabled
      ? `Alerts on every ${formatCadence(settings.cadenceMinutes)}`
      : `Alerts off (cadence ${cadence === undefined ? 'kept at' : 'set to'} ${formatCadence(
          settings.cadenceMinutes,
        )})`,
  );
  if (cadence === undefined) {
    hint('PUT /alert-settings is a full replace, so the current cadence was read and resent.');
  }
}

export function registerAlertCommands(program: Command): void {
  const alerts = program
    .command('alerts')
    .alias('alert')
    .description('email alert cadence for new mentions');

  alerts
    .command('get')
    .alias('list')
    .description('show the alert settings')
    .action(async () => {
      await runAlertsGet();
    });

  alerts
    .command('set')
    .description('turn alerts on or off and choose the cadence')
    .option('--on', 'enable alerts')
    .option('--off', 'disable alerts')
    .option('--cadence <minutes>', `one of ${ALERT_CADENCES.join(', ')}`)
    .action(async (options: AlertsSetOptions) => {
      await runAlertsSet(options);
    });
}

function printMeanMarketerConfig(config: MeanMarketerConfig): void {
  printKeyValues([
    ['enabled', config.enabled ? 'yes' : 'no'],
    ['min score', String(config.minScore)],
    ['site', config.websiteId === null ? 'every site' : formatId(config.websiteId)],
    ['profanity', config.profanity ? 'yes' : 'no'],
  ]);
}

async function runMeanMarketerConfig(): Promise<void> {
  const config = await withProgress('Reading mean marketer config…', getMeanMarketerConfig);

  if (isMachine()) {
    printResult('mean-marketer.config', config, { experimental: true });
    return;
  }

  printMeanMarketerConfig(config);
  hint(EXPERIMENTAL);
}

interface MeanMarketerSetOptions {
  on?: boolean;
  off?: boolean;
  minScore?: string;
  site?: string;
  profanity?: boolean;
}

async function runMeanMarketerConfigSet(options: MeanMarketerSetOptions): Promise<void> {
  if (options.on === true && options.off === true) {
    throw usageError('Pass either --on or --off, not both');
  }

  const body: UpdateMeanMarketerConfigRequest = {};
  if (options.on === true) body.enabled = true;
  if (options.off === true) body.enabled = false;
  if (options.minScore !== undefined) body.minScore = assertMinScore(options.minScore);
  if (options.site !== undefined) {
    const site = options.site.trim();
    body.websiteId = site === '' || site.toLowerCase() === 'none' ? null : site;
  }
  if (options.profanity !== undefined) body.profanity = options.profanity;

  if (Object.keys(body).length === 0) {
    throw usageError(
      'Nothing to change.',
      'Pass at least one of --on, --off, --min-score, --site, --profanity or --no-profanity',
    );
  }

  const config = await withProgress('Saving mean marketer config…', () =>
    updateMeanMarketerConfig(body),
  );

  if (isMachine()) {
    printResult('mean-marketer.config.set', config, { experimental: true });
    return;
  }

  success('Saved');
  printMeanMarketerConfig(config);
  hint(EXPERIMENTAL);
}

function printPollResult(result: MeanMarketerPollResult): void {
  printKeyValues([
    ['enabled', result.enabled ? 'yes' : 'no'],
    ['min score', String(result.minScore)],
    ['mood', result.beMean ? `mean, tier ${result.tier}` : `civil, tier ${result.tier}`],
    ['strikes', String(result.strikes)],
  ]);

  if (result.previous) {
    print('');
    print('previous opportunity');
    printKeyValues(
      [
        ['id', result.previous.id],
        ['status', result.previous.status],
        ['triaged', result.previous.triaged ? 'yes' : 'no'],
        ['outstanding', `${result.previous.hoursOutstanding}h`],
      ],
      '    ',
    );
  }

  if (result.opportunity) {
    print('');
    print('new opportunity');
    printKeyValues(
      [
        ['id', result.opportunity.id],
        ['title', result.opportunity.title ?? '—'],
        ['source', result.opportunity.subreddit ? `r/${result.opportunity.subreddit}` : result.opportunity.source],
        ['keyword', result.opportunity.keyword ?? '—'],
        ['score', result.opportunity.relevanceScore === null ? '—' : String(result.opportunity.relevanceScore)],
        ['url', result.opportunity.url ?? '—'],
      ],
      '    ',
    );
    if (result.opportunity.relevanceReason) {
      print('');
      print(`    ${result.opportunity.relevanceReason}`);
    }
  } else if (result.noNewOpportunity) {
    print('');
    print('No new opportunity above the minimum score.');
  }

  if (result.message) {
    print('');
    print(result.message);
  }
}

async function runMeanMarketerPoll(): Promise<void> {
  const result = await withProgress('Polling…', pollMeanMarketer);

  if (isMachine()) {
    printResult('mean-marketer.poll', result, { experimental: true });
    return;
  }

  printPollResult(result);
  hint(`${EXPERIMENTAL}; this call advances the strike state`);
}

async function runMeanMarketerReset(): Promise<void> {
  const result = await withProgress('Resetting…', resetMeanMarketer);

  if (isMachine()) {
    printResult('mean-marketer.reset', result, { experimental: true });
    return;
  }

  if (result.reset) success('Strike state reset');
  else print('Nothing to reset.');
  hint(EXPERIMENTAL);
}

export function registerMeanMarketerCommands(program: Command): void {
  const meanMarketer = program
    .command('mean-marketer', { hidden: true })
    .alias('mm')
    .description(`nag yourself into replying (${EXPERIMENTAL})`);

  const config = meanMarketer
    .command('config')
    .description('show the mean marketer config')
    .action(async () => {
      await runMeanMarketerConfig();
    });

  config
    .command('set')
    .description('change the mean marketer config')
    .option('--on', 'enable it')
    .option('--off', 'disable it')
    .option(
      '--min-score <n>',
      `only nag about mentions scoring this or higher, ${MEAN_MARKETER_MIN_SCORE} to ${MEAN_MARKETER_MAX_SCORE}`,
    )
    .option('--site <id>', 'restrict it to one site, or "none" for every site')
    .option('--profanity', 'allow profanity')
    .option('--no-profanity', 'keep it clean')
    .action(async (options: MeanMarketerSetOptions) => {
      await runMeanMarketerConfigSet(options);
    });

  meanMarketer
    .command('poll')
    .description('ask for the next opportunity and advance the strike state')
    .action(async () => {
      await runMeanMarketerPoll();
    });

  meanMarketer
    .command('reset')
    .description('clear the strike state')
    .action(async () => {
      await runMeanMarketerReset();
    });
}
