import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  normalizeDate, dayRelPath, publish, get, getMeta, list, latest, reindex,
  DIGESTS_DIR, INDEX_FILE,
} from '../lib/news-digest-store.js';

// Os testes gravam em datas de teste (ano 1900) e limpam ao final.
const TEST_DATES = ['1900-01-02', '1900-01-03'];

async function cleanup() {
  for (const d of TEST_DATES) {
    const { year } = normalizeDate(d);
    await fs.rm(path.join(DIGESTS_DIR, year), { recursive: true, force: true });
  }
  await reindex();
}

test('normalizeDate rejeita datas inválidas', () => {
  assert.throws(() => normalizeDate('2026-13-01'));
  assert.throws(() => normalizeDate('14/07/2026'));
  assert.equal(normalizeDate('2026-07-14').date, '2026-07-14');
});

test('dayRelPath monta o caminho por data', () => {
  assert.equal(dayRelPath('2026-07-14'), 'digests/2026/07/14');
});

test('publish grava arquivos, meta e índice; get lê de volta', async (t) => {
  t.after(cleanup);

  await publish({
    date: '1900-01-02',
    kind: 'full',
    md: '# Digest\nconteúdo',
    html: '<h1>Digest</h1>',
    meta: { window: '12h', itemCount: 3, tickers: ['RDOR3'] },
  });

  assert.equal(await get('1900-01-02', { kind: 'full', format: 'md' }), '# Digest\nconteúdo');
  assert.equal(await get('1900-01-02', { kind: 'full', format: 'html' }), '<h1>Digest</h1>');

  const meta = await getMeta('1900-01-02');
  assert.equal(meta.runs.full.itemCount, 3);
  assert.equal(meta.runs.full.window, '12h');
  assert.ok(meta.runs.full.generatedAt, 'generatedAt preenchido automaticamente');

  const idx = JSON.parse(await fs.readFile(INDEX_FILE, 'utf8'));
  const entry = idx.digests.find((e) => e.date === '1900-01-02');
  assert.deepEqual(entry.runs, ['full']);
});

test('incremental coexiste com full no mesmo dia', async (t) => {
  t.after(cleanup);
  await publish({ date: '1900-01-02', kind: 'full', md: 'full' });
  await publish({ date: '1900-01-02', kind: 'incremental', md: 'delta', meta: { itemCount: 1 } });

  assert.equal(await get('1900-01-02', { kind: 'full', format: 'md' }), 'full');
  assert.equal(await get('1900-01-02', { kind: 'incremental', format: 'md' }), 'delta');
  const meta = await getMeta('1900-01-02');
  assert.deepEqual(Object.keys(meta.runs).sort(), ['full', 'incremental']);
});

test('get retorna null para dia inexistente', async () => {
  assert.equal(await get('1900-01-09', { kind: 'full', format: 'md' }), null);
});

test('list e latest ordenam do mais recente para o mais antigo', async (t) => {
  t.after(cleanup);
  await publish({ date: '1900-01-02', kind: 'full', md: 'a' });
  await publish({ date: '1900-01-03', kind: 'full', md: 'b' });

  const rows = await list({ limit: 5 });
  const testRows = rows.filter((r) => r.date.startsWith('1900-01'));
  assert.equal(testRows[0].date, '1900-01-03');
  assert.equal(testRows[1].date, '1900-01-02');

  const l = await latest();
  assert.equal(l.date >= '1900-01-03', true);
});

test('publish sem md nem html falha', async () => {
  await assert.rejects(() => publish({ date: '1900-01-02', kind: 'full' }));
});
