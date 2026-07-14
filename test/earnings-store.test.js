import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  normalizeCompany, normalizePeriod, recordRelPath,
  publish, get, getMeta, list, latest, reindex,
  STORE_ROOT, INDEX_FILE,
} from '../lib/earnings-store.js';

// Os testes gravam sob uma empresa de teste ("_teste_zz") e limpam ao final.
const TEST_COMPANY = '_teste_zz';

async function cleanup() {
  await fs.rm(path.join(STORE_ROOT, TEST_COMPANY), { recursive: true, force: true });
  await reindex();
}

test('normalizeCompany aceita slugs válidos e rejeita o resto', () => {
  assert.equal(normalizeCompany('Vibra'), 'vibra');
  assert.equal(normalizeCompany('rede_dor'), 'rede_dor');
  assert.throws(() => normalizeCompany('Rede D\'Or'));
});

test('normalizePeriod normaliza para AAAAQn maiúsculo', () => {
  assert.equal(normalizePeriod('2026q1'), '2026Q1');
  assert.throws(() => normalizePeriod('1T26'));
  assert.throws(() => normalizePeriod('2026Q5'));
});

test('recordRelPath monta empresa/período', () => {
  assert.equal(recordRelPath('vibra', '2026Q1'), 'vibra/2026Q1');
});

test('publish grava a leitura, meta e índice; get lê de volta', async (t) => {
  t.after(cleanup);

  await publish({
    company: TEST_COMPANY, period: '2026Q1', reading: 'primeira',
    md: '# Análise\nResumo executivo.',
    meta: { ticker: 'ZZZ3' },
  });

  assert.equal(
    await get(TEST_COMPANY, '2026Q1', { reading: 'primeira' }),
    '# Análise\nResumo executivo.'
  );

  const meta = await getMeta(TEST_COMPANY, '2026Q1');
  assert.equal(meta.readings.primeira.ticker, 'ZZZ3');
  assert.ok(meta.readings.primeira.generatedAt);

  const idx = JSON.parse(await fs.readFile(INDEX_FILE, 'utf8'));
  const entry = idx.records.find((e) => e.company === TEST_COMPANY && e.period === '2026Q1');
  assert.deepEqual(entry.readings, ['primeira']);
});

test('segunda e terceira leituras coexistem com a primeira', async (t) => {
  t.after(cleanup);
  await publish({ company: TEST_COMPANY, period: '2026Q1', reading: 'primeira', md: 'p' });
  await publish({ company: TEST_COMPANY, period: '2026Q1', reading: 'segunda', md: 's' });
  await publish({ company: TEST_COMPANY, period: '2026Q1', reading: 'terceira', md: 't' });

  assert.equal(await get(TEST_COMPANY, '2026Q1', { reading: 'segunda' }), 's');
  const meta = await getMeta(TEST_COMPANY, '2026Q1');
  assert.deepEqual(Object.keys(meta.readings).sort(), ['primeira', 'segunda', 'terceira']);
});

test('get retorna null para registro inexistente', async () => {
  assert.equal(await get(TEST_COMPANY, '2019Q1', { reading: 'primeira' }), null);
});

test('list filtra por company e ordena período mais recente primeiro', async (t) => {
  t.after(cleanup);
  await publish({ company: TEST_COMPANY, period: '2025Q4', reading: 'primeira', md: 'a' });
  await publish({ company: TEST_COMPANY, period: '2026Q1', reading: 'primeira', md: 'b' });

  const rows = await list({ company: TEST_COMPANY });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].period, '2026Q1');
  assert.equal(rows[1].period, '2025Q4');

  const l = await latest({ company: TEST_COMPANY });
  assert.equal(l.period, '2026Q1');
});

test('publish sem md falha', async () => {
  await assert.rejects(() => publish({ company: TEST_COMPANY, period: '2026Q1', reading: 'primeira' }));
});
