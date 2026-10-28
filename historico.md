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
3. A Conta Azul autentica o usuario e devolve um `code` na URL da aplicacao.
4. O dashboard captura o `code` e chama o `/api/callback` (GET) para trocar o codigo por `access_token` e `refresh_token`.
5. O token e salvo no Supabase na tabela `tokens` com status `ATIVO`.

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
| `ff37c8e` | **Versao funcional atual** — fix: remove filtro BANCOS_PERMITIDOS do backend para LGP Transportes receber todos os bancos da API | 28/10/2026 |
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

**Mensagem:** `fix: remove filtro BANCOS_PERMITIDOS do backend para LGP Transportes receber todos os bancos da API`

**Motivo:** Este e o ultimo commit conhecido como totalmente funcional. Todas as alteracoes feitas apos este commit (tentativas de corrigir renovacao de token, paginacao, filtros por empresa) quebraram o funcionamento do dashboard.

**Como reverter para este estado:**

```bash
# No repositorio local
git reset --hard ff37c8e
git push origin main --force
```

Ou diretamente pelo hash no GitHub/Vercel, fazendo redeploy desse commit.

**IMPORTANTE:** Nao faca mais alteracoes no codigo sem testar primeiro em ambiente local. O commit `ff37c8e` e o estado de referencia funcional.

---

## 5. Estrutura de Arquivos Relevantes

- `src/lib/contaazul.functions.ts` — `getDashboard`, `listarEmpresas`, `inspecionarRecebimentos`
- `src/lib/contaazul.server.ts` — `obterToken`, `renovarToken`, `buscarSaldos`, `buscarV2`, `basicAuth`, `getSupabase`
- `src/routes/index.tsx` — Dashboard frontend, indicador de sync, KPI cards, projeto diaria
- `src/routes/api/callback.ts` — Troca do `code` OAuth por `access_token`/`refresh_token`
- `src/routes/api/autorizar.ts` — Redirecionamento para login da Conta Azul

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
| Bolinha verde com token expirado | Frontend nao detectava status ERRO | Corrigido: bolinha fica vermelha quando empresa esta com `status = ERRO` |
| Erro 400 no callback | `redirect_uri` nao confere com o cadastrado na Conta Azul | Usar exatamente `https://jrm-dashboard.vercel.app/` |
| Token nao salva no Supabase | Credenciais `CONTA_AZUL_CLIENT_ID`/`SECRET` nao configuradas na Vercel | Adicionar as env vars e fazer Redeploy |
| Banco nao aparece na lista | Filtro `BANCOS_PERMITIDOS` no backend | Removido no commit `ff37c8e` — backend agora envia todos os bancos da API |

---

## 8. Como Reverter para `ff37c8e` em Caso de Problema

```bash
# 1. Baixe o commit funcional
git reset --hard ff37c8e

# 2. Envie para o GitHub (force push)
git push origin main --force

# 3. Faça Redeploy na Vercel
```

O commit `ff37c8e` e considerado o **estado de referencia funcional** para o dashboard. Qualquer alteracao futura que quebrar a exibicao de valores ou o fluxo OAuth deve ser revertida para este ponto.