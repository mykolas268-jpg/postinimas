import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runArticle } from './article.js';
import { loadPipelineConfig } from './config.js';
import { BudgetExceededError, CostLedger } from './costs.js';
import { aggregateRound, renderReport, type EvalSummary } from './eval.js';
import { AnthropicLlmClient } from './llm/anthropic.js';
import type { LlmClient } from './llm/client.js';
import { FixtureLlmClient } from './llm/fixture.js';
import { log, setRunId } from './log.js';
import { formatNotification, sendTelegram, type CostAlert, type NotifyEvent } from './notify.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const USAGE = `Usage: npm run pipeline -- <command> [options]

Commands
  article      Research and write one article (Phase 2, shadow mode)
                 --topic "…"          topic (or --backlog <n>)
                 --backlog <n>        use item n (1-based) from config/backlog.yml
                 --eval-topic <n>     use item n from config/eval-topics.yml
                 --ledger-mirror <f>  also append every cost entry to file f
                 --type guide|news|comparison   (default guide)
                 --cluster <key>      topic cluster from config/topics.yml
                 --keyword "…"        primary Lithuanian keyword
  eval-report  Aggregate an eval round: --in <dir> --round <id> [--state <dir>]
  notify       Owner notification (Telegram if TELEGRAM_BOT_TOKEN/CHAT_ID are set):
                 --kind article --dir <out> [--pr-url U] [--verify <result>] [--no-pr dry-run|backpressure|publish-failed]
                 --kind eval --summary <summary.json> [--report-url U] [--state <dir>]
  audit-site   Read-only live checks of the site (docs/live-site-check.sh)
  run | refresh | report   Not available yet (Phases 3–5)

Common options
  --site <dir>       checkout of the site repo (default ./site)
  --state <dir>      state branch checkout (default ./state)
  --out <dir>        artifact directory (default ./out/<run id>)
  --dry-run          no state writes; still enforces every cost cap
  --fixtures <dir>   replay recorded model outputs (no API calls, no cost)
  --no-link-check    skip HTTP checks of outbound links
  --mode shadow      only shadow mode exists until Phase 4

Kill switch: PIPELINE_PAUSED=true stops every command before it does anything.`;

interface Args {
  command: string;
  flags: Map<string, string | true>;
}

function parseArgs(argv: string[]): Args {
  const [command = 'help', ...rest] = argv;
  const flags = new Map<string, string | true>();
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
    const key = arg.slice(2);
    const next = rest[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags.set(key, next);
      index += 1;
    } else {
      flags.set(key, true);
    }
  }
  return { command, flags };
}

function flag(args: Args, key: string): string | undefined {
  const value = args.flags.get(key);
  return typeof value === 'string' ? value : undefined;
}

function vilniusDate(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Environment may lower (never raise) the per-article cap, e.g. for parallel eval jobs. */
function applyCapOverride(pc: ReturnType<typeof loadPipelineConfig>): void {
  const override = Number(process.env.PIPELINE_MAX_ARTICLE_USD);
  if (Number.isFinite(override) && override > 0 && override < pc.config.caps.perArticleUsd) {
    pc.config.caps.perArticleUsd = override;
    log.info('cap_override', { perArticleUsd: override });
  }
}

async function commandArticle(args: Args): Promise<number> {
  const pc = loadPipelineConfig(path.join(ROOT, 'config'));
  applyCapOverride(pc);
  const mode = (flag(args, 'mode') ?? pc.config.mode) as 'shadow' | 'approval' | 'auto';
  if (mode !== 'shadow') {
    throw new Error(`Mode "${mode}" is not available until Phase 4; only shadow mode runs now.`);
  }

  const today = vilniusDate(new Date(), pc.config.timezone);
  const runId = process.env.GITHUB_RUN_ID ? `gh-${process.env.GITHUB_RUN_ID}` : `${today}-${Date.now().toString(36)}`;
  setRunId(runId);

  let topic = flag(args, 'topic');
  let type = (flag(args, 'type') ?? 'guide') as 'guide' | 'news' | 'comparison';
  let clusterKey = flag(args, 'cluster');
  let keyword = flag(args, 'keyword');
  const backlogIndex = flag(args, 'backlog');
  const evalIndex = flag(args, 'eval-topic');
  if (backlogIndex || evalIndex) {
    const list = evalIndex ? pc.evalTopics : pc.backlog;
    const number = evalIndex ?? backlogIndex;
    const item = list[Number(number) - 1];
    if (!item) throw new Error(`No ${evalIndex ? 'eval topic' : 'backlog item'} ${number} (have ${list.length})`);
    topic = item.topic;
    type = item.type;
    clusterKey = item.cluster;
    keyword = item.keyword ?? keyword;
  }
  if (!topic) throw new Error('--topic or --backlog is required');
  if (!['guide', 'news', 'comparison'].includes(type)) throw new Error(`Bad --type ${type}`);
  const cluster = pc.clusters.find((item) => item.key === (clusterKey ?? pc.clusters[0]!.key));
  if (!cluster) throw new Error(`Unknown cluster "${clusterKey}". Known: ${pc.clusters.map((c) => c.key).join(', ')}`);

  const dryRun = args.flags.has('dry-run');
  const fixtures = flag(args, 'fixtures');
  const siteDir = path.resolve(flag(args, 'site') ?? 'site');
  const stateDir = path.resolve(flag(args, 'state') ?? 'state');
  const outDir = path.resolve(flag(args, 'out') ?? path.join('out', runId));

  const mirror = flag(args, 'ledger-mirror');
  const ledger = new CostLedger(pc.config, runId, fs.existsSync(stateDir) ? stateDir : null, {
    persist: !dryRun && !fixtures,
    ...(mirror ? { mirrorFile: path.resolve(mirror) } : {}),
  });
  const llm: LlmClient = fixtures
    ? new FixtureLlmClient(path.resolve(fixtures), ledger)
    : new AnthropicLlmClient(pc.config, ledger);

  const writeMeta = (exitCode: number, error?: string) => {
    fs.mkdirSync(outDir, { recursive: true });
    const meta = {
      topic,
      type,
      cluster: cluster.key,
      keyword: keyword ?? null,
      exitCode,
      costUsd: Number(ledger.runTotal.toFixed(4)),
      costAlerts: ledger.costAlerts,
      ...(error ? { error } : {}),
    };
    fs.writeFileSync(path.join(outDir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
  };

  let outcome;
  try {
    outcome = await runArticle(
    { topic, type, cluster, ...(keyword ? { keyword } : {}) },
    {
      pc,
      llm,
      ledger,
      siteDir,
      outDir,
      promptsDir: path.join(ROOT, 'prompts'),
      today,
      mode,
      checkLinks: !args.flags.has('no-link-check') && !fixtures,
    },
  );
  } catch (error) {
    writeMeta(1, error instanceof Error ? error.message : String(error));
    throw error;
  }
  const exitCode = outcome.status === 'ready' ? 0 : outcome.status === 'failed' ? 3 : 4;
  writeMeta(exitCode, outcome.reason);

  if (!dryRun && !fixtures && fs.existsSync(stateDir)) {
    const runDir = path.join(stateDir, 'runs', `${today}-${outcome.slug ?? 'aborted'}`);
    fs.mkdirSync(runDir, { recursive: true });
    for (const file of fs.readdirSync(outDir)) {
      if (/\.(json|md|mdx)$/.test(file)) fs.copyFileSync(path.join(outDir, file), path.join(runDir, file));
    }
    fs.appendFileSync(
      path.join(stateDir, 'runs.jsonl'),
      `${JSON.stringify({ ts: new Date().toISOString(), run: runId, command: 'article', topic, ...outcome })}\n`,
    );
  }

  log.info('article_outcome', { ...outcome, outDir });
  process.stdout.write(`${JSON.stringify({ ...outcome, outDir }, null, 2)}\n`);
  // GitHub Actions output for the workflow's later jobs
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `status=${outcome.status}\nslug=${outcome.slug ?? ''}\nout_dir=${outDir}\n`,
    );
  }
  return exitCode;
}

/** Exits 1 if spending `--usd` more this month would break the monthly cap. */
function commandBudgetCheck(args: Args): number {
  const pc = loadPipelineConfig(path.join(ROOT, 'config'));
  const usd = Number(flag(args, 'usd') ?? '0');
  const stateDir = path.resolve(flag(args, 'state') ?? 'state');
  const ledger = new CostLedger(pc.config, 'budget-check', fs.existsSync(stateDir) ? stateDir : null, { persist: false });
  const after = ledger.monthToDate + usd;
  const ok = after <= pc.config.caps.monthlyUsd;
  process.stdout.write(
    `month-to-date ${ledger.monthToDate.toFixed(2)} USD + planned ${usd.toFixed(2)} USD = ${after.toFixed(2)} USD (cap ${pc.config.caps.monthlyUsd}) → ${ok ? 'OK' : 'OVER CAP'}\n`,
  );
  return ok ? 0 : 1;
}

function commandEvalReport(args: Args): number {
  const inDir = path.resolve(flag(args, 'in') ?? 'eval-in');
  const round = flag(args, 'round') ?? 'local';
  const stateArg = flag(args, 'state');
  const { summary, ledger } = aggregateRound(inDir, round);
  const report = renderReport(summary);

  if (stateArg) {
    const stateDir = path.resolve(stateArg);
    const roundDir = path.join(stateDir, 'evals', `round-${round}`);
    fs.mkdirSync(roundDir, { recursive: true });
    fs.writeFileSync(path.join(roundDir, 'report.md'), `${report}\n`);
    fs.writeFileSync(path.join(roundDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
    for (const name of fs.readdirSync(inDir)) {
      const source = path.join(inDir, name);
      if (!fs.statSync(source).isDirectory()) continue;
      const target = path.join(roundDir, name.replace(/^eval-/, ''));
      fs.mkdirSync(target, { recursive: true });
      for (const file of fs.readdirSync(source)) {
        if (/\.(json|jsonl|md|mdx|txt)$/.test(file)) fs.copyFileSync(path.join(source, file), path.join(target, file));
      }
    }
    // Eval jobs run with --dry-run; their real spend goes into the ledger here.
    if (ledger.length) {
      fs.appendFileSync(path.join(stateDir, 'costs.jsonl'), ledger.map((entry) => JSON.stringify(entry)).join('\n') + '\n');
    }
  }
  process.stdout.write(`${report}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
  return 0;
}

function readJsonFile<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** Formats the owner notification for a finished run and sends it if Telegram is configured. */
async function commandNotify(args: Args): Promise<number> {
  const pc = loadPipelineConfig(path.join(ROOT, 'config'));
  const runUrl = process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : 'vietinis paleidimas';
  let event: NotifyEvent;
  if (flag(args, 'kind') === 'eval') {
    const summary = readJsonFile<EvalSummary>(path.resolve(flag(args, 'summary') ?? 'summary.json'));
    if (!summary) throw new Error('notify --kind eval: --summary file missing or unreadable');
    const stateArg = flag(args, 'state');
    const ledger = stateArg ? new CostLedger(pc.config, 'notify', path.resolve(stateArg), { persist: false }) : null;
    const crossed = ledger ? pc.config.caps.alertAtFractions.filter((fraction) => ledger.monthToDate >= fraction * pc.config.caps.monthlyUsd) : [];
    event = {
      kind: 'eval',
      round: summary.round,
      ready: summary.ready,
      topics: summary.topics,
      passRate: summary.passRate,
      costUsd: summary.totalCostUsd,
      ...(flag(args, 'report-url') ? { reportUrl: flag(args, 'report-url')! } : {}),
      ...(ledger && crossed.length
        ? { costAlerts: [{ fraction: Math.max(...crossed), monthToDate: Number(ledger.monthToDate.toFixed(2)), cap: pc.config.caps.monthlyUsd }] }
        : {}),
      runUrl,
    };
  } else {
    const dir = path.resolve(flag(args, 'dir') ?? 'out/run');
    const meta = readJsonFile<{ topic: string; exitCode: number; error?: string; costUsd?: number; costAlerts?: CostAlert[] }>(path.join(dir, 'meta.json'));
    const summary = readJsonFile<{ status: 'ready' | 'failed'; title: string; attempts: number; costUsd: number }>(path.join(dir, 'summary.json'));
    const noPr = flag(args, 'no-pr');
    event = {
      kind: 'article',
      status: summary?.status ?? (meta?.exitCode === 4 ? 'aborted' : 'error'),
      topic: meta?.topic ?? '(nežinoma)',
      ...(summary?.title ? { title: summary.title } : {}),
      ...(meta?.error ? { reason: meta.error.slice(0, 500) } : {}),
      ...(summary?.attempts ? { attempts: summary.attempts } : {}),
      ...(summary?.costUsd !== undefined ? { costUsd: summary.costUsd } : meta?.costUsd !== undefined ? { costUsd: meta.costUsd } : {}),
      ...(flag(args, 'verify') ? { verify: flag(args, 'verify')! } : {}),
      ...(flag(args, 'pr-url') ? { prUrl: flag(args, 'pr-url')! } : {}),
      ...(noPr === 'dry-run' || noPr === 'backpressure' || noPr === 'publish-failed' ? { noPrReason: noPr } : {}),
      ...(meta?.costAlerts?.length ? { costAlerts: meta.costAlerts } : {}),
      runUrl,
    };
  }
  const text = formatNotification(event);
  process.stdout.write(`${text}\n`);
  const result = await sendTelegram(text, { token: process.env.TELEGRAM_BOT_TOKEN, chatId: process.env.TELEGRAM_CHAT_ID });
  if (result === 'skipped') process.stdout.write('(Telegram not configured — message not sent)\n');
  // Best-effort: a failed notification must not fail the run, but it must be visible.
  if (result === 'failed' && process.env.GITHUB_ACTIONS) process.stdout.write('::warning::Telegram notification failed\n');
  return 0;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (process.env.PIPELINE_PAUSED === 'true') {
    log.warn('paused', { command: args.command });
    process.stdout.write('Pipeline is paused (PIPELINE_PAUSED=true). Nothing was done.\n');
    return 0;
  }
  switch (args.command) {
    case 'article':
      return commandArticle(args);
    case 'eval-report':
      return commandEvalReport(args);
    case 'budget-check':
      return commandBudgetCheck(args);
    case 'notify':
      return commandNotify(args);
    case 'audit-site': {
      const base = flag(args, 'url') ?? 'https://verslas.ai';
      return spawnSync('bash', [path.join(ROOT, 'docs', 'live-site-check.sh'), base], { stdio: 'inherit' }).status ?? 1;
    }
    case 'run':
    case 'refresh':
    case 'report':
      process.stderr.write(`"${args.command}" is not implemented yet (see docs/PLAN.md § 10).\n`);
      return 2;
    default:
      process.stdout.write(`${USAGE}\n`);
      return args.command === 'help' ? 0 : 1;
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    if (error instanceof BudgetExceededError) {
      log.error('budget_exceeded', { message: error.message });
    } else {
      log.error('fatal', { message: error instanceof Error ? error.message : String(error) });
    }
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);
