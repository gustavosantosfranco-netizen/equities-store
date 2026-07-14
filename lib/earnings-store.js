// earnings-analysis — biblioteca central.
// Arquiva o comentário buy-side produzido pelo skill analise-de-resultados-v2
// (três momentos: primeira/segunda/terceira leitura), por empresa e período.
// Zero dependências externas; mesmo padrão de I/O de lib/news-digest-store.js.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Raiz da coleção earnings-analysis/ (contém <empresa>/<período>/ e index.json). */
export const STORE_ROOT = path.resolve(__dirname, '..', 'earnings-analysis');
export const INDEX_FILE = path.join(STORE_ROOT, 'index.json');

/** As três leituras do skill analise-de-resultados-v2. */
export const READINGS = ['primeira', 'segunda', 'terceira'];

// ---------------------------------------------------------------------------
// Helpers de identificação / caminho
// ---------------------------------------------------------------------------

const COMPANY_RE = /^[a-z0-9_]+$/; // mesmo padrão dos slugs em fichas/<slug>.md
const PERIOD_RE = /^\d{4}Q[1-4]$/i; // convenção CVM, ex.: 2026Q1 (1T26)

/** Valida e normaliza o slug da empresa — o MESMO slug usado em fichas/<slug>.md. */
export function normalizeCompany(input) {
  const s = String(input).trim().toLowerCase();
  if (!COMPANY_RE.test(s)) {
    throw new Error(
      `company inválido: "${input}" — use o mesmo slug de fichas/<slug>.md (minúsculas, ` +
      `dígitos, underscore; ex.: "vibra", "rede_dor", "banco_do_brasil").`
    );
  }
  return s;
}

/** Valida e normaliza o período (ex.: 2026Q1, equivalente a 1T26). */
export function normalizePeriod(input) {
  const s = String(input).trim().toUpperCase();
  if (!PERIOD_RE.test(s)) {
    throw new Error(`period inválido: "${input}" — use o formato AAAAQn (ex.: 2026Q1 para 1T26).`);
  }
  return s;
}

function assertReading(reading) {
  if (!READINGS.includes(reading)) {
    throw new Error(`reading inválido: "${reading}" — use um de: ${READINGS.join(', ')}.`);
  }
}

/** Caminho absoluto do diretório de uma empresa/período. */
export function recordDir(company, period) {
  return path.join(STORE_ROOT, normalizeCompany(company), normalizePeriod(period));
}

/** Caminho relativo (à raiz da coleção) do diretório de uma empresa/período. */
export function recordRelPath(company, period) {
  return path.posix.join(normalizeCompany(company), normalizePeriod(period));
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
 * Grava uma leitura (primeira/segunda/terceira) de uma empresa/período.
 *
 * @param {object} opts
 * @param {string} opts.company  slug da empresa (o mesmo de fichas/<slug>.md).
 * @param {string} opts.period   AAAAQn, ex. "2026Q1".
 * @param {string} opts.reading  'primeira' | 'segunda' | 'terceira'.
 * @param {string} opts.md       corpo Markdown da análise (obrigatório).
 * @param {object} [opts.meta]   metadados desta leitura (ticker, revisão de lucro…).
 * @returns {Promise<{dir:string, files:string[], meta:object}>}
 */
export async function publish(opts) {
  const { company, period, reading } = opts;
  assertReading(reading);
  const companySlug = normalizeCompany(company);
  const periodNorm = normalizePeriod(period);

  if (typeof opts.md !== 'string' || opts.md.length === 0) {
    throw new Error('Nada para gravar: forneça o Markdown da análise (--md).');
  }

  const dir = recordDir(companySlug, periodNorm);
  await fs.mkdir(dir, { recursive: true });

  const name = `${reading}.md`;
  await fs.writeFile(path.join(dir, name), opts.md, 'utf8');

  const metaFile = path.join(dir, 'meta.json');
  const recordMeta = (await readJsonIfExists(metaFile)) || {
    company: companySlug, period: periodNorm, readings: {},
  };
  recordMeta.company = companySlug;
  recordMeta.period = periodNorm;
  recordMeta.readings = recordMeta.readings || {};
  recordMeta.readings[reading] = {
    ...(opts.meta || {}),
    generatedAt: (opts.meta && opts.meta.generatedAt) || new Date().toISOString(),
    file: name,
  };
  await writeJson(metaFile, recordMeta);

  await updateIndexEntry(companySlug, periodNorm);

  return { dir, files: [name, 'meta.json'], meta: recordMeta };
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

/**
 * Lê uma leitura. Retorna null se empresa/período/leitura não existir.
 * @param {string} company
 * @param {string} period
 * @param {object} [opts]
 * @param {string} [opts.reading='primeira']
 * @param {string} [opts.format='md']  'md' | 'meta'
 */
export async function get(company, period, opts = {}) {
  const reading = opts.reading || 'primeira';
  const format = opts.format || 'md';
  assertReading(reading);
  const dir = recordDir(company, period);

  if (format === 'meta') return readJsonIfExists(path.join(dir, 'meta.json'));
  if (format !== 'md') throw new Error(`format inválido: "${format}" — use md ou meta.`);
  try {
    return await fs.readFile(path.join(dir, `${reading}.md`), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/** Metadados do registro (as leituras feitas), ou null. */
export async function getMeta(company, period) {
  return readJsonIfExists(path.join(recordDir(company, period), 'meta.json'));
}

// ---------------------------------------------------------------------------
// Índice
// ---------------------------------------------------------------------------

export async function readIndex() {
  return (await readJsonIfExists(INDEX_FILE)) || { updatedAt: null, records: [] };
}

/** Atualiza (ou insere) a entrada de uma empresa/período no índice. */
export async function updateIndexEntry(company, period) {
  const companySlug = normalizeCompany(company);
  const periodNorm = normalizePeriod(period);
  const meta = await getMeta(companySlug, periodNorm);
  const index = await readIndex();

  const entry = {
    company: companySlug,
    period: periodNorm,
    path: recordRelPath(companySlug, periodNorm),
    readings: meta ? Object.keys(meta.readings || {}).sort() : [],
    updatedAt: new Date().toISOString(),
  };

  const rest = index.records.filter(
    (e) => !(e.company === companySlug && e.period === periodNorm)
  );
  rest.push(entry);
  rest.sort((a, b) => {
    if (a.company !== b.company) return a.company < b.company ? -1 : 1;
    return a.period < b.period ? 1 : a.period > b.period ? -1 : 0; // período mais recente primeiro
  });

  index.records = rest;
  index.updatedAt = new Date().toISOString();
  await writeJson(INDEX_FILE, index);
  return index;
}

/** Recria o índice do zero varrendo earnings-analysis/. */
export async function reindex() {
  let companies = [];
  try {
    companies = await fs.readdir(STORE_ROOT);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  const records = [];
  for (const company of companies.sort()) {
    if (!COMPANY_RE.test(company)) continue;
    const companyDir = path.join(STORE_ROOT, company);
    const stat = await fs.stat(companyDir);
    if (!stat.isDirectory()) continue;

    const periods = await fs.readdir(companyDir);
    for (const period of periods.sort()) {
      if (!PERIOD_RE.test(period)) continue;
      const meta = await getMeta(company, period);
      records.push({
        company,
        period,
        path: recordRelPath(company, period),
        readings: meta ? Object.keys(meta.readings || {}).sort() : [],
        updatedAt: (meta && latestGeneratedAt(meta)) || null,
      });
    }
  }
  records.sort((a, b) => {
    if (a.company !== b.company) return a.company < b.company ? -1 : 1;
    return a.period < b.period ? 1 : a.period > b.period ? -1 : 0;
  });

  const index = { updatedAt: new Date().toISOString(), records };
  await writeJson(INDEX_FILE, index);
  return index;
}

function latestGeneratedAt(meta) {
  const times = Object.values(meta.readings || {})
    .map((r) => r.generatedAt)
    .filter(Boolean)
    .sort();
  return times[times.length - 1] || null;
}

/**
 * Lista registros (empresa/período), mais recente primeiro.
 * @param {object} [opts]
 * @param {string} [opts.company]  filtra por empresa.
 * @param {string} [opts.reading]  filtra por registros que tenham essa leitura.
 * @param {number} [opts.limit]
 */
export async function list(opts = {}) {
  const index = await readIndex();
  let out = index.records;
  if (opts.company) out = out.filter((e) => e.company === normalizeCompany(opts.company));
  if (opts.reading) out = out.filter((e) => (e.readings || []).includes(opts.reading));
  if (opts.limit) out = out.slice(0, opts.limit);
  return out;
}

/** Registro mais recente (opcionalmente filtrado por empresa), ou null. */
export async function latest(opts = {}) {
  const out = await list({ company: opts.company, reading: opts.reading, limit: 1 });
  return out[0] || null;
}
