// @vinci/news-digest-store — biblioteca central.
// Zero dependências externas (apenas built-ins do Node) para máxima portabilidade
// entre agentes/ambientes. Toda a persistência é em arquivos versionados no Git.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Raiz do pacote (contém digests/ e index.json). */
export const STORE_ROOT = path.resolve(__dirname, '..');
export const DIGESTS_DIR = path.join(STORE_ROOT, 'digests');
export const INDEX_FILE = path.join(STORE_ROOT, 'index.json');

/** Tipos de run suportados. */
export const KINDS = ['full', 'incremental'];

// ---------------------------------------------------------------------------
// Helpers de data / caminho
// ---------------------------------------------------------------------------

/** Valida e normaliza uma data ISO (YYYY-MM-DD). Lança se inválida. */
export function normalizeDate(input) {
  const s = String(input).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error(`Data inválida: "${input}" — use o formato YYYY-MM-DD.`);
  const [, y, mo, d] = m;
  const dt = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(dt.getTime()) || dt.getUTCFullYear() !== +y ||
      dt.getUTCMonth() + 1 !== +mo || dt.getUTCDate() !== +d) {
    throw new Error(`Data inexistente no calendário: "${input}".`);
  }
  return { date: s, year: y, month: mo, day: d };
}

/** Caminho absoluto do diretório de um dia: digests/YYYY/MM/DD. */
export function dayDir(date) {
  const { year, month, day } = normalizeDate(date);
  return path.join(DIGESTS_DIR, year, month, day);
}

/** Caminho relativo (repo-root) do diretório de um dia — usado no index. */
export function dayRelPath(date) {
  const { year, month, day } = normalizeDate(date);
  return path.posix.join('digests', year, month, day);
}

function assertKind(kind) {
  if (!KINDS.includes(kind)) {
    throw new Error(`kind inválido: "${kind}" — use um de: ${KINDS.join(', ')}.`);
  }
}

// ---------------------------------------------------------------------------
// I/O básico
// ---------------------------------------------------------------------------

async function readJsonIfExists(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function writeJson(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// ---------------------------------------------------------------------------
// Publicação
// ---------------------------------------------------------------------------

/**
 * Grava um digest de um dia/kind no store.
 *
 * @param {object} opts
 * @param {string} opts.date        YYYY-MM-DD.
 * @param {string} opts.kind        'full' | 'incremental'.
 * @param {string} [opts.md]        Corpo Markdown do digest.
 * @param {string} [opts.html]      Corpo HTML (o mesmo enviado ao draft do Gmail).
 * @param {object} [opts.meta]      Metadados desta run (window, tickers, itemCount…).
 * @param {boolean}[opts.overwrite] Sobrescreve se já existir (default: true).
 * @returns {Promise<{dir:string, files:string[], meta:object}>}
 */
export async function publish(opts) {
  const { date, kind } = opts;
  assertKind(kind);
  normalizeDate(date);

  if (typeof opts.md !== 'string' && typeof opts.html !== 'string') {
    throw new Error('Nada para gravar: forneça pelo menos md ou html.');
  }

  const dir = dayDir(date);
  await fs.mkdir(dir, { recursive: true });

  const written = [];
  const files = {};

  if (typeof opts.md === 'string') {
    const name = `${kind}.md`;
    await fs.writeFile(path.join(dir, name), opts.md, 'utf8');
    files.md = name;
    written.push(name);
  }
  if (typeof opts.html === 'string') {
    const name = `${kind}.html`;
    await fs.writeFile(path.join(dir, name), opts.html, 'utf8');
    files.html = name;
    written.push(name);
  }

  // meta.json do dia agrega as runs (full + incremental).
  const metaFile = path.join(dir, 'meta.json');
  const dayMeta = (await readJsonIfExists(metaFile)) || { date, runs: {} };
  dayMeta.date = date;
  dayMeta.runs = dayMeta.runs || {};
  dayMeta.runs[kind] = {
    ...(opts.meta || {}),
    generatedAt: (opts.meta && opts.meta.generatedAt) || new Date().toISOString(),
    files,
  };
  await writeJson(metaFile, dayMeta);
  written.push('meta.json');

  await updateIndexEntry(date);

  return { dir, files: written, meta: dayMeta };
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

/**
 * Lê um digest. Retorna null se o dia/kind/arquivo não existir.
 * @param {string} date  YYYY-MM-DD.
 * @param {object} [opts]
 * @param {string} [opts.kind='full']
 * @param {string} [opts.format='md']  'md' | 'html' | 'meta'
 */
export async function get(date, opts = {}) {
  const kind = opts.kind || 'full';
  const format = opts.format || 'md';
  assertKind(kind);
  const dir = dayDir(date);

  if (format === 'meta') {
    return readJsonIfExists(path.join(dir, 'meta.json'));
  }
  if (format !== 'md' && format !== 'html') {
    throw new Error(`format inválido: "${format}" — use md, html ou meta.`);
  }
  try {
    return await fs.readFile(path.join(dir, `${kind}.${format}`), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/** Metadados do dia (as duas runs), ou null. */
export async function getMeta(date) {
  return readJsonIfExists(path.join(dayDir(date), 'meta.json'));
}

// ---------------------------------------------------------------------------
// Índice
// ---------------------------------------------------------------------------

/** Lê o index.json (ou um índice vazio). */
export async function readIndex() {
  return (await readJsonIfExists(INDEX_FILE)) || { updatedAt: null, digests: [] };
}

/** Atualiza (ou insere) a entrada de um dia no índice, mantendo-o ordenado. */
export async function updateIndexEntry(date) {
  normalizeDate(date);
  const meta = await getMeta(date);
  const index = await readIndex();

  const entry = {
    date,
    path: dayRelPath(date),
    runs: meta ? Object.keys(meta.runs || {}).sort() : [],
    updatedAt: new Date().toISOString(),
  };

  const rest = index.digests.filter((e) => e.date !== date);
  rest.push(entry);
  rest.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // mais recente primeiro

  index.digests = rest;
  index.updatedAt = new Date().toISOString();
  await writeJson(INDEX_FILE, index);
  return index;
}

/** Recria o índice do zero varrendo digests/. Útil após edições manuais. */
export async function reindex() {
  const dates = [];
  let years = [];
  try {
    years = await fs.readdir(DIGESTS_DIR);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  for (const y of years.sort()) {
    if (!/^\d{4}$/.test(y)) continue;
    const months = await fs.readdir(path.join(DIGESTS_DIR, y));
    for (const mo of months.sort()) {
      if (!/^\d{2}$/.test(mo)) continue;
      const days = await fs.readdir(path.join(DIGESTS_DIR, y, mo));
      for (const d of days.sort()) {
        if (!/^\d{2}$/.test(d)) continue;
        dates.push(`${y}-${mo}-${d}`);
      }
    }
  }

  const digests = [];
  for (const date of dates) {
    const meta = await getMeta(date);
    digests.push({
      date,
      path: dayRelPath(date),
      runs: meta ? Object.keys(meta.runs || {}).sort() : [],
      updatedAt: (meta && meta.runs && latestGeneratedAt(meta)) || null,
    });
  }
  digests.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const index = { updatedAt: new Date().toISOString(), digests };
  await writeJson(INDEX_FILE, index);
  return index;
}

function latestGeneratedAt(meta) {
  const times = Object.values(meta.runs || {})
    .map((r) => r.generatedAt)
    .filter(Boolean)
    .sort();
  return times[times.length - 1] || null;
}

/**
 * Lista dias disponíveis (mais recente primeiro).
 * @param {object} [opts]
 * @param {number} [opts.limit]
 * @param {string} [opts.kind]  filtra por runs que contenham este kind.
 */
export async function list(opts = {}) {
  const index = await readIndex();
  let out = index.digests;
  if (opts.kind) out = out.filter((e) => (e.runs || []).includes(opts.kind));
  if (opts.limit) out = out.slice(0, opts.limit);
  return out;
}

/** Entrada mais recente do índice (opcionalmente filtrando por kind), ou null. */
export async function latest(opts = {}) {
  const out = await list({ kind: opts.kind, limit: 1 });
  return out[0] || null;
}
