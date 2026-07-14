# equities-store

Repositório versionado dos **digests de notícias** gerados pelos skills
`news-inbox-digest` e `news-inbox-digest-incremental` (repositório `News-agent`).

Cada dia útil, os skills leem a caixa `equitiesvc@gmail.com`, produzem o digest em
pt-BR (o mesmo conteúdo que vira rascunho no Gmail) e **gravam aqui**, com **granularidade
diária**. Outros agentes/serviços consomem esses arquivos direto do Git — sem servidor,
sem banco, zero dependências npm.

## Estrutura por data

```
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
      "gmailDraftId": "r-123...",
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

`index.json`:

```json
{
  "updatedAt": "2026-07-14T13:05:12Z",
  "digests": [
    { "date": "2026-07-14", "path": "digests/2026/07/14", "runs": ["full", "incremental"] }
  ]
}
```

## CLI

Sem instalação (Node ≥ 18). A partir da raiz deste repositório:

```bash
# gravar (usado pelos skills no fim da run) — grava arquivos, atualiza index, commita e dá push
node bin/digest.js publish --date 2026-07-14 --kind full \
  --md full.md --html full.html --meta meta.json --push

# ler o clipping de um dia específico (granularidade diária)
node bin/digest.js get 2026-07-14 --kind full --format md
node bin/digest.js get 2026-07-14 --format meta

# descobrir o que existe
node bin/digest.js list --limit 30
node bin/digest.js latest --kind full --json

# reconstruir o índice após edição manual
node bin/digest.js reindex
```

Se instalar como pacote (`npm i`/`npm link`), o binário `digest` fica disponível
diretamente (`digest get 2026-07-14`).

Flags de `publish`:

| flag | efeito |
|---|---|
| `--date` | dia do digest (YYYY-MM-DD), **obrigatório** |
| `--kind` | `full` (default) ou `incremental` |
| `--md FILE` / `--stdin md` | corpo Markdown (arquivo ou stdin) |
| `--html FILE` | corpo HTML |
| `--meta FILE` | JSON de metadados da run |
| `--commit` | `git add` + `git commit` no store |
| `--push [BRANCH]` | commita e dá `git push` (implica commit) |

## Uso programático (outros agentes em Node)

```js
import { get, getMeta, list, latest } from 'equities-store';

const md = await get('2026-07-14', { kind: 'full', format: 'md' });
const meta = await getMeta('2026-07-14');
const recentes = await list({ limit: 10 });
const ultimo = await latest({ kind: 'incremental' });
```

Como tudo é arquivo versionado, um agente em qualquer linguagem também pode simplesmente
`git pull` e ler `digests/AAAA/MM/DD/full.md` / `index.json` diretamente.

## Automação

A geração do digest é feita **pelo agente** (ler Gmail + web + rankear é trabalho de LLM),
então "100% automatizado" significa: os próprios skills, no último passo da run, clonam
(ou atualizam) este repositório e chamam `digest publish … --push`. Não há copiar/colar
manual. Para agendar a *chamada* do agente diariamente, use um trigger externo (n8n / cron /
GitHub Action) que inicie a sessão e invoque o skill — a gravação aqui acontece sozinha
ao final.

## Repositório e permissões

Este repositório é dedicado só ao **output** dos digests — separado do repositório
`News-agent` (que tem os skills/prompts). Isso permite dar acesso de leitura a outros
agentes/serviços sem expor a lógica dos skills, e mantém o histórico limpo (só commits de
publicação, um por run) conforme o volume de dados cresce ao longo dos anos.
