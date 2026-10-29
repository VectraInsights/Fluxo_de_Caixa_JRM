# Historico - Fluxo de Caixa JRM Dashboard

## 1. Visao Geral do Aplicativo

O **Fluxo de Caixa JRM Dashboard** é um sistema de gestao financeira integrado ao ERP Conta Azul. Ele exibe receitas e despesas previstas, saldos bancarios e projecao diaria de fluxo de caixa para empresas cadastradas.

**Tecnologias:**
- Frontend: TanStack Start / React Router / TanStack Query
- Backend: TanStack Server Functions (Nitro)
- Banco de dados: Supabase (PostgreSQL)
- OAuth 2.0: Conta Azul (login.contaazul.com)

**URL de producao:** https://jrm-dashboard.vercel.app/

---

## 2. Como o App Funciona

### 2.1 Fluxo de Autenticacao OAuth (Conta Azul)

1. O usuario clica em "Conectar Conta Azul" para uma empresa com token expirado.
2. O navegador e redirecionado para: `/api/autorizar?empresa=NOME_DA_EMPRESA`
3. A Conta Azul autentica o usuario e devolve um `code` na RAIZ da aplicacao
   (`https://jrm-dashboard.vercel.app/?code=...&state=...`) — a `redirect_uri`
   cadastrada no Portal da Conta Azul e a raiz, **nao** `/api/callback`.
4. A pagina inicial detecta o `code` na URL e chama a server function
   `finalizarAutorizacao`, que troca o codigo por `access_token` e `refresh_token`.
5. O token e salvo no Supabase na tabela `tokens` com status `ATIVO`. O registro
   existente da empresa e **atualizado** (o nome vem do parametro `state`), sem
   criar linha duplicada.

> **Endpoint de token:** usar sempre `https://api-v2.contaazul.com/oauth/token`
> (documentado no portal novo). O host antigo `auth.contaazul.com/oauth2/token`
> rejeita apps do portal novo com `invalid_client`. Ver secao 7.

### 2.2 Busca de Dados do Dashboard

1. O usuario seleciona uma empresa (ou "Todas as Empresas") e um intervalo de datas.
2. A funcao server `getDashboard` e chamada.
3. Para cada empresa, o sistema:
   - Obtem o token valido via `obterToken()`.
   - Busca saldos bancarios (`buscarSaldos`).
   - Busca contas a receber e contas a pagar via API Conta Azul (`buscarV2`).
4. Os valores sao somados por dia e exibidos nos cards (Entradas Previstas, Saidas Previstas) e no grafico de Projecao Diaria.

### 2.3 Indicador de Sincronizacao

- Bolinha verde: todas as empresas do filtro estao com token ATIVO.
- Bolinha vermelha: a empresa selecionada esta com status `ERRO` no Supabase (precisa reautenticar).
- Bolinha azul pulsando: sincronizacao em andamento.

---

## 3. Historico de Modificacoes

| Commit | Descricao | Data |
|--------|-----------|------|
| `a626bd8` | **COMMIT PADRAO / REFERENCIA ATUAL** — feat: mostra contas nao exibidas no painel de Bancos para diagnosticar banco ausente | 29/10/2026 |
| `902e617` | fix: usa endpoint de token v2 da Conta Azul para corrigir invalid_client na troca de code e na renovacao | 29/10/2026 |
| `68fc942` | feat: adiciona botao e rota de reconexao com a Conta Azul para renovar token de empresa | 29/10/2026 |
| `5af8199` | feat: sinaliza falhas de sincronizacao no dashboard com bolinha vermelha e avisos detalhados | 29/10/2026 |
| `ff37c8e` | *(referencia antiga, superada)* — fix: remove filtro BANCOS_PERMITIDOS do backend para LGP Transportes receber todos os bancos da API | 28/10/2026 |
| `8ec7d90` | feat: LGP Transportes mostra todos os bancos da API para diagnostico | 28/10/2026 |
| `8a45410` | feat: LGP Transportes mostra apenas ITAU, SICOOB 3049, BRADESCO e SICOOB 3109 | 28/10/2026 |
| `ee1001c` | feat: bancos especificos por empresa — LGP Transportes mostra apenas Bradesco e Sicoob 3109 | 28/10/2026 |
| `344db44` | feat: adiciona aliases BRADESCO S.A e SICOOB para LGP Transportes | 28/10/2026 |
| `29edb6d` | feat: LGP Transportes mostra todos os bancos da API (sem filtro restritivo) | 28/10/2026 |
| `b58ab10` | **Versao funcional original** — perf: deduplica requisicoes concorrentes, paraleliza busca por empresa e mantem dados anteriores durante recarga | Antes de 28/10/2026 |
| `193c74e` | feat: define Hoje como intervalo padrao de pesquisa ao abrir o sistema | Anterior |
| `d2d8ddb` | feat: header simplificado com status de sincronizacao ao lado do Recarregar | Anterior |

---

## 4. Commit de Reversão Padrao

### Commit recomendado para revert​​ao: `ff37c8e`

**Mensagem:** `feat: mostra contas nao exibidas no painel de Bancos para diagnosticar banco ausente`

**Estado conhecido como funcional (29/10/2026):**
- Dashboard carrega valores reais da Conta Azul (saldo atual, entradas, saidas).
- Bolinha de sincronizacao fica **vermelha** e lista as empresas com falha.
- Botao **"Conectar Conta Azul"** funciona: gera um token novo para a empresa.
- Renovacao automatica de token funciona (endpoint v2 da Conta Azul).

**Como reverter para este estado:**

```bash
# No repositorio local
git reset --hard a626bd8
git push origin main --force
```

Ou diretamente pelo hash no GitHub/Vercel, fazendo redeploy desse commit.

**IMPORTANTE:** Nao faca mais alteracoes no codigo sem testar primeiro em ambiente local. O commit `a626bd8` e o estado de referencia funcional.

**Regra do projeto (AGENTS.md):** sempre `git commit` + `git push` apos qualquer alteracao, com mensagem em portugues no padrao `feat:`, `fix:` ou `chore:`. **Nunca** reescreva o historico ja publicado (force push / rebase / amend) — o projeto esta conectado ao Lovable.

---

## 5. Estrutura de Arquivos Relevantes

- `src/lib/contaazul.functions.ts` — `getDashboard`, `listarEmpresas`, `inspecionarRecebimentos`, `finalizarAutorizacao` (troca o `code` OAuth por token)
- `src/lib/contaazul.server.ts` — `obterToken`, `renovarToken`, `pedirToken` (endpoint v2 com fallback legado), `buscarSaldos`, `buscarV2`, `basicAuth`, `getSupabase`
- `src/routes/index.tsx` — Dashboard frontend, indicador de sync, KPI cards, projeto diaria, deteccao do `code` OAuth na raiz e botoes "Conectar Conta Azul"
- `src/routes/api/autorizar.ts` — Redirecionamento para login da Conta Azul (`state` = nome da empresa)
- `src/routes/api/callback.ts` — Legado (usa `redirect_uri` `/api/callback`, que nao e a cadastrada). **Nao e usado pelo fluxo atual.**

---

## 6. Tabelas do Supabase

### Tabela `tokens`

| Coluna | Tipo | Descricao |
|--------|------|-----------|
| `id` | uuid | Chave primaria |
| `empresa` | text | Nome da empresa (ex: Juvenal Transportes) |
| `access_token` | text | Token de acesso da Conta Azul |
| `refresh_token` | text | Token de renovacao |
| `expires_at` | timestampz | Data de expiracao do access_token |
| `status` | text | `ATIVO` ou `ERRO` |
| `mensagem_erro` | text | Mensagem de erro se status = ERRO |
| `updated_at` | timestampz | Ultima atualizacao |

---

## 7. Problemas Conhecidos e Solucoes

| Problema | Causa | Solucao |
|----------|-------|---------|
| Cards zerados (R$ 0,00) | Token expirado ou empresa sem token no Supabase | Reautenticar via botao "Conectar Conta Azul" |
| Bolinha vermelha + "falha ao buscar..." | `access_token` expirou e o `refresh_token` tambem esta invalido/revogado | Nao ha conserto automatico: reconectar a empresa na Conta Azul |
| Bolinha verde com token expirado | Frontend nao detectava status ERRO | Corrigido: bolinha fica vermelha quando empresa esta com `status = ERRO` |
| `{"error":"invalid_client"}` ao conectar | Endpoint de token errado: `auth.contaazul.com/oauth2/token` e o antigo (API v1, descontinuada) e rejeita apps do portal novo | Usar `https://api-v2.contaazul.com/oauth/token`. Corrigido no commit `902e617` (o legado ficou so como fallback) |
| Erro 400 no callback | `redirect_uri` nao confere com o cadastrado na Conta Azul | Usar exatamente `https://jrm-dashboard.vercel.app/` |
| Token nao salva no Supabase | Credenciais `CONTA_AZUL_CLIENT_ID`/`SECRET` nao configuradas na Vercel | Adicionar as env vars e fazer Redeploy |
| Banco nao aparece na lista | Filtro `BANCOS_PERMITIDOS` no backend | Removido no commit `ff37c8e` — backend agora envia todos os bancos da API |
| Banco existe na Conta Azul mas nao aparece no painel | (a) saldo da conta zerado — o painel esconde contas com `|saldo| < 0,01`; (b) a chamada `saldo-atual` falhou; (c) o nome nao contem nenhuma das chaves de `bancosPermitidos` em `index.tsx` | Ver o bloco **"Contas nao exibidas"** na lateral, que mostra cada conta retornada pela API e o motivo de nao estar visivel. Se for (c), adicionar a chave do banco em `bancosPermitidos` |

### Diagnosticando um banco que nao aparece

O painel **"Contas nao exibidas"** (lateral, abaixo de BANCOS, quando uma empresa especifica esta selecionada) lista toda conta que a API da Conta Azul retornou mas que o painel escondeu, com o motivo:

- `saldo zerado` — a conta existe e o saldo foi lido, mas e `R$ 0,00`. O filtro de exibicao esconde contas zeradas de proposito.
- `falha ao ler o saldo` — a chamada `GET /v1/conta-financeira/{id}/saldo-atual` retornou erro para essa conta.
- `fora do filtro de bancos` — tem saldo, mas o nome nao bate com nenhuma chave de `bancosPermitidos` (em `src/routes/index.tsx`).

A lista de chaves aceitas hoje e `["ITAU", "SICOOB", "SICOOB 3109", "BRADESCO"]`, aplicada por **substring** (maiuzculas): qualquer conta cujo nome contenha "SICOOB" passa, inclusive "Sicoob 3049" e "SICOOB 3109". Para aceitar outro banco, adicione a chave correspondente em `bancosPermitidos`.

---

## 8. Como Voltar ao Estado Funcional em Caso de Problema

**Nao use force push / rebase / amend** — o repositorio esta conectado ao Lovable e
reescrever o historico publicado faz o projeto perder o historico no editor.

Forma segura:

```bash
# 1. Reverte os commits que quebraram (cria commits novos, nao reescreve nada)
git revert --no-commit <hash_do_commit_que_quebrou>
git commit -m "fix: reverte <breve descricao>"

# 2. Envie normalmente
git push origin main

# 3. A Vercel faz o deploy automaticamente
```

Alternativa sem tocar no git: na Vercel, escolher o commit funcional
`a626bd8` na lista de deployments e fazer **Redeploy** (producao).

O commit `a626bd8` e considerado o **estado de referencia funcional** para
o dashboard. Qualquer alteracao futura que quebrar a exibicao de valores ou o
fluxo OAuth deve ser revertida para este ponto.