import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runArticle } from './article.js';
import { loadPipelineConfig } from './config.js';
import { BudgetExceededError, CostLedger } from './costs.js';
import { AnthropicLlmClient } from './llm/anthropic.js';
import type { LlmClient } from './llm/client.js';
import { FixtureLlmClient } from './llm/fixture.js';
import { log, setRunId } from './log.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const USAGE = `Usage: npm run pipeline -- <command> [options]

Commands
  article      Research and write one article (Phase 2, shadow mode)
                 --topic "…"          topic (or --backlog <n>)
                 --backlog <n>        use item n (1-based) from config/backlog.yml
                 --type guide|news|comparison   (default guide)
                 --cluster <key>      topic cluster from config/topics.yml
                 --keyword "…"        primary Lithuanian keyword
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

async function commandArticle(args: Args): Promise<number> {
  const pc = loadPipelineConfig(path.join(ROOT, 'config'));
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
  if (backlogIndex) {
    const item = pc.backlog[Number(backlogIndex) - 1];
    if (!item) throw new Error(`No backlog item ${backlogIndex} (have ${pc.backlog.length})`);
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

  const ledger = new CostLedger(pc.config, runId, fs.existsSync(stateDir) ? stateDir : null, { persist: !dryRun && !fixtures });
  const llm: LlmClient = fixtures
    ? new FixtureLlmClient(path.resolve(fixtures), ledger)
    : new AnthropicLlmClient(pc.config, ledger);

  const outcome = await runArticle(
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
  return outcome.status === 'ready' ? 0 : outcome.status === 'failed' ? 3 : 4;
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
