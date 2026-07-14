# equities-store

Repositório versionado do **output** dos skills de equities do repo `News-agent`.
Duas coleções independentes, cada uma com sua própria granularidade, ambas versionadas
no Git — sem servidor, sem banco, zero dependências npm:

```
news-digests/         ← news-inbox-digest, news-inbox-digest-incremental (por DIA)
earnings-analysis/    ← analise-de-resultados-v2 (por EMPRESA + PERÍODO)
```

## Coleção `news-digests/` — digests de notícias

Cada dia útil, os skills leem `equitiesvc@gmail.com`, produzem o digest em pt-BR (o
mesmo conteúdo que vira rascunho no Gmail) e gravam aqui, com **granularidade diária**.

```
news-digests/
  digests/
    2026/
      07/
        14/
          full.md            # digest completo (1ª run, janela de 12h)
          full.html          # mesma versão HTML enviada ao draft do Gmail
          incremental.md     # 2ª run — só o delta (opcional, se rodou)
          incremental.html
          meta.json          # metadados das runs do dia
  index.json                 # manifesto navegável (mais recente primeiro)
```

`meta.json` de um dia:

```json
{
  "date": "2026-07-14",
  "runs": {
    "full": {
      "generatedAt": "2026-07-14T10:32:00Z",
      "window": "12h",
      "mailbox": "equitiesvc@gmail.com",
      "recipients": ["equities@vincicompass.com", "mlins@vincicompass.com"],
      "itemCount": 9,
      "tickers": ["RDOR3", "MOTV3", "AZZA3"],
      "files": { "md": "full.md", "html": "full.html" }
    },
    "incremental": {
      "generatedAt": "2026-07-14T13:05:00Z",
      "since": "2026-07-14T10:32:00Z",
      "itemCount": 2,
      "files": { "md": "incremental.md", "html": "incremental.html" }
    }
  }
}
```

### CLI — `digest`

```bash
# gravar (usado pelos skills no fim da run) — grava arquivos, atualiza index, commita e dá push
node bin/digest.js publish --date 2026-07-14 --kind full \
  --md full.md --html full.html --meta meta.json --push

# ler o clipping de um dia específico
node bin/digest.js get 2026-07-14 --kind full --format md
node bin/digest.js get 2026-07-14 --format meta

node bin/digest.js list --limit 30
node bin/digest.js latest --kind full --json
node bin/digest.js reindex
```

Flags de `publish`: `--date` (obrigatório), `--kind` (`full`|`incremental`), `--md FILE`/
`--stdin md`, `--html FILE`, `--meta FILE`, `--commit`, `--push [BRANCH]`.

## Coleção `earnings-analysis/` — análises de resultado

O skill `analise-de-resultados-v2` produz o comentário buy-side (para PMs) sobre o
trimestre de uma empresa, em três momentos: **primeira leitura** (a quente), **segunda
leitura** (após call + notas do sell-side) e **terceira leitura** (crítica de
estimativas pós-modelo atualizado). Arquivado com **granularidade empresa + período**.

```
earnings-analysis/
  vibra/
    2026Q1/
      primeira.md    # análise a quente (1ª leitura)
      segunda.md      # delta pós-call/sell-side (2ª leitura, se rodou)
      terceira.md      # crítica de estimativas pós-modelo (3ª leitura, se rodou)
      meta.json      # metadados das leituras deste trimestre
  equatorial/
    2025Q4/
      primeira.md
      meta.json
  index.json         # manifesto navegável (empresa, período mais recente primeiro)
```

O slug da empresa (`vibra`, `rede_dor`, `banco_do_brasil`, …) é o **mesmo** usado em
`fichas/<slug>.md` no skill — consistência entre os dois repos. O período segue a
convenção `AAAAQn` (ex.: `2026Q1` para 1T26).

`meta.json` de um registro:

```json
{
  "company": "vibra",
  "period": "2026Q1",
  "readings": {
    "primeira": {
      "generatedAt": "2026-05-08T14:00:00Z",
      "ticker": "VBBR3",
      "file": "primeira.md"
    },
    "segunda": {
      "generatedAt": "2026-05-15T10:00:00Z",
      "file": "segunda.md"
    }
  }
}
```

### CLI — `earnings`

```bash
# gravar a primeira leitura do 1T26 da Vibra e dar push (usado pelo skill)
node bin/earnings.js publish --company vibra --period 2026Q1 --reading primeira \
  --md analise.md --meta meta.json --push

# ler a segunda leitura da Equatorial no 4T25
node bin/earnings.js get equatorial 2025Q4 --reading segunda

node bin/earnings.js list --company vibra
node bin/earnings.js latest --company vibra --json
node bin/earnings.js reindex
```

Flags de `publish`: `--company` (obrigatório, slug), `--period` (obrigatório, `AAAAQn`),
`--reading` (`primeira`|`segunda`|`terceira`), `--md FILE`/`--stdin md`, `--meta FILE`,
`--commit`, `--push [BRANCH]`.

## Uso programático (outros agentes em Node)

```js
import { get, list, latest } from 'equities-store/news-digests';
import { get as getEarnings, list as listEarnings } from 'equities-store/earnings';

const digestMd = await get('2026-07-14', { kind: 'full', format: 'md' });
const analiseVibra = await getEarnings('vibra', '2026Q1', { reading: 'primeira' });
```

Como tudo é arquivo versionado, um agente em qualquer linguagem também pode simplesmente
`git pull` e ler os arquivos direto (`news-digests/digests/AAAA/MM/DD/full.md`,
`earnings-analysis/<empresa>/<período>/primeira.md`, ou os respectivos `index.json`).

## Automação

Ambos os skills geram o conteúdo (ler Gmail/Data Lab/release + redigir é trabalho de
LLM); "100% automatizado" significa que, no último passo da run, o skill clona/atualiza
este repositório e chama a CLI correspondente com `--push`. Não há copiar/colar manual.
Para agendar a *chamada* do agente, use um trigger externo (n8n / cron / GitHub Action).

## Repositório e permissões

Este repositório é dedicado só ao **output** dos skills — separado do repositório
`News-agent` (que tem os skills/prompts/fichas). Isso permite dar acesso de leitura a
outros agentes/serviços sem expor a lógica interna, e mantém o histórico limpo (um
commit por publicação) conforme o volume de dados cresce ao longo dos anos.
