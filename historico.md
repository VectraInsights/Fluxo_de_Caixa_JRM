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

- **Bolinha verde:** nenhuma falha nesta consulta.
- **Bolinha azul pulsando:** sincronizacao em andamento.
- **Bolinha vermelha:** houve falha real nesta consulta (token ausente/invalido ou
  a API da Conta Azul respondeu com erro). Passe o mouse sobre a bolinha para ver
  o detalhe.

> O sinal e decidido pelo campo `avisos` retornado pelo `getDashboard`, **nao**
> pela coluna `status` da tabela `tokens`. Essa coluna atrasa: so e corrigida no
> proximo refresh bem-sucedido e por isso podia manter `ERRO` depois de a empresa
> ja estar funcionando (causava alerta falso).

---

## 3. Historico de Modificacoes

| Commit | Descricao | Data |
|--------|-----------|------|
| `ab8af7f` | feat: XLSX exportado ganha visual profissional (cores, cabecalho escuro, zebrado, totais em destaque, painel congelado, autofiltro e cor de aba) | 30/10/2026 |
| `78bb301` | feat: paginacao fixa no PDF exportado — Faturamento junto do cabecalho/cards e cada secao seguinte (A Receber, A Pagar, Pagos) em pagina nova | 30/10/2026 |
| `80deeec` | feat: coluna Categoria nas listas (A Receber, A Pagar, Pagos) e nos relatorios PDF/XLSX | 30/10/2026 |
| `f89df8c` | feat: relatorios PDF/XLSX listam A Receber, A Pagar e Pagos em ordem alfabetica de Cliente/Fornecedor (tela continua cronologica) | 30/10/2026 |
| `6fe81a5` | feat: faturamento detalhado por cliente (remetente) em cada dia nos relatorios PDF/XLSX | 30/10/2026 |
| `6f541fe` | feat: faixa de 4 cards de totais no topo do PDF exportado (Faturamento, A Receber, A Pagar, Pagos) | 30/10/2026 |
| `5045077` | feat: rotulo da coluna de terceiro na exportacao — "Cliente" em A Receber e "Fornecedor" em A Pagar e Pagos (antes "Contraparte") | 30/10/2026 |
| `b4f8f3a` | feat: inclui o Faturamento (total e por dia) na exportacao em PDF e XLSX | 30/10/2026 |
| `a35f678` | feat: listas do rodape sempre em ordem crescente (data, valor, descricao); exportacao das listas para PDF e XLSX | 30/10/2026 |
| `ab47b8d` | fix: encurta o grafico de projecao (420px -> 300px) e reduz paddings para o card caber inteiro na tela sem rolagem | 30/10/2026 |
| `4a71ff5` | fix: remove texto "Sem pagamentos no periodo" do card Contas Pagas quando o valor e zero | 29/10/2026 |
| `2b85d8d` | feat: opção "Mês atual" no intervalo de projeção, com setas de navegação por mês | 29/10/2026 |
| `c641e7f` | fix: remove cards Saldo Atual e Saldo Previsto; unifica os cards na ordem Faturamento, Entradas, Saídas, Pagos | 29/10/2026 |
| `66dabe9` | feat: faturamento direcionado por remetente (coluna B) — Juvenal/Rosângela/Alvarenga; Alvarenga só em Todas as Empresas | 29/10/2026 |
| `605a656` | fix: faturamento por dia (aba da data na planilha) com parser estrito pt-BR (valor = R$ 195.594,57 no dia 29/10); remove subtítulo de cargas | 29/10/2026 |
| `a08dec3` | feat: card Faturamento ao lado de Contas Pagas, somando a coluna VALOR da planilha de cargas (Google Sheets) | 29/10/2026 |
| `1f07893` | fix: remove "Consolidado" dos titulos do rodape e remove percentual Infinity% do card Contas Pagas | 29/10/2026 |
| `63be4ab` | feat: rodapé com tres colunas — A Receber, A Pagar e Pagos (relação dos títulos quitados no período) | 29/10/2026 |
| `9eda174` | fix: falha ao classificar metodo de pagamento nao acende mais a bolinha vermelha; reduz retries das buscas secundarias (lentidao em dias cheios) | 29/10/2026 |
| `b96f7b0` | fix: status ACQUITTED para buscar contas pagas (orientacao oficial Conta Azul); fallback PAGO | 29/10/2026 |
| `798a957` | fix: busca de pagas em chamada unica rapida (sem cadencia de endpoints); adiciona rota debug-pagas para diagnostico | 29/10/2026 |
| `565506b` | fix: busca de contas pagas resiliente (fallback de endpoints) sem virar erro de sincronizacao; card Contas Pagas vermelho como saida | 29/10/2026 |
| `d74e605` | fix: card Contas Pagas soma apenas titulos efetivamente baixados (status PAGO + data de pagamento), para de espelhar Saidas Previstas | 29/10/2026 |
| `9449fa5` | docs: atualiza historico.md com commit aba1d3d como referencia de reversao | 29/10/2026 |
| `aba1d3d` | **(commit padrao / referencia atual)** — feat: remove cards Receber via Boleto e Outros Meios, adiciona card Contas Pagas | 29/10/2026 |
| `bc69a7a` | fix: refetchOnMount true para carregar dados automaticamente ao abrir dashboard | 29/10/2026 |
| `0f168e1` | fix: JRM Transportes exibe apenas Bradesco, Itaú, Sicoob 3049 e Sicoob 3109 (remove Sicoob sem numero que nao existe na empresa) | 29/10/2026 |
| `c16fbfd` | fix: filtro de bancos por correspondencia exata para nao mostrar Bradesco ap. nem Veloe na Rosangela | 29/10/2026 |
| `e55fa9c` | fix: Rosangela Transportes exibe apenas Bradesco, Itaú, Sicoob 3049 e Sicoob 3109 (remove Bradesco ap. e Veloe que nao existem na empresa) | 29/10/2026 |
| `87c673f` | fix: LGP Transportes exibe apenas Bradesco, Itaú, Sicoob 3049 e Sicoob 3109 | 29/10/2026 |
| `1981bb8` | fix: pagina a listagem de contas financeiras e remove filtro de saldo zerado para exibir todas as contas da Conta Azul | 29/10/2026 |
| `f9f4082` | fix: mostra detalhe da falha no tooltip da bolinha vermelha e remove alertas redundantes causados por status defasado | 29/10/2026 |
| `c065eaf` | fix: remove painel de contas nao exibidas e deixa Rosangela listar todos os bancos para localizar o Sicoob 3109 | 29/10/2026 |
| `a626bd8` | feat: mostra contas nao exibidas no painel de Bancos para diagnosticar banco ausente | 29/10/2026 |
| `902e617` | fix: usa endpoint de token v2 da Conta Azul para corrigir invalid_client na troca de code e na renovacao | 29/10/2026 |
| `68fc942` | feat: adiciona botao e rota de reconexao com a Conta Azul para renovar token de empresa | 29/10/2026 |
| `5af8199` | feat: sinaliza falhas de sincronizacao no dashboard com bolinha vermelha e avisos detalhados | 29/10/2026 |
| `ff37c8e` | fix: remove filtro BANCOS_PERMITIDOS do backend para LGP Transportes receber todos os bancos da API | 28/10/2026 |
| `8ec7d90` | feat: LGP Transportes mostra todos os bancos da API para diagnostico | 28/10/2026 |
| `8a45410` | feat: LGP Transportes mostra apenas ITAU, SICOOB 3049, BRADESCO e SICOOB 3109 | 28/10/2026 |
| `ee1001c` | feat: bancos especificos por empresa — LGP Transportes mostra apenas Bradesco e Sicoob 3109 | 28/10/2026 |
| `344db44` | feat: adiciona aliases BRADESCO S.A e SICOOB para LGP Transportes | 28/10/2026 |
| `29edb6d` | feat: LGP Transportes mostra todos os bancos da API (sem filtro restritivo) | 28/10/2026 |
| `b58ab10` | versao funcional original — perf: deduplica requisicoes concorrentes, paraleliza busca por empresa e mantem dados anteriores durante recarga | Antes de 28/10/2026 |
| `193c74e` | feat: define Hoje como intervalo padrao de pesquisa ao abrir o sistema | Anterior |
| `d2d8ddb` | feat: header simplificado com status de sincronizacao ao lado do Recarregar | Anterior |

---

## 3.1 Regras de Faturamento (planilha de cargas)

**Fonte:** planilha do Google Sheets `173ertIvql5v6l_9v6HJAQkdeL66CA4RSKo5IZrGkFhM`.
Uma aba por dia, com o nome igual ao numero do dia ("01".."31"). Coluna B = REMETENTE, coluna F = VALOR.

**Direcionamento:** o faturamento pertence a empresa do REMETENTE. Os nomes vem no formato
`EMPRESA (CIDADE - UF)` — somente a empresa e considerada (tudo entre parenteses e ignorado).

| Remetente (normalizado) | Empresa |
|-------------------------|---------|
| S.A.GONDOLAS | Rosângela |
| EMATEX | Rosângela |
| FARMAX | Juvenal |
| EMBARE | Juvenal |
| TECNO2000 | Juvenal |
| ORTHOCRIN | **Alvarenga** |
| ESPUMIL | Juvenal |
| BELACCI | Juvenal |
| COPRA | Juvenal |
| AGRONORTE | Juvenal |
| DESIGNTEX | Juvenal |
| AMAPA | Juvenal |
| MODERNA | Juvenal |
| ITABOX | Juvenal |
| ECONOMART | Juvenal |
| ESTHAMPA | Juvenal |
| FIBRASA | Juvenal |

**ATENCAO — Alvarenga:** nao existe (e nao vai existir) no dropdown de empresas. Ela aparece
APENAS na visao "Todas as Empresas". Remetente sem regra cai em "OUTROS" (entra no "todas").

**Valores:** parser estrito pt-BR, mesmo criterio do SUM do Sheets (`R$ 23.000,00` vale;
`21,999.10` e texto invalido e nao conta; `Pendente` nao conta).

**Retorno:** `buscarFaturamentoPlanilha` / `getFaturamento` devolvem `{ total, porDia }`
(uma linha por dia do periodo, inclusive dias sem aba — zero). Esse detalhamento alimenta o
card, a seção "Faturamento" do PDF (faixa verde, antes de "A Receber") e a aba "Faturamento"
do XLSX (aba "Resumo" tambem ganhou a linha Faturamento).

**Detalhe por cliente (remetente) em cada dia:** o cache da aba agora guarda o total POR
REMETENTE (nao por empresa); o filtro de empresa e aplicado depois, na montagem do periodo
(`EMPRESA_POR_REMETENTE` por remetente normalizado, sem regra = OUTROS). Assim cada dia de
`porDia` leva `clientes: [{ nome, total }]` — nome exibido e o remetente SEM o "(CIDADE - UF)".
Nos relatorios (PDF e XLSX), antes do total do dia aparece uma linha por cliente; se o dia
nao tiver lancamentos, sai uma linha unica sem cliente. Ordenados por valor crescente, depois
nome (mesma regra das listas). A tela nao mudou: o card continua mostrando apenas o total.

---

## 3.2 Categoria financeira (Conta Azul)

**Fonte:** campo `categorias` dos titulos, vindo da propria API da Conta Azul (sem relacao
com a planilha de cargas).

Os dois formatos que a API usa dependem do endpoint:

| Lista | Endpoint | De onde vem a categoria |
|-------|----------|-------------------------|
| A Receber | `GET /v1/financeiro/eventos-financeiros/contas-a-receber/buscar` | `itens[].categorias[].nome` |
| A Pagar | `GET /v1/financeiro/eventos-financeiros/contas-a-pagar/buscar` | `itens[].categorias[].nome` |
| Pagos | `GET /v1/financeiro/contas-a-pagar` (status ACQUITTED / PAGO) | `itens[].evento.rateio[].nome_categoria` |

**`extrairCategoria()`** (em `contaazul.server.ts`) cobre as duas estruturas e variantes
(`categoria`, `nome_categoria`, `rateio` na raiz), unindo varias categorias com `" / "`.
O que nao vier vira `null` e a coluna sai **em branco** — nunca derruba a lista.

**Passagem ate o relatorio:** `ItemLancamento.categoria` → `TituloDetalhe.categoria`
(`contaazul.functions.ts`) → coluna "Categoria" do **PDF** e do **XLSX**, sempre entre
*Cliente/Fornecedor* e *Empresa*. Nas listas da tela a coluna **nao** foi adicionada
(pedido: apenas nos relatorios).

---

## 3.3 Ordenacao das listas nos relatorios (alfabetica por Cliente/Fornecedor)

Vale **apenas para os relatorios** (PDF e XLSX); a tela continua cronologica.

Duas funcoes em `exportar.ts`:

| Funcao | Onde | Ordem |
|--------|------|-------|
| `ordenarTitulos` | tela (rodape) | data → valor → descricao → empresa |
| `ordenarTitulosRelatorio` | PDF e XLSX (as 3 listas) | **Cliente/Fornecedor (alfabetico)** → data → valor → descricao → empresa |

Regras do `ordenarTitulosRelatorio`:

- Comparacao **sem acento e sem maiusculas** (ÁLVARO = alvaro; emtex antigo ordena junto).
- Titulos **sem Cliente/Fornecedor vao para o fim** da lista.
- Dentro do mesmo terceiro: **data crescente** e, no mesmo dia, **valor crescente**.
- Desempates finais (descricao → empresa) mantidos para ordem deterministica.

A função de total dos cards do PDF (`reduce`) continua usando a lista original — ordem
irrelevante para a soma.

---

## 3.4 Paginacao do PDF exportado (secoes em paginas fixas)

Regra pedida e aplicada em `exportarPdf` (`src/lib/exportar.ts`):

| Secao | Pagina |
|-------|--------|
| **Faturamento** | **sempre na MESMA pagina do cabecalho e dos 4 cards de totais** (nunca abre pagina nova antes dela) |
| **A Receber** | pagina nova, imediatamente apos a ultima pagina do Faturamento |
| **A Pagar** | pagina nova, imediatamente apos a ultima pagina do A Receber |
| **Pagos** | pagina nova, imediatamente apos a ultima pagina do A Pagar |

Como o `autoTable` pagina sozinho quando a tabela nao cabe, "ultima pagina da secao"
pode ser varias paginas adiante: a proxima secao sempre comeca na pagina seguinte
ao ultimo pedaco de conteudo da secao anterior (nunca sobra pagina vazia no fim,
porque a quebra acontece **antes** de cada secao, nao depois).

O que mudou no codigo:

- O guard antigo `if (altura - margem - y < 45) { doc.addPage(); y = 24; }` (que
  quebrava a pagina **antes** da secao, quando nao havia espaco) foi **removido** —
  ele era a causa de o Faturamento as vezes comecar em pagina nova.
- Agora cada secao de titulos faz `doc.addPage()` no inicio e recomeca em `y = 24`
  (topo da pagina, com a faixa colorida do titulo logo abaixo).
- O Faturamento nao faz nenhuma quebra: ele sai logo abaixo dos cards, na pagina 1.

Validacao local (script temporario, nao vai para o repo): PDF gerado com 3 cenarios
(conteudo curto, conteudo longo com tabelas quebrando em varias paginas e cenario
sem faturamento). Resultado: Faturamento na pagina 1 (y=58), A Receber na pagina 2
(y=25), A Pagar na pagina 3 (y=25), Pagos na pagina 4 (y=25); no cenario longo,
Faturamento ocupa as paginas 1..8, A Receber comeca na 9, A Pagar na 15 e Pagos na 20.
Nenhum texto abaixo da margem inferior (so o rodape com a numeracao de paginas).

O XLSX **nao** muda: paginacao so faz sentido em PDF.

---

## 3.5 Visual do XLSX exportado (planilha formatada)

A exportacao de planilha foi reescrita para sair "bonita" no Excel / Google Sheets.

**Dependencias:** `xlsx-js-style` (fork do SheetJS que grava estilo de celula — o `xlsx`
original, na versao Community, ignora cores, bordas e alinhamento na escrita) e `fflate`
(remonta o zip do `.xlsx` para injetar painel congelado, cor de aba e esconder as linhas
de grade — recursos que o SheetJS nao grava). O pacote `xlsx` foi removido do
`package.json` (nao era usado em mais nenhum lugar).

**Visual por aba:**

| Aba | Visual |
|-----|--------|
| **Resumo** | titulo + periodo; 4 linhas com o nome da relacao pintado na cor (verde/vermelho, igual aos cards do PDF), total em moeda, quantidade de titulos e rodape "Gerado em ..." |
| **Faturamento** | titulo na cor verde, uma linha por cliente, linha "Total do dia" em negrito com fundo claro, linha TOTAL com borda dupla |
| **A Receber / A Pagar / Pagos** | titulo na cor da relacao, cabecalho escuro com texto branco, zebrado no corpo, quebra de linha em Descricao e Categoria, linha TOTAL em negrito |

**Em todas as abas:** cabecalho congelado (4 linhas: titulo, periodo, separador e
cabecalho da tabela), autofiltro, larguras de coluna calibradas, linhas de grade
escondidas e cor na aba da planilha (verde para Faturamento/A Receber, vermelho para
A Pagar/Pagos).

**Formatos de numero:** moeda `"R$" #,##0.00` (negativo em vermelho) e inteiro `#,##0`.

**Nenhuma regra de negocio mudou:** mesmas abas, mesma ordem alfabetica por
Cliente/Fornecedor, mesmos totais — so o visual.

---

## 4. Commit de Reversão Padrao

### Commit recomendado para revert​​ao: `1f07893`

**Mensagem:** `fix: remove Consolidado dos titulos do rodape e remove percentual do card Contas Pagas`

**Estado conhecido como funcional (29/10/2026):**
- Dashboard carrega valores reais da Conta Azul automaticamente ao abrir (nao precisa de F5).
- Bolinha de sincronizacao fica vermelha se houver falha.
- Botao **"Conectar Conta Azul"** funciona: gera um token novo para a empresa.
- Renovacao automatica de token funciona (endpoint v2 da Conta Azul).
- Bolinha de sincronizacao mostra status correto (verde/vermelho/azul pulsando).
- Cards mostram: Saldo Atual, Entradas Previstas, Saídas Previstas, Saldo Previsto, Contas Pagas.

**Como reverter para este estado:**

```bash
# No repositorio local
git reset --hard aba1d3d
git push origin main --force
```

Ou diretamente pelo hash no GitHub/Vercel, fazendo redeploy desse commit.

**IMPORTANTE:** Nao faca mais alteracoes no codigo sem testar primeiro em ambiente local. O commit `aba1d3d` e o estado de referencia funcional.

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
| Alerta de falha aparece mesmo com tudo sincronizado | A coluna `status` da tabela `tokens` **atrasa** em relacao ao estado real: ela so e corrigida para `ATIVO` no proximo refresh bem-sucedido, entao pode continuar `ERRO` depois que a empresa ja voltou a funcionar. O frontend usava esse campo para acender o alerta | Corrigido no commit `f9f4082`: o sinal autoritativo passou a ser o campo `avisos` do `getDashboard` (o que falhou **nesta** consulta). O `status` do banco ficou so como pista para as empresas que nao foram consultadas na carga atual |

### Indicador de sincronizacao (UI)

- **Bolinha verde** + "Ultima sincronizacao: HH:MM": tudo ok.
- **Bolinha azul pulsando**: consulta em andamento.
- **Bolinha vermelha** + "Falha na sincronizacao": houve falha real nesta consulta.
  Passe o mouse sobre a bolinha para ver o detalhe (qual empresa e qual falha) e a
  orientacao de correcao.

O detalhe fica em **tooltip** no cabecalho, e nao mais em caixa fixa — antes havia
duas caixas de alerta (uma vermelha no topo e uma amarela no fim da tela) que
davam o mesmo aviso e ainda disparavam por engano por causa do `status` defasado.

O botao **"Conectar Conta Azul"** aparece na lateral quando a empresa selecionada
esta entre as que falharam nesta consulta (`empresas_com_problema`).
| Banco existe na Conta Azul mas nao aparece no painel | (a) saldo da conta zerado — o painel esconde contas com `|saldo| < 0,01`; (b) a chamada `saldo-atual` falhou; (c) o nome nao contem nenhuma das chaves de `bancosPermitidos` em `index.tsx` | Ver secao abaixo. Se for (c), adicionar a chave do banco em `bancosPermitidos` |

### Diagnosticando um banco que nao aparece

O backend envia **todas** as contas financeiras que a API da Conta Azul retornar
(`buscarSaldos`); quem filtra e o frontend, em `src/routes/index.tsx`. Tres motivos
fazem uma conta ficar de fora do painel:

- **Saldo zerado** — o filtro esconde contas com `|saldo| < 0,01` de proposito.
- **Falha ao ler o saldo** — a chamada `GET /v1/conta-financeira/{id}/saldo-atual`
  retornou erro. Nesse caso o dashboard emite aviso na bolinha vermelha
  ("nao foi possivel ler o saldo de X").
- **Fora do filtro de bancos** — tem saldo, mas o nome nao bate com nenhuma chave.

A lista de chaves padrao e `["ITAU", "SICOOB", "SICOOB 3109", "BRADESCO"]`, aplicada
por **substring** sem distincao de maiusculas: qualquer conta cujo nome contenha
"SICOOB" passa, inclusive "Sicoob 3049". Para aceitar outro banco, adicione a chave
correspondente em `bancosPermitidos`.

**Como localizar uma conta que nao aparece:** coloque a empresa em
`bancosPorEmpresa` (em `index.tsx`) com array vazio `[]` — isso faz a empresa
mostrar **todas** as contas que a API retornar, sem filtro de nome. Se mesmo assim
a conta nao aparecer, ela nao existe na Conta Azul para essa empresa (confira se
esta no CNPJ/empresa errado). Para exibir tambem as contas zeradas, adicione o
nome da empresa em `mostrarContasZeradas` (mesmo arquivo).

> **Atencao:** o Sicoob 3109 que aparece no painel da **JRM Transportes** e da JRM,
> nao da Rosângela Transportes. Sao contas de empresas diferentes.

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