#!/usr/bin/env node
// CLI da coleção earnings-analysis/.
//
// Comandos:
//   earnings publish   grava uma leitura (usado pelo skill analise-de-resultados-v2)
//   earnings get       lê uma leitura de uma empresa/período
//   earnings list      lista os registros disponíveis
//   earnings latest    mostra o registro mais recente
//   earnings path      imprime o caminho do diretório de uma empresa/período
//   earnings reindex   recria o index.json varrendo earnings-analysis/
//
// Zero dependências. `git` só é invocado se --commit/--push forem passados.

import { promises as fs } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import {
  publish, get, getMeta, list, latest, reindex,
  recordDir, recordRelPath, STORE_ROOT, READINGS,
} from '../lib/earnings-store.js';

// STORE_ROOT is the earnings-analysis/ collection dir; git commands run from
// the repo root one level up (the equities-store checkout).
const REPO_ROOT = path.resolve(STORE_ROOT, '..');
const COLLECTION = 'earnings-analysis';

// ------------------------------ parse de flags ------------------------------

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

async function readMaybeFileOrStdin(value, stdinRequested) {
  if (stdinRequested) return readStdin();
  if (value === undefined) return undefined;
  return fs.readFile(value, 'utf8');
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function fail(msg) {
  process.stderr.write(`erro: ${msg}\n`);
  process.exit(1);
}

// ------------------------------ git opcional --------------------------------

function runGit(args) {
  const r = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} falhou: ${r.stderr || r.stdout}`);
  }
  return r.stdout;
}

function gitCommitPush({ company, period, reading, commit, push, branch }) {
  const relDir = path.posix.join(COLLECTION, recordRelPath(company, period));
  runGit(['add', relDir, path.posix.join(COLLECTION, 'index.json')]);
  const status = spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: REPO_ROOT });
  if (status.status === 0) return { committed: false, pushed: false };

  if (commit || push) {
    runGit(['commit', '-m', `earnings(${reading}): ${company} ${period}`]);
  }
  if (push) {
    const args = ['push'];
    if (branch) args.push('-u', 'origin', branch);
    runGit(args);
    return { committed: true, pushed: true };
  }
  return { committed: true, pushed: false };
}

// ------------------------------ comandos ------------------------------------

async function cmdPublish(flags) {
  const { company, period } = flags;
  const reading = flags.reading || 'primeira';
  if (!company) fail('--company é obrigatório (o slug de fichas/<slug>.md, ex.: vibra).');
  if (!period) fail('--period é obrigatório (ex.: 2026Q1 para 1T26).');
  if (!READINGS.includes(reading)) fail(`--reading deve ser um de: ${READINGS.join(', ')}.`);

  const md = await readMaybeFileOrStdin(flags.md, flags.md === true || flags.stdin === 'md');

  let meta;
  if (flags.meta) {
    const raw = flags.meta === true ? await readStdin() : await fs.readFile(flags.meta, 'utf8');
    meta = JSON.parse(raw);
  }

  const res = await publish({ company, period, reading, md, meta });
  process.stdout.write(`gravado: ${path.relative(REPO_ROOT, res.dir)} [${res.files.join(', ')}]\n`);

  if (flags.commit || flags.push) {
    const g = gitCommitPush({
      company, period, reading,
      commit: !!flags.commit, push: !!flags.push,
      branch: typeof flags.push === 'string' ? flags.push : flags.branch,
    });
    process.stdout.write(`git: committed=${g.committed} pushed=${g.pushed}\n`);
  }
}

async function cmdGet(positional, flags) {
  const company = positional[0] || flags.company;
  const period = positional[1] || flags.period;
  if (!company || !period) {
    fail('informe empresa e período: earnings get <company> <period> [--reading primeira|segunda|terceira] [--format md|meta]');
  }
  const reading = flags.reading || 'primeira';
  const format = flags.format || 'md';
  const content = await get(company, period, { reading, format });
  if (content == null) {
    fail(`não encontrado: ${company} ${period} (reading=${reading}, format=${format}).`);
  }
  if (format === 'meta') {
    process.stdout.write(JSON.stringify(content, null, 2) + '\n');
  } else {
    process.stdout.write(content);
  }
}

async function cmdList(flags) {
  const rows = await list({
    company: flags.company,
    reading: flags.reading,
    limit: flags.limit ? Number(flags.limit) : undefined,
  });
  if (flags.json) {
    process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
    return;
  }
  if (rows.length === 0) {
    process.stdout.write('(nenhuma análise gravada ainda)\n');
    return;
  }
  for (const r of rows) {
    process.stdout.write(`${r.company}  ${r.period}  [${(r.readings || []).join(', ') || '-'}]  ${r.path}\n`);
  }
}

async function cmdLatest(flags) {
  const r = await latest({ company: flags.company, reading: flags.reading });
  if (!r) fail('nenhuma análise gravada ainda.');
  if (flags.json) {
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  } else {
    process.stdout.write(`${r.company}  ${r.period}  [${(r.readings || []).join(', ')}]  ${r.path}\n`);
  }
}

async function cmdPath(positional, flags) {
  const company = positional[0] || flags.company;
  const period = positional[1] || flags.period;
  if (!company || !period) fail('informe empresa e período: earnings path <company> <period>');
  process.stdout.write((flags.abs ? recordDir(company, period) : recordRelPath(company, period)) + '\n');
}

async function cmdReindex() {
  const idx = await reindex();
  process.stdout.write(`index reconstruído: ${idx.records.length} registro(s).\n`);
}

const HELP = `earnings-analysis — CLI

Uso:
  earnings publish --company vibra --period 2026Q1 --reading primeira|segunda|terceira
                   [--md FILE|--stdin md] [--meta FILE] [--commit] [--push [BRANCH]]
  earnings get <company> <period> [--reading primeira|segunda|terceira] [--format md|meta]
  earnings list [--company C] [--reading R] [--limit N] [--json]
  earnings latest [--company C] [--reading R] [--json]
  earnings path <company> <period> [--abs]
  earnings reindex

Exemplos:
  # gravar a primeira leitura do 1T26 da Vibra e dar push (usado pelo skill)
  earnings publish --company vibra --period 2026Q1 --reading primeira \\
                   --md analise.md --meta meta.json --push

  # outro agente lê a segunda leitura da Equatorial no 4T25
  earnings get equatorial 2025Q4 --reading segunda
`;

async function main() {
  const [, , cmd, ...rest] = process.argv;
  const { positional, flags } = parseArgs(rest);
  try {
    switch (cmd) {
      case 'publish': return await cmdPublish(flags);
      case 'get': return await cmdGet(positional, flags);
      case 'list': return await cmdList(flags);
      case 'latest': return await cmdLatest(flags);
      case 'path': return await cmdPath(positional, flags);
      case 'reindex': return await cmdReindex();
      case undefined:
      case 'help':
      case '--help':
      case '-h':
        process.stdout.write(HELP);
        return;
      default:
        fail(`comando desconhecido: "${cmd}". Rode "earnings help".`);
    }
  } catch (err) {
    fail(err.message);
  }
}

main();
