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
   - Obtem o token valido via `obterToken()` (tenta renovacao silenciosa com `refresh_token` se expirou).
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
| `b58ab10` | **Versao funcional original** — perf: deduplica requisicoes concorrentes, paraleliza busca por empresa e mantem dados anteriores durante recarga | Antes de 28/10/2026 |
| `193c74e` | feat: define Hoje como intervalo padrao de pesquisa ao abrir o sistema | Anterior |
| `d2d8ddb` | feat: header simplificado com status de sincronizacao ao lado do Recarregar | Anterior |
| `6dc6409` | Force push do `b58ab10` (revertido apos alteracoes que quebraram o sistema) | 28/10/2026 |

---

## 4. Commit de Reversão Padrao

### Commit recomendado para revert​​ao: `b58ab10`

**Mensagem:** `perf: deduplica requisicoes concorrentes a API, paraleliza busca por empresa e mantem dados anteriores durante recarga`

**Motivo:** Este e o ultimo commit conhecido como totalmente funcional antes de alteracoes que quebraram a soma de valores nos cards KPI e o fluxo de sincronizacao.

**Como reverter para este estado:**

```bash
# No repositorio local
git reset --hard b58ab10
git push origin main --force
```

Ou diretamente pelo hash no GitHub/Vercel, fazendo redeploy desse commit.

---

## 5. Estrutura de Arquivos Relevantes

- `src/lib/contaazul.functions.ts` — `getDashboard`, `listarEmpresas`, `finalizarAutorizacao`, `inspecionarRecebimentos`
- `src/lib/contaazul.server.ts` — `obterToken`, `renovarToken`, `buscarSaldos`, `buscarV2`, `basicAuth`, `getSupabase`
- `src/routes/index.tsx` — Dashboard frontend, indicador de sync, KPI cards, projeto diaria
- `src/routes/api/callback.ts` — Troca do `code` OAuth por `access_token`/`refresh_token`
- `src/routes/api/autorizar.ts` — Redirecionamento para login da Conta Azul
- `src/routes/api/callback.ts` — Endpoint de callback OAuth
- `src/routes/api/renovar-todos.ts` — Renovacao em lote de tokens

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

---

## 8. Como Reverter para `b58ab10` em Caso de Problema

```bash
# 1. Baixe o commit funcional
git reset --hard b58ab10

# 2. Envie para o GitHub (force push)
git push origin main --force

# 3. Faça Redeploy na Vercel
```

O commit `b58ab10` e considerado o **estado de referencia funcional** para o dashboard. Qualquer alteracao futura que quebrar a exibicao de valores ou o fluxo OAuth deve ser revertida para este ponto.