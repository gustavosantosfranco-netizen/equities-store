#!/usr/bin/env node
// CLI do @vinci/news-digest-store.
//
// Comandos:
//   digest publish   grava um digest (usado pelos skills no fim da run)
//   digest get       lê um digest de um dia específico (granularidade diária)
//   digest list      lista os dias disponíveis
//   digest latest    mostra o dia mais recente
//   digest path      imprime o caminho do diretório de um dia
//   digest reindex   recria o index.json varrendo digests/
//
// Zero dependências. `git` só é invocado se --commit/--push forem passados.

import { promises as fs } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import {
  publish, get, getMeta, list, latest, reindex,
  dayDir, dayRelPath, STORE_ROOT, KINDS,
} from '../lib/store.js';

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
        flags[key] = true; // booleana
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
  const r = spawnSync('git', args, { cwd: STORE_ROOT, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} falhou: ${r.stderr || r.stdout}`);
  }
  return r.stdout;
}

function gitCommitPush({ date, kind, commit, push, branch }) {
  const relDir = dayRelPath(date);
  runGit(['add', relDir, 'index.json']);
  // Nada staged? evita erro de "nothing to commit".
  const status = spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: STORE_ROOT });
  if (status.status === 0) return { committed: false, pushed: false };

  if (commit || push) {
    runGit(['commit', '-m', `digest(${kind}): ${date}`]);
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
  const date = flags.date;
  const kind = flags.kind || 'full';
  if (!date) fail('--date YYYY-MM-DD é obrigatório.');
  if (!KINDS.includes(kind)) fail(`--kind deve ser um de: ${KINDS.join(', ')}.`);

  const md = await readMaybeFileOrStdin(flags.md, flags.md === true || flags.stdin === 'md');
  const html = await readMaybeFileOrStdin(flags.html, flags.html === true || flags.stdin === 'html');

  let meta;
  if (flags.meta) {
    const raw = flags.meta === true ? await readStdin() : await fs.readFile(flags.meta, 'utf8');
    meta = JSON.parse(raw);
  }

  const res = await publish({ date, kind, md, html, meta });
  process.stdout.write(`gravado: ${path.relative(STORE_ROOT, res.dir)} [${res.files.join(', ')}]\n`);

  if (flags.commit || flags.push) {
    const g = gitCommitPush({
      date, kind,
      commit: !!flags.commit, push: !!flags.push,
      branch: typeof flags.push === 'string' ? flags.push : flags.branch,
    });
    process.stdout.write(`git: committed=${g.committed} pushed=${g.pushed}\n`);
  }
}

async function cmdGet(positional, flags) {
  const date = positional[0] || flags.date;
  if (!date) fail('informe a data: digest get YYYY-MM-DD [--kind full|incremental] [--format md|html|meta]');
  const kind = flags.kind || 'full';
  const format = flags.format || 'md';
  const content = await get(date, { kind, format });
  if (content == null) {
    fail(`não encontrado: ${date} (kind=${kind}, format=${format}).`);
  }
  if (format === 'meta') {
    process.stdout.write(JSON.stringify(content, null, 2) + '\n');
  } else {
    process.stdout.write(content);
  }
}

async function cmdList(flags) {
  const rows = await list({
    limit: flags.limit ? Number(flags.limit) : undefined,
    kind: flags.kind,
  });
  if (flags.json) {
    process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
    return;
  }
  if (rows.length === 0) {
    process.stdout.write('(nenhum digest gravado ainda)\n');
    return;
  }
  for (const r of rows) {
    process.stdout.write(`${r.date}  [${(r.runs || []).join(', ') || '-'}]  ${r.path}\n`);
  }
}

async function cmdLatest(flags) {
  const r = await latest({ kind: flags.kind });
  if (!r) fail('nenhum digest gravado ainda.');
  if (flags.json) {
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  } else {
    process.stdout.write(`${r.date}  [${(r.runs || []).join(', ')}]  ${r.path}\n`);
  }
}

async function cmdPath(positional, flags) {
  const date = positional[0] || flags.date;
  if (!date) fail('informe a data: digest path YYYY-MM-DD');
  process.stdout.write((flags.abs ? dayDir(date) : dayRelPath(date)) + '\n');
}

async function cmdReindex() {
  const idx = await reindex();
  process.stdout.write(`index reconstruído: ${idx.digests.length} dia(s).\n`);
}

const HELP = `@vinci/news-digest-store — CLI

Uso:
  digest publish --date YYYY-MM-DD --kind full|incremental [--md FILE|--stdin md]
                 [--html FILE] [--meta FILE] [--commit] [--push [BRANCH]]
  digest get YYYY-MM-DD [--kind full|incremental] [--format md|html|meta]
  digest list [--kind K] [--limit N] [--json]
  digest latest [--kind K] [--json]
  digest path YYYY-MM-DD [--abs]
  digest reindex

Exemplos:
  # gravar o digest completo do dia e dar push (usado pelos skills)
  digest publish --date 2026-07-14 --kind full --md full.md --html full.html \\
                 --meta meta.json --push

  # outro agente lê o clipping de um dia específico
  digest get 2026-07-14 --kind full --format md
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
        fail(`comando desconhecido: "${cmd}". Rode "digest help".`);
    }
  } catch (err) {
    fail(err.message);
  }
}

main();
