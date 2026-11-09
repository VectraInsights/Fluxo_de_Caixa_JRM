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
   - Busca os titulos **efetivamente pagos** (`buscarPagas`) e **efetivamente
     recebidos** (`buscarRecebidas`) — titulos ja quitados no periodo.
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
| `fcd60ea` | fix: mensagem de erro da exportacao pede para atualizar a pagina (libs antigas apos deploy) | 05/11/2026 |
| `230a293` | feat: mostra o banco/conta financeira do titulo no PDF e no XLSX (Recebidos e Pagos) | 05/11/2026 |
| `0904139` | feat: cache persistente das baixas no Supabase (tabela baixas_cache) + TTL de 12h e 32 chamadas em paralelo | 05/11/2026 |
| `a1c0d56` | feat: deixa as listas de titulos do painel legiveis (descricao ocupa a largura da coluna em 2 linhas) | 05/11/2026 |
| `7825474` | feat: aumenta as fontes do PDF impresso (tabelas 8,5 pt) mantendo o rodape em 8 pt | 04/11/2026 |
| `9defc7a` | fix: listas de Pagos/Recebidos usam a data real do pagamento (baixa da parcela), recupera titulos recebidos descartados pelo vencimento e deixa o PDF mais compacto | 04/11/2026 |
| `1a398a2` | fix: remove a linha de Desc/Juros/Multa dos cards e do rodape (o valor ja vem com o desconto aplicado) | 04/11/2026 |
| `9c6228e` | fix: titulos pagos/recebidos exibem o valor liquido (com desconto) e as paginas da listagem sao buscadas em paralelo | 04/11/2026 |
| `6453fea` | feat: rota de diagnostico `/api/debug-baixas` que revela o JSON cru da baixa (desconto, juros, multa e valor pago real) para descobrir onde o desconto da Conta Azul e gravado | 04/11/2026 |
| `76ced54` | fix: paginas de pagos/recebidos recusadas pela API (rate limit) viravam total parcial no carregamento automatico — paginacao que reinicia, resultado incompleto fora do cache e refetch automatica da tela | 04/11/2026 |
| `b4c3e3e` | fix: corrige os erros de tipagem que quebravam o build apos o pull do remoto (campos de desconto/juros no resumo, nivel "debug" no log, id do titulo) e o regex de Estorno/Estornado no PDF | 04/11/2026 |
| `d986f21` | fix: desconto aplicado corretamente - detecta se pago eh bruto (pago ~= total) ou liquido (pago ~= total - desconto) comparando com o total da parcela | 03/11/2026 |
| `89bab13` | fix: desconto ja vem no pago da Conta Azul (valor liquido) - nao subtrair duas vezes; usa pago/valorPagoCampo diretamente e soma apenas juros/multa separados | 03/11/2026 |
| `5bb74c3` | fix: desconto/juros/multa busca em valor_composicao / composicao_valor (baixas e parcelas) da Conta Azul para nao perder lancamentos com desconto | 03/11/2026 |
| `99c103e` | fix: extração recursiva de desconto/juros/multa em qualquer nível do JSON da Conta Azul (inclui valor_composicao serializado como string) + log via gravarLogEvento quando desconto é detectado | 03/11/2026 |
| `cf4712d` | fix: conta com desconto detecta mais campos (valor_desconto_concedido, valor_pago_liquido, etc.) e total no PDF so na ultima linha da planilha (nao no rodape de cada pagina) | 03/11/2026 |
| `dcffce6` | fix: busca de saldos em lotes de 3 com retry e delay entre lotes para evitar rate limit da Conta Azul na primeira carga (erro 3039 / falha de sincronizacao) | 03/11/2026 |
| `9bdb86f` | fix: lista de pagos/recebidas usa dados do getDashboard (fonte unica) para nao divergir do card — detalhamento por empresa incluso na resposta do dashboard | 03/11/2026 |
| `8a3c37e` | fix: busca de pagas/recebidas retorna itens ja coletados mesmo que uma pagina posterior da API falhe | 03/11/2026 |
| `bd1513d` | fix: remove limite de paginas na busca de pagas e recebidas (sem teto de 20 paginas, itera ate a API parar de retornar itens) | 03/11/2026 |
| `9414151` | fix: busca de pagas agora pagina todas as paginas da API (antes so trazia a primeira pagina de 100, faltando titulos) | 03/11/2026 |
| `2e59959` | chore: remove a constante morta BANCOS_PERMITIDOS e documenta o filtro por bancos | 03/11/2026 |
| `f190684` | feat: filtra os titulos (A Receber, A Pagar, Pagos e Recebidos) pelos bancos exibidos no painel — lista de bancos compartilhada entre frontend e backend | 03/11/2026 |
| `ed2510f` | docs: registra a remocao das colunas Categoria, Empresa e Metodo condicional no PDF impresso | 03/11/2026 |
| `b116335` | fix: remove a coluna Empresa do PDF impresso (ja sai separado por empresa) e torna a coluna Metodo condicional | 03/11/2026 |
| `68f7924` | fix: remove a coluna Categoria do PDF impresso (mantida no XLSX) | 03/11/2026 |
| `6820f4d` | docs: documenta a separacao por empresa no PDF de Todas as Empresas | 03/11/2026 |
| `93cd843` | feat: PDF de "Todas as Empresas" separado por empresa — cada empresa em um bloco proprio, com Faturamento, Recebidos e Pagos na mesma folha enquanto houver espaco | 03/11/2026 |
| `348dde5` | docs: documenta o recebimento de titulos quitados (card Contas Recebidas, lista Recebidos) e o novo recorte do PDF impresso | 03/11/2026 |
| `852ac2d` | feat: puxa as contas efetivamente recebidas (titulos quitados) — card "Contas Recebidas", lista "Recebidos" no rodape e secao "Recebidos" nos relatorios; o PDF impresso passa a ter apenas Faturamento, Recebidos e Pagos (sem A Receber, A Pagar e sem o card de Resultado) | 03/11/2026 |
| `969164a` | feat: aviso no painel de confirmacao quando o mes escolhido ja tem planilha salva (mesma URL = re-registro; URL diferente = substituir, mostrando a URL atual) | 01/11/2026 |
| `e0f3dd7` | feat: seletor de mes no painel de confirmacao do registro de planilha (pré-selecionado com a sugestao do sistema, jan/2026 a dez/2030, meses ja cadastrados com ✓) | 01/11/2026 |
| `8ceca5c` | fix: titulo da planilha lido pela pagina /edit traz so o nome do documento (sem a primeira aba no sufixo); export CSV vira fallback | 01/11/2026 |
| `1435de9` | feat: cadastro de planilha em dois passos — le o nome da planilha e deduz o mes/ano ("10.26 OUTUBRO" -> out/2026), pergunta ao usuario e so registra apos confirmacao (fallback: mes visado) | 01/11/2026 |
| `9485f3d` | feat: sidebar "Planilhas de Faturamento" simplificada para apenas campo de URL + botao (mes = mes visado no painel) | 01/11/2026 |
| `083f56d` | fix: diagnostico do cron distingue CRON_SECRET ausente no ambiente (500) de valor invalido (401) | 01/11/2026 |
| `670b3c6` | feat: endpoint de teste do Slack no cron (?teste=slack) para validar alertas ponta a ponta | 01/11/2026 |
| `db92f2e` | feat: tabela `planilhas_mes` (upsert por PK mes, jan/2026 a dez/2030) e cadastro da URL da planilha de faturamento por mes na sidebar | 01/11/2026 |
| `1671afd` | feat: cron nativo diario na Vercel (`vercel.json`, 13h UTC ~ 10h BRT) para renovacao em lote de tokens via `/api/cron/renovar-tokens` | 01/11/2026 |
| `6191824` | fix: renovacao proativa de token, lock distribuido, log de eventos (`gravarLogEvento`), alerta Slack (`enviarAlertaSlack`/`testarSlack`) e endpoint cron de renovacao em lote (`executarRenovacaoEmLote`) | 01/11/2026 |
| `d695a95` | docs: documenta o novo topo do PDF (titulo curto e card do Resultado a direita) | 30/10/2026 |
| `755b280` | docs: preenche hash a784dc8 no historico | 30/10/2026 |
| `a784dc8` | feat: titulo do PDF so "Fluxo de Caixa" e card do Resultado no topo a direita (verde/vermelho conforme o sinal) | 30/10/2026 |
| `8ca4056` | feat: relatorios voltam a ter os 4 cards e ganham o valor "Resultado" (A Receber − A Pagar) no PDF e na aba Resumo do XLSX | 30/10/2026 |
| `5cd6da6` | feat: resumo dos relatorios (cards do PDF e aba Resumo do XLSX) passa a trazer apenas A Receber e A Pagar | 30/10/2026 |
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
| DESINGTEX | Juvenal | *(grafia errada de DESIGNTEX)*
| MODULO EMBALAGENS | Juvenal |
| ZAR PINTURAS | Juvenal |

**ATENCAO — Alvarenga:** nao existe (e nao vai existir) no dropdown de empresas. Ela aparece
APENAS na visao "Todas as Empresas". Remetente sem regra cai em "OUTROS" (entra no "todas").

**Casamento sem espacos:** a regra e procurada pelo nome normalizado **sem espacos** —
"S.A. GONDOLAS" e "S.A.GONDOLAS" (duas grafias do mesmo cliente) caem na mesma regra.
As grafias que nao batem com nenhuma regra (ex.: "DESINGTEX", "MODULO EMBALAGENS" e
"ZAR PINTURAS" ate 06/11/2026) caiam em "OUTROS".

**Valores:** parser estrito pt-BR, mesmo criterio do SUM do Sheets (`R$ 23.000,00` vale;
`21,999.10` e texto invalido e nao conta; `Pendente` nao conta).

**Retorno:** `buscarFaturamentoPlanilha` / `getFaturamento` devolvem `{ total, porDia }`
(uma linha por dia do periodo, inclusive dias sem aba — zero). Esse detalhamento alimenta o
card, a seção "Faturamento" do PDF (faixa verde, antes de "Recebidos") e a aba "Faturamento"
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
| Recebidos | `GET /v1/financeiro/contas-a-receber` (status ACQUITTED / PAGO) | mesma extracao das contas a receber |

**`extrairCategoria()`** (em `contaazul.server.ts`) cobre as duas estruturas e variantes
(`categoria`, `nome_categoria`, `rateio` na raiz), unindo varias categorias com `" / "`.
O que nao vier vira `null` e a coluna sai **em branco** — nunca derruba a lista.

**Passagem ate o relatorio:** `ItemLancamento.categoria` → `TituloDetalhe.categoria`
(`contaazul.functions.ts`) → coluna "Categoria" do **XLSX**, sempre entre
*Cliente/Fornecedor* e *Empresa*. Nas listas da tela a coluna **nao** foi adicionada
(pedido: apenas nos relatorios).

> **Notas (03/11/2026) — colunas do PDF impresso:**
> - **"Categoria" foi REMOVIDA** do PDF. A coluna continua no **XLSX**, onde e util
>   para filtrar/pivotar, e a extracao no backend (`extrairCategoria`) segue igual.
> - **"Empresa" tambem foi REMOVIDA** — o relatorio ja vem separado por empresa
>   (secao 3.8), entao ela era repetida em todas as linhas.
> - **"Metodo" virou condicional**: so aparece se a lista tiver algum metodo
>   preenchido (nos Pagos e Recebidos ela e **sempre vazia**, porque esses titulos
>   vem sem metodo).
>
> No PDF impresso restam, no maximo, **4 colunas**: **Data, Descricao,
> Cliente/Fornecedor e Valor**.

---

## 3.3 Ordenacao das listas nos relatorios (alfabetica por Cliente/Fornecedor)

Vale **apenas para os relatorios** (PDF e XLSX); a tela continua cronologica.

Duas funcoes em `exportar.ts`:

| Funcao | Onde | Ordem |
|--------|------|-------|
| `ordenarTitulos` | tela (rodape) | data → valor → descricao → empresa |
| `ordenarTitulosRelatorio` | PDF e XLSX (as 4 listas) | **Cliente/Fornecedor (alfabetico)** → data → valor → descricao → empresa |

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
| **Faturamento** | **sempre na MESMA pagina do cabecalho e dos 3 cards de totais** (nunca abre pagina nova antes dela) |
| **Recebidos** | pagina nova, imediatamente apos a ultima pagina do Faturamento |
| **Pagos** | pagina nova, imediatamente apos a ultima pagina dos Recebidos |

> **Nota:** a lista do PDF mudou em 03/11/2026 (`852ac2d`). Antes eram 4 secoes
> (Faturamento, A Receber, A Pagar, Pagos) e 4 cards; agora o PDF impresso tem
> **apenas Faturamento, Recebidos e Pagos** (3 cards, 3 secoes). "A Receber" e
> "A Pagar" continuam existindo **apenas no XLSX** (e na tela).
>
> **Nota 2:** no filtro **"Todas as Empresas"** a paginação acima **nao se aplica**:
> o PDF sai separado por empresa, com as secoes da mesma empresa fluindo na mesma
> folha (ver secao 3.8).

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

Revalidado em 03/11/2026 com a lista nova do PDF (Faturamento, Recebidos, Pagos):
Faturamento na pagina 1 junto do cabecalho e dos 3 cards, Recebidos na pagina 2 e
Pagos na pagina 3.

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
| **Resumo** | titulo + periodo; 5 linhas de relacao (Faturamento, A Receber, A Pagar, Pagos, Recebidos) com o nome pintado na cor (verde/vermelho, igual aos cards do PDF), total em moeda, quantidade de titulos, mais a linha "Resultado (A receber - A pagar)" e o rodape "Gerado em ..." |
| **Faturamento** | titulo na cor verde, uma linha por cliente, linha "Total do dia" em negrito com fundo claro, linha TOTAL com borda dupla |
| **A Receber / A Pagar / Pagos / Recebidos** | titulo na cor da relacao, cabecalho escuro com texto branco, zebrado no corpo, quebra de linha em Descricao e Categoria, linha TOTAL em negrito |

**Em todas as abas:** cabecalho congelado (4 linhas: titulo, periodo, separador e
cabecalho da tabela), autofiltro, larguras de coluna calibradas, linhas de grade
escondidas e cor na aba da planilha (verde para Faturamento/A Receber/Recebidos,
vermelho para A Pagar/Pagos).

**Abas geradas (6):** `Resumo`, `Faturamento`, `A Receber`, `A Pagar`, `Pagos`,
`Recebidos`.

**Formatos de numero:** moeda `"R$" #,##0.00` (negativo em vermelho) e inteiro `#,##0`.

**Nenhuma regra de negocio mudou:** mesmas abas, mesma ordem alfabetica por
Cliente/Fornecedor, mesmos totais — so o visual.

---

## 3.6 Resultado dos relatorios (Recebidos − Pagos)

O relatorio ganha um valor de **Resultado**, calculado **apenas com "Recebidos" e
"Pagos"** (o caixa do periodo):

```
Resultado = total de Recebidos − total de Pagos
```

Faturamento, A Receber e A Pagar **nao entram** no calculo.

| Parte | Onde aparece |
|-------|--------------|
| XLSX | aba "Resumo", linha "Resultado (Recebidos - Pagos)" (verde/vermelho conforme o sinal) + nota explicativa abaixo da tabela |

O **titulo do PDF** e so **"Fluxo de Caixa"** (antes era "Fluxo de Caixa —
Faturamento, A Receber, A Pagar e Pagos").

> **Nota (03/11/2026, `852ac2d`):** o **card de Resultado saiu do PDF** e o PDF
> passou a mostrar **apenas Faturamento, Recebidos e Pagos** (3 cards, 3 secoes).
> O Resultado continua **apenas no XLSX** (aba "Resumo") — e por isso
> `calcularResultado()` nao e mais chamado pelo `exportarPdf`.

> **Nota (06/11/2026):** o calculo mudou de **A Receber − A Pagar** para
> **Recebidos − Pagos** (o caixa do periodo). A implementacao esta em
> `calcularResultado(rel)` em `exportar.ts` (soma de `rel.recebidas` menos soma de
> `rel.pagos`).

---

## 3.7 Contas efetivamente recebidas (Recebidos)

Antes desta mudanca o dashboard trazia **so as entradas previstas** (titulos em
aberto) e **so as saidas efetivas** (titulos pagos). Um titulo que era recebido e
baixado **sumia** do painel: saia de "A Receber" (deixava de estar `EM_ABERTO`) e
nao tinha para onde ir. Agora existe o **espelho do "Pagos"** do lado das entradas.

**Backend** (`src/lib/contaazul.server.ts`):

| Funcao | Papel |
|--------|-------|
| `buscarRecebidas(empresa, inicio, fim)` | busca os titulos de contas a receber **quitados** no periodo (cache de 2 min, igual ao `buscarPagas`) |
| `buscarRecebidasInterna(...)` | testas as combinacoes de endpoint x status e fica com a **primeira que responder 200** |
| `processarRecebidas(itens, inicio, fim)` | funcao **pura**: normaliza os itens da API e aplica o filtro de data (testavel sem API) |
| `extrairDataRecebimento(i)` | acha a data de recebimento/baixa em varias estructuras da API |

**Combinacoes testadas** (a API pode atender por um endpoint e recusar o status):

| Endpoint | Status |
|----------|--------|
| `/v1/financeiro/contas-a-receber` | `ACQUITTED`, depois `PAGO` |
| `/v1/financeiro/eventos-financeiros/contas-a-receber/buscar` | `ACQUITTED`, depois `PAGO` |

**Regras do `processarRecebidas`:**

- **Valor:** `pago > 0 ? pago : total` (mesma regra do `buscarPagas`).
- **Data:** `data_recebimento` → `data_pagamento` → `data_baixa` → `data_quitacao`
  → `baixas[0].data*` → `parcelas[0].data*`; ultimo recurso `data_vencimento`.
- **Periodo:** o filtro e refeito **no cliente** (a API pode ignorar o parametro
  `data_pagamento_de/_ate`); titulo sem data ou fora do periodo e descartado.
- Titulo sem `id` ou com valor <= 0 e descartado.
- `categoria`, `terceiro` e `descricao` usam os mesmos extratores do `buscarPagas`.

**Propagacao:**

- `getDashboard` → `resumo.total_recebidas` (novo campo) e `recebidas` no resultado por empresa.
- `getEmpresaBreakdown` → `recebidas: { total, titulos }` (nova lista).
- Tela: card **"Contas Recebidas"** (verde) entre "Saidas Previstas" e "Contas Pagas"
  (grid `xl:grid-cols-5`) e lista **"Recebidos"** (verde) no rodape, que passa a ter
  4 colunas (A Receber | A Pagar | Pagos | Recebidos).
- Relatorios: secao/aba **"Recebidos"** (coluna de terceiro = "Cliente", verde).

**Relatorios depois da mudanca:**

| Relatorio | Conteudo |
|-----------|----------|
| **PDF impresso** | **apenas** Faturamento, Recebidos e Pagos (3 cards + 3 secoes). **Sem** A Receber, **sem** A Pagar e **sem** card de Resultado |
| **XLSX** | todas as listas: Resumo (com a linha "Resultado (A receber - A pagar)"), Faturamento, A Receber, A Pagar, Pagos e Recebidos |

Em `exportar.ts` isso e controlado por `ROTULOS_PDF` (filtragem de `ROTULOS`, na ordem
**Recebidos → Pagos**), usada tanto nos cards quanto no loop de secoes do PDF. O XLSX
continua usando a lista completa `ROTULOS`.

**Diagnostico em producao:** rota `/api/debug-recebidos?empresa=NOME&inicio=YYYY-MM-DD&fim=YYYY-MM-DD`
(espelho do `/api/debug-pagas`) — mostra o JSON cru de cada combinacao de
endpoint/status, a quantidade de itens e as datas de recebimento. Como as variaveis
de ambiente (tokens da Conta Azul) so existem na Vercel, esta e a forma de conferir
em producao qual endpoint/status responde de verdade.

---

## 3.8 PDF de "Todas as Empresas" separado por empresa

Antes, o PDF do filtro "Todas as Empresas" trazia **tudo junto**: um bloco de
Faturamento (de todas as empresas), um bloco de Recebidos (de todas) e um de Pagos
(de todas). Agora o relatorio sai **separado por empresa**: cada empresa tem um
bloco proprio, com os **lancamentos dela juntos** — Faturamento, Recebidos e Pagos
da mesma empresa ficam **na mesma folha enquanto ainda houver espaco**.

**Exemplo (4 empresas):**

```
Pagina 1  |  cabecalho + 3 cards (totais consolidados)
           |  [ALVARENGA]        Faturamento R$ 500
Pagina 2  |  [JRM TRANSPORTES]  Recebidos R$ 90 | Pagos R$ 120
Pagina 3  |  [JUVENAL TRANSPORTES] Faturamento | Recebidos | Pagos  (tudo na mesma folha)
Pagina 4  |  [ROSANGELA TRANSPORTES] Faturamento | Recebidos | Pagos (tudo na mesma folha)
```

**Regras:**

- Cada empresa comeca numa **pagina nova** (a primeira continua na pagina 1, logo
  apos os cards de totais, que continuam **consolidados**).
- Dentro do bloco da empresa as secoes **fluem**: a proxima secao so pula de
  pagina se nao couber a faixa + um pedaco da tabela (`garantirEspaco`, minimo
  de 42 mm). Sem essa checagem a faixa da secao ficaria "orfa" no rodape da
  pagina anterior.
- Secao vazia e **pulada** (empresa sem Recebidos nao ganha tabela vazia).
- As empresas saem em **ordem alfabetica**.
- A faixa da empresa mostra o nome e, a direita, os totais dela
  (Faturamento / Recebidos / Pagos).

**Como as empresas sao reconciliadas:**

| Origem | Campo | Exemplo |
|--------|-------|---------|
| Faturamento (planilha) | chave do "dono", nova em `clientes[].empresa` | `JUVENAL`, `ROSANGELA`, `ALVARENGA`, `OUTROS` |
| Listas de titulos | `empresa` cadastrada | `Juvenal Transportes` |

`chaveEmpresa()` (em `exportar.ts`) normaliza o nome (sem acento, sem caixa) e
aplica a **mesma regra de prefixo** do filtro da planilha
(`filtroDaEmpresa` em `planilha.server.ts`): "Juvenal Transportes" -> `JUVENAL`,
"Rosângela Transportes" -> `ROSANGELA`. Empresa sem regra (ex.: "JRM Transportes")
fica com a propria chave normalizada. O nome exibido e o **cadastrado** quando
existe; senao, um nome amigavel (`Alvarenga`, `Rosângela`, `Juvenal`, `Outros`).

**Mudancas no codigo:**

- `planilha.server.ts`: `clientes[].empresa` passa a trazer a chave do dono.
- `exportar.ts`: `FaturamentoExport` ganhou `clientes[].empresa`; novas funcoes
  `chaveEmpresa()`, `agruparPorEmpresa()` e o tipo `GrupoEmpresa`; o desenho das
  secoes foi extraido para `secaoFaturamento()` / `secaoTitulos()` (usadas nos
  dois modos).
- `contaazul.functions.ts`: tipo de retorno do `getFaturamento` atualizado.

**Empresa unica (fora do "Todas"):** **nao mudou** — segue a paginação fixa
aprovada (Faturamento na pagina 1 com o cabecalho/cards, cada secao seguinte
numa pagina nova). O XLSX **nao muda** (continua com as 6 abas e o Resumo
consolidado).

---

## 3.9 Titulos filtrados pelos bancos exibidos no painel

Antes, os titulos vinham **sem filtro de banco**: o `buscarPagas` (e o
`buscarRecebidas`) chamavam a API só com `data_vencimento_*`,
`data_pagamento_*` e `status` — entao **entravam titulos de qualquer conta
financeira** da empresa, mesmo de bancos que **nao aparecem no painel**. A lista
de bancos permitidos vivia so no frontend (`bancosPorEmpresa`), e so servia para
esconder contas da exibicao — nunca filtrava os titulos.

Agora os titulos sao filtrados **pelo backend**, usando a **mesma lista** de
bancos exibida no painel.

**Fonte unica da verdade:** `src/lib/bancos.ts` (novo), importado pelo frontend
**e** pelo backend:

| Empresa | Bancos exibidos |
|---------|-----------------|
| LGP Transportes | Bradesco, Itau, Sicoob 3049, Sicoob 3109 |
| Rosangela Transportes | Bradesco, Itau, Sicoob 3049, Sicoob 3109 |
| JRM Transportes | Bradesco, Itau, Sicoob 3049, Sicoob 3109 |
| demais (ex.: Juvenal) | Itau, Sicoob, Sicoob 3109, Bradesco (padrao) |

Vocabulario do modulo: `bancosPermitidosDaEmpresa(empresa)`,
`bancoPermitido(nome, permitido)`, `normalizarBanco(nome)`. Lista de bancos
**vazia** = mostrar todos (e nao filtrar titulo nenhum).

**Como o filtro funciona:**

1. `buscarSaldos` passou a devolver o **id** da conta financeira
   (`{ id, nome, saldo }`), que antes era descartado.
2. `extrairContaId(titulo)` acha a conta do titulo em varias estruturas:
   `conta_financeira_id`, `conta_id`, `evento.conta_financeira_id`,
   `evento.conta_id`, `evento.conta.id`, `baixas[0].*`, `parcelas[0].*`.
3. `mapaContaParaBanco(contas)` monta o mapa `conta_id -> nome do banco`.
4. `filtrarPorBancos(titulos, mapa, permitidos)` aplica o filtro.

**Regra (conservadora — nunca perde dinheiro da lista sem querer):**

| Situacao do titulo | Resultado |
|--------------------|-----------|
| Banco conhecido e **permitido** | mantido |
| Banco conhecido e **nao permitido** | **removido** |
| Sem conta financeira | mantido (nao da para saber o banco) |
| Conta que nao esta no mapa | mantido (banco desconhecido) |

**Onde o filtro e aplicado (backend):** em `getDashboard` **e** em
`getEmpresaBreakdown` — assim os **cards** (Entradas Previstas, Saidas
Previstas, Contas Pagas, Contas Recebidas), o **grafico** e as **listas do
rodape** usam exatamente o mesmo conjunto de titulos. O `getEmpresaBreakdown`
passou a chamar `buscarSaldos` (que ja e chamado pelo `getDashboard`, entao
normalmente vem do cache de 2 min).

Um `log("info", ...)` registra quantos titulos foram removidos por empresa.

**Diagnostico:** as rotas `/api/debug-pagas` e `/api/debug-recebidos` passaram a
mostrar `bancos_exibidos`, `contas_financeiras` (id + nome) e, por titulo,
`conta_id` / `banco` / `banco_exibido` — para conferir em producao se a API
devolve o vinculo com o banco e se o filtro esta pegando.

> **Nota:** `BANCOS_PERMITIDOS` (em `contaazul.server.ts`) e `mapaContaBanco`
> (em `contaazul.functions.ts`) eram **codigo morto** — declarados e nunca
> usados. O `mapaContaBanco` ainda nao podia funcionar (os objetos de conta
> nao tinham `id`). Ambos foram removidos/substituidos por este filtro.

---

## 3.10 Correcoes de tipagem e categorias de estorno no PDF

Apos o `pull` do historico remoto (31 commits sobre desconto/juros/multa),
o **HEAD remoto nao compilava** — `npx tsc --noEmit` acusava **14 erros de
TypeScript**. Todos estavam no codigo novo de desconto/juros (nao nos
arquivos do filtro por bancos nem na separacao por empresa do PDF).

**Correcoes aplicadas (commit `b4c3e3e`):**

| Erro | Correcao |
|------|----------|
| `total_desconto_pagas` (e `total_juros_*`, `total_multa_*`, `total_desconto_recebidas`, `total_juros_recebidas`, `total_multa_recebidas`) nao existiam no tipo `DashboardData["resumo"]`, mas eram retornados pelo handler | campos adicionados ao tipo do `resumo` em `contaazul.functions.ts` |
| `log("debug", ...)` — o nivel `"debug"` nao existia em `LogEntry["nivel"]` (aceitava so `"info" \| "warn" \| "error"`) | nivel `"debug"` incluido no tipo e no espelhamento para o console |
| `item.id` nao existia em `ItemLancamento`, mas era usado nos logs de enriquecimento da baixa | campo `id?: string` adicionado ao tipo e preenchido em **Pagas** e **Recebidos** (`id: String(i.id)`) |
| `KpiCard.sub` nao aceitava `null`, mas o card de Contas Recebidas passava `null` quando nao havia desconto/juros/multa | `sub?: string \| null` |

Nenhuma alteracao de **comportamento** — so tipagem e a correcao do regex
abaixo.

**Categorias de estorno no PDF:** o remoto havia escrito o regex
`/estorn(a|ado)\b/i`, que **nao pega "Estorno"** (a categoria mais comum) —
so casava "Estorna" e "Estornado", apesar do comentario dizer
"estorno/estornado". Como **nao existe a categoria "Estorna"**, o regex correto
e:

```ts
/estorn(o|ado)\b/i
```

Casos cobertos: `Estorno`, `estorno`, `ESTORNO`, `Estornado`, `estornado`,
`Estornado Parcial` — e **nao** casa `Estornos`, `Estornamento`, `Vendas`,
`Combustivel`. Como a coluna Categoria foi removida do PDF impresso, a
categoria de estorno continua sendo anexada **a descricao** do titulo
(ex.: `Titulo (Estorno)`).

---

## 3.11 "Contas Pagas" errado no carregamento automatico (paginacao incompleta)

**Sintoma:** o card **Contas Pagas** mostrava um valor MENOR quando o sistema
recarregava sozinho (R$ 25.743,05) e o valor certo quando o usuario clicava em
**Recarregar** (R$ 168.991,59) — duas cargas com 11 segundos de diferenca.

**Causa:** a paginacao de `buscarPagas` / `buscarRecebidas` tratava a falha de
**uma pagina** como "acabaram os dados":

```ts
if (!res.ok) { log("warn", ...); break; }   // parava aqui e mantinha o ja lido
...
return { dados: enriquecidos, ok: true };   // <- mesmo com a paginação pela metade
```

Quando a API derrubava uma pagina no meio do **rate limit** (o proprio codigo de
saldos ja lida com o erro 3039), a busca parava no meio, devolvia so os itens ja
lidos com `ok: true` — e **isso era cacheado por 2 minutos** (`listCache`). O
card exibia entao um total parcial **sem nenhum aviso de erro**. O botao
**Recarregar** chama `limparCache`, que apaga o `listCache`, e a refetch completa
trazia o total certo. Daí a diferença entre as duas imagens.

**Correcoes, em 3 camadas:**

1. **Paginacao que reinicia.** `fetchPaginaRobusta()` (novo) busca cada pagina
   com retries, backoff, respeito ao `retry-after` e renovacao de token, e
   distingue erro **transitorio** (429/5xx/rede) de erro **definitivo** (4xx
   fora de 401/429 — ex.: um status que a conta nao aceita, que nao adianta
   repetir). Falha transitória no meio da lista => a paginacao **recomeca do
   zero** (`MAX_PASSES_PAGINACAO = 2`, com pausa de 1,5 s e respiro de 150 ms
   entre paginas). Falha definitiva => pula direto para o proximo
   status/endpoint. Os limites ficaram baixos de proposito: o pior caso de uma
   pagina fica em ~9 s, para nao estourar o tempo da funcao na Vercel.
2. **Resultado parcial nunca vira total final.** Novo tipo `ResultadoLista`
   (`{ dados, ok, incompleto? }`): so um resultado **completo** entra no cache
   (`manter: (x) => x.ok`). O parcial volta com `ok: false` e `incompleto: true`
   — mantendo o melhor trecho lido, para o card nao sumir.
3. **A tela se corrige sozinha.** `getDashboard` passou a devolver
   `dados_incompletos` (mais o aviso "nova tentativa automatica") e o painel
   refaz a consulta em background com espera crescente (3 s, 6 s, 9 s; maximo de
   3 tentativas por sequencia) — quando o limite da API ja passou. Assim o
   carregamento automatico termina com o valor correto **sem** exigir o clique em
   Recarregar.

**Pagos/Recebidos continuam sem acender a bolinha vermelha de sincronizacao**
(cards complementares; o token ruim ja e detectado por A Receber / A Pagar). O
sinal novo e o aviso na caixinha de alertas + a refetch automatica.

**Testes** — API falsa (stub de `global.fetch` com Supabase e Conta Azul
simulados), 19 assercoes, todos passando:

| Cenario | Comportamento verificado |
|---------|--------------------------|
| 429 na pagina 2 e recuperacao | termina **COMPLETO**: 125 titulos, total 12.500 (pagina 2 tentada 5x) |
| falha persistente na pagina 2 | `ok=false`, `incompleto=true`, parcial de 100 mantido e **nao cacheado**; a refetch seguinte traz os 125 titulos e o total 12.500 |
| 400 no status ACQUITTED | erro definitivo **cai no PAGO** sem marcar incompleto (10 titulos) |

---

## 3.12 Valor do titulo pago sem o desconto (RESOLVIDO em 04/11/2026 — veja a secao 3.13)

**Sintoma (print do usuario):** no card **PAGOS** de 30/10 (empresa "todas",
total R$ 168.991,59) os titulos aparecem pelo valor cheio, sem o desconto
registrado na Conta Azul. Exemplos do print: **R$ 960,00** (empresa
Juvenal Transportes) e **R$ 1.127,69** (descricao "1/3 - Compra de produto 1922
(NFe 257866-110)", fornecedor CIA BRASILEIRA DIST AUTO S.A).

**O que ja foi verificado na API real (producao):**

1. A listagem de contas pagas (`GET /v1/financeiro/contas-a-pagar?status=ACQUITTED`)
   e a listagem de eventos
   (`GET /v1/financeiro/eventos-financeiros/contas-a-pagar/buscar`) devolvem
   **apenas** estes campos por titulo:

   ```
   id, descricao, data_vencimento, status, status_traduzido,
   total, nao_pago, pago, data_criacao, data_alteracao,
   data_competencia, categorias, centros_de_custo, fornecedor
   ```

   Nao vem `desconto`, `valor_pago`, `baixas`, `parcelas` nem
   `conta_financeira_id`. A listagem de **contas a receber** (`contas-a-receber` /
   `eventos-financeiros/contas-a-receber/buscar`) e igual: `parcelas` e `baixas`
   vem sempre `null`.

2. Consequencia no codigo: `enriquecerPagasComValorLiquido()` filtra os titulos
   por `baixa_id`/`parcela_id` — campos que a listagem nunca devolve — logo a
   lista de "pendentes" fica **vazia** e a funcao **nunca roda**. Por isso
   `total_desconto_pagas` e **sempre 0** no resumo e o subtitulo
   "Desc R$ ... / Juros ..." nunca aparece no card.

3. O unico lugar onde o desconto vive e a **baixa**. O endpoint
   `GET /v1/financeiro/eventos-financeiros/parcelas/{parcela_id}/baixa` responde
   **200** (mesmo para um id inexistente) devolvendo um **array** de baixas.
   O helper `buscarBaixaPorParcela()` nao desembrulha esse array: ele le
   `item.valor_composicao` do array (que nao existe), e por isso devolve sempre
   `desconto/juros/multa/valor_bruto` = `undefined` e `ok: true` — tanto para um
   titulo real quanto para um id garbage.

4. O `id` da listagem **e** o `parcela_id` (o proprio endpoint de baixa
   responde 200 para ele). A correcao, portanto, passa por:
   (a) usar o `id` da listagem como `parcela_id`;
   (b) desembrulhar o array de baixas;
   (c) recalcular o valor como `valor_bruto - desconto + juros + multa`.

**Rota de diagnostico criada (commit `6453fea`):**
`GET /api/debug-baixas?empresa=NOME&inicio=YYYY-MM-DD&fim=YYYY-MM-DD&limite=N&ids=id1,id2`

Ela lista os titulos pagos do periodo, **prioriza os que tem `pago != total`**
(onde ha ajuste da propria API) e devolve, para cada um, o JSON cru da
**baixa** (`/parcelas/{id}/baixa`) e da **parcela** (`/parcelas/{id}`), com os
numeros de desconto/juros/multa/valor_bruto/valor_pago extraidos de qualquer
nivel. Tambem testa se existe algum endpoint que devolva **todas as baixas do
periodo em uma chamada** (candidatos em `/v1/financeiro/baixas`,
`/v1/financeiro/eventos-financeiros/baixas`, etc.).

**Situacao:** **RESOLVIDO** em 04/11/2026 (commit `9c6228e`, secao 3.13). A rota
de diagnostico, rodada em producao depois do redeploy, mostrou que na listagem
de contas pagas o campo `pago` e o valor **bruto** da baixa
(`valor_composicao.valor_bruto`) e o campo `total` e o valor **liquido**
(`valor_composicao.valor_liquido` = bruto - desconto + juros + multa). O codigo
usava o `pago` — por isso o titulo aparecia **sem** o desconto. A correcao nao
precisa de nenhuma chamada extra a API: basta usar o `total`.

---
| recebidos com 429 no meio | termina **COMPLETO**: 110 titulos, total 11.000 |

---

## 3.13 Titulo pago com o desconto aplicado + paginacao em paralelo (04/11/2026)

**Commit do fix:** `9c6228e` — `fix: titulos pagos/recebidos exibem o valor liquido (com desconto) e as paginas da listagem sao buscadas em paralelo`

### O que o diagnostico mostrou (producao)

A rota `/api/debug-baixas` (rodada em producao) comparou 16 titulos pagos reais
com a baixa correspondente. Resultado: **16/16** confirmaram a mesma regra.

| Campo da listagem | Significado | Exemplo (1/3 - Compra de produto 1922) |
|-------------------|-------------|----------------------------------------|
| `pago`  | `valor_composicao.valor_bruto` (cheio, **sem** desconto) | R$ 1.127,69 |
| `total` | `valor_composicao.valor_liquido` (bruto - desconto + juros + multa) | R$ 1.127,66 |

Outros exemplos: "CAPITAL DE GIRO - 21/48" -> bruto 72.430,28 / liquido 65.738,42
(desconto de R$ 6.691,86); "1/366 - ALUGUEL SALA SANTA CATARINA" -> bruto 299,00
/ liquido 305,67 (juros de R$ 6,67).

O codigo exibia o `pago` — por isso o titulo aparecia **sem** o desconto.

### O que mudou (`src/lib/contaazul.server.ts`)

1. **Valor do titulo = `total` (liquido)** em `processarPagasResposta()` e em
   `processarRecebidas()`. Sem nenhuma chamada extra a API (a listagem ja traz
   o liquido). Pagamento parcial (`nao_pago > 0`) continua usando o valor pago.
2. **Rotulo Desc/Juros pela diferenca**: `bruto - liquido` > 0 e desconto;
   < 0 e juros/multa. O titulo passa a mostrar "Desc R$ ..." no rodape da tela e
   o card mostra o total ("Desc R$ ... · Juros R$ ...").
3. **Sem log por titulo**: a busca gravava 1 insert no Supabase por titulo com
   desconto/juros (centenas de titulos = centenas de inserts). Agora grava
   **1 log resumo** por listagem.
4. **Paginacao em paralelo**: novo helper `listarTodasPaginas()` usa o
   `itens_totais` da 1a pagina e busca as demais **3 por vez**
   (`buscarPagasInterna`, `buscarRecebidasInterna` e `buscarV2Interna`).
   Antes eram uma a uma, com 150 ms de espera entre elas.
5. **`buscarBaixaPorParcela()` desembrulha o array** devolvido por
   `/parcelas/{parcela_id}/baixa` (antes o `valor_composicao` nunca era lido).

### Testes executados

`npx tsc --noEmit` e `npm run build` sem erro; teste com API falsa usando os
valores reais de 30/10/2026, cobrindo: titulo com desconto de R$ 0,03 (valor
1.127,66), titulo com juros (valor 305,67), capital de giro (valor 65.738,42),
pagamento parcial (usa o valor pago), paginacao com 350 itens (4 paginas,
concorrencia 3, 4 chamadas) e a cauda adaptativa quando a API nao informa
`itens_totais`.

### Como conferir no painel

1. **Redeploy** na Vercel (o deploy e manual).
2. Recarregar o dashboard em 30/10/2026, empresa "todas".
3. O titulo "1/3 - Compra de produto 1922 (NFe 257866-110)" (LGP Transportes)
   deve aparecer como **R$ 1.127,66** (antes R$ 1.127,69), com o rotulo
   "Desc R$ 0,03".
4. O card PAGOS passa a somar os valores liquidos (menor que antes, porque o
   desconto sai da conta) e o subtitulo passa a mostrar o total do desconto.
5. O carregamento deve ficar mais rapido: as paginas da listagem sao buscadas
   em paralelo (3 por vez) em vez de uma a uma.

### Ajuste pedido pelo usuario (commit `1a398a2`)

O usuario pediu para **tirar** a linha "Desc R$ ... · Juros R$ ... · Multa R$ ..."
que aparecia abaixo dos cards **Contas Pagas** e **Contas Recebidas** (e o
rotulo "Desc R$ ..." no rodape das listas de titulos). O desconto continua
aplicado **no valor** do titulo — so o rotulo extra foi removido, para o painel
ficar limpo.

Arquivo alterado: `src/routes/index.tsx` (remocao do `sub` dos dois cards e do
rotulo por titulo no rodape). Os dados `total_desconto_pagas` / `total_juros_*`
continuam sendo calculados e devolvidos pela API (apenas nao sao exibidos).

### Como reverter (sem reescrever o historico ja publicado)

```bash
git revert --no-edit 9c6228e
git push origin main
```

## 3.14 Data real do pagamento + recuperacao dos recebimentos + PDF compacto (04/11/2026)

**Commit do fix:** `9defc7a` — `fix: listas de Pagos/Recebidos usam a data real do pagamento (baixa da parcela), recupera titulos recebidos descartados pelo vencimento e deixa o PDF mais compacto`

### O que o diagnostico mostrou (producao)

O print do usuario (JRM Transportes, novembro de 2026) mostrava a linha
"25/10 - 1/366 - ALUGUEL COMPUTADOR" na lista de **Pagos**: era o
**VENCIMENTO** do titulo, e nao a data em que o dinheiro saiu do banco.

A listagem da Conta Azul (`/v1/financeiro/contas-a-pagar` e
`/v1/financeiro/contas-a-receber`) so devolve `data_vencimento`. A data real
do caixa esta na **baixa da parcela**:

```
GET /v1/financeiro/eventos-financeiros/parcelas/{parcela_id}/baixa
```

Testado em producao: o `id` devolvido pela listagem **e o id da parcela** e a
baixa responde `data_pagamento` + `valor_composicao` (valor_bruto /
desconto / juros / multa / valor_liquido). Exemplo real (LGP, "CRÉD.TED-STR"):
`data_pagamento` = 2026-10-30, valor bruto R$ 1.776,20.

Nao existe endpoint em lote de baixas (todas as variantes testadas responderam
404/400), por isso o enriquecimento e feito **por titulo**, com cache de 30
minutos (`BAIXA_TTL_MS`) e 16 requisicoes em paralelo
(`CONCORRENCIA_BAIXAS`). Se a baixa nao responder, o titulo mantem o valor e a
data da listagem — nada se perde.

### A causa do total menor (titulos recebidos que sumiam)

O filtro de recebidos descartava o titulo quando o **vencimento** estava fora
do periodo — mas o dinheiro pode ter entrado dentro do mes. Comparacao
API x painel (periodo de 2026):

| Empresa / periodo | API | Painel (antes) | Titulos perdidos |
|-------------------|-----|----------------|------------------|
| LGP Transportes - jul/2026 | 97 | 96 | 1 |
| LGP Transportes - ago/2026 | 106 | 105 | 1 |
| LGP Transportes - set/2026 | 142 | 142 | 0 |
| Juvenal Transportes - out/2026 | 234 | 218 | 16 |

Exemplo: "FAT. 1666" (Juvenal) venceu em 29/07/2026 e foi recebido em
13/10/2026 — o vencimento de julho jogava o dinheiro de outubro para fora do
painel.

### O que mudou (`src/lib/contaazul.server.ts`)

1. **`extrairDadosBaixa()`** (exportado, funcao pura): le o array de baixas e
   devolve `data_pagamento`, `desconto`, `juros`, `multa`, `valor_bruto`,
   `valor_liquido` e `valor_pago`. Com mais de uma baixa, a data exibida e a
   da ultima baixa dentro do periodo.
2. **`buscarBaixaDaParcela()`**: chama `/parcelas/{id}/baixa` com retry,
   renova o token em 401 e guarda o resultado no `baixaCache` (30 min; 1 min
   quando a chamada falha).
3. **`enriquecerComBaixas()`** (exportado): aplica a baixa em todos os
   titulos (16 em paralelo) — grava `data` = `data_pagamento` e substitui o
   valor pelo **liquido** (`VALOR_PAGAS` e `VALOR_RECEBIDAS` = `"liquido"`,
   confirmado pelo usuario: liquido tanto em Pagos quanto em Recebidos).
4. **Recebidos nao descartam pelo vencimento**: o titulo so sai da lista quando
   a propria API traz a data REAL de recebimento fora do periodo.
5. O codigo morto `enriquecerPagasComValorLiquido()` foi removido (as duas
   chamadas foram trocadas por `enriquecerComBaixas()`).

### O que mudou (`src/lib/exportar.ts`) — menos folhas para imprimir

| Antes | Agora |
|-------|-------|
| Margem de 14 mm e colunas com `maxWidth` somando ~164 mm numa pagina de 297 mm | Margem de 10 mm e larguras FIXAS somando a largura util (277 mm) |
| Fonte 8 pt, `cellPadding` 2 mm | Fonte 7,2 pt, `cellPadding` 0,9 mm e entrelinha 1,08 (`doc.setLineHeightFactor`) |
| Cada secao (Recebidos, Pagos) comecava numa PAGINA NOVA | As secoes **fluem** na mesma folha (so abrem pagina nova quando nao cabe) |
| Margem da tabela 30/16 mm | 12/12 mm |

Medicao (120 titulos, A4 paisagem): descricoes longas **9 -> 5 folhas**,
descricoes curtas **6 -> 4 folhas**. O PDF continua com Faturamento, Recebidos
e Pagos (e o XLSX completo, com "Resultado (A Receber - A Pagar)").

### Testes executados

- `npx tsc --noEmit` e `npm run build` sem erro.
- Teste com API falsa: **18/18 PASS** — a data real substitui o vencimento, o
  titulo recebido com vencimento fora do periodo NAO e descartado, face/liquido
  em pagas e recebidas, baixa ausente mantem valor e data, agregacao de 2
  baixas.
- Benchmark de folhas do PDF (config antiga x config nova): 9 -> 5 e 6 -> 4.

### Como conferir no painel

1. **Redeploy** na Vercel (o deploy e manual).
2. Recarregar o dashboard em novembro/2026, empresa "todas".
3. A linha "1/366 - ALUGUEL COMPUTADOR" (JRM Transportes) deve aparecer com a
   **data do pagamento** (e nao 25/10).
4. Os totais de **Recebidos** devem subir: LGP jul/2026 (96 -> 97 titulos),
   LGP ago/2026 (105 -> 106) e Juvenal out/2026 (218 -> 234).
5. O PDF deve sair com menos folhas e com as datas do pagamento.
6. Conferir o tempo de carga: cada titulo faz 1 chamada de baixa (cache de 30
   min). O log `enriquecerComBaixas <empresa>: N/M titulos com baixa ... em Xs`
   mostra o tempo de cada listagem.

### Ajuste pedido pelo usuario — fontes maiores no PDF (commit `7825474`)

O usuario pediu para **aumentar as fontes** do PDF impresso (mantendo o
**rodape em 8 pt**, como pedido). Tamanhos finais (fonte Helvetica do jsPDF):

| Elemento | Antes | Agora |
|----------|-------|-------|
| Titulo "Fluxo de Caixa" | 15 pt | **16 pt** (bold) |
| Periodo / Empresa | 9 pt | **10 pt** |
| Card do topo — rotulo | 7,5 pt | **8,5 pt** |
| Card do topo — valor | 11,5 pt | **13 pt** (encolhe ate 8 pt se nao couber) |
| Faixa de secao (Faturamento / Recebidos / Pagos) | 11 pt | **12 pt** |
| Faixa de empresa (relatorio "Todas") — nome | 12 pt | **13 pt** |
| Faixa de empresa — resumo | 8 pt | **9 pt** |
| Tabelas (autoTable) — cabecalho e corpo | 7,2 pt | **8,5 pt** (`cellPadding` 0,9 -> 1 mm) |
| Rodape (paginação) | 8 pt | **8 pt (mantido)** |

O card do topo tambem ficou um pouco mais alto (15 -> 16 mm) para caber a
fonte maior do rotulo e do valor.

Medicao (120 titulos, A4 paisagem): descricoes longas **4 -> 5 folhas** e
descricoes curtas **4 -> 4 folhas** (antes da otimizacao de layout eram 9 e 6).

### Como reverter (sem reescrever o historico ja publicado)

```bash
# reverter a correcao da data real + PDF compacto
git revert --no-edit 9defc7a
git push origin main

# reverter apenas o aumento das fontes
git revert --no-edit 7825474
git push origin main
```

## 3.15 Listas de titulos do painel mais legiveis (05/11/2026)

**Commit:** `a1c0d56` — `feat: deixa as listas de titulos do painel legiveis (descricao ocupa a largura da coluna em 2 linhas)`

### O problema

Nas listas do rodape do painel ("A Receber, A Pagar, Pagos e Recebidos"), cada
titulo era uma linha horizontal com **data + descricao + empresa + valor** lado a
lado. Com 4 colunas na tela, sobrava poucos pixels para a descricao e ela
aparecia espremida ("1/3...", "Rosangela Transpor..."), sem dar para ler o que
era o titulo.

### O que mudou (`src/routes/index.tsx`, componente `TitulosLista`)

1. A linha virou **duas linhas**: a primeira traz data + etiqueta da empresa +
   etiqueta de Boleto + valor; a **segunda traz a descricao com a largura
   inteira da coluna** (`line-clamp-2`, 13 px), com o texto completo no
   `title` (tooltip do navegador).
2. O terceiro (cliente/fornecedor) continua em uma linha menor e apagada
   abaixo da descricao.
3. A grade do bloco passou de `lg:grid-cols-4` para `md:grid-cols-2
   2xl:grid-cols-4`: em telas medias as listas ficam com o **dobro de largura**
   (2 colunas) e as 4 colunas so aparecem em telas muito largas (2xl).
4. A altura da rolagem das listas subiu de 280 px para 320 px.

### Como reverter (sem reescrever o historico ja publicado)

```bash
git revert --no-edit a1c0d56
git push origin main
```

## 3.16 Cache das baixas + velocidade de carga (05/11/2026)

**Commit:** `0904139` — `feat: cache persistente das baixas no Supabase (tabela baixas_cache) + TTL de 12h e 32 chamadas em paralelo`

### O problema

Para exibir a **data real do pagamento**, cada titulo precisa da baixa da
parcela (1 chamada a API). Em um mes grande isso sao muitas chamadas:

| Periodo | Chamadas de baixa | Tempo (antes) |
|---------|-------------------|---------------|
| Todas - nov/2026 | 148 | 15 s |
| LGP - jul/2026 | 978 | 128 s |
| Juvenal - out/2026 | 1.292 | 148 s |

Cada chamada leva ~2,1 s (16 em paralelo). O cache era **so em memoria** (por
instancia da Vercel): a cada cold start tudo era refeito, e as instancias nao
compartilhavam o resultado.

### O que mudou

1. **Cache persistente no Supabase** — nova tabela `public.baixas_cache`
   (migration `supabase/migrations/20261105000001_baixas_cache.sql`, ja
   aplicada no banco):
   - `empresa` + `parcela_id` (chave primaria), `baixa` (JSONB com as
     baixas CRUAS), `atualizado_em`;
   - guarda o array **cru** (e nao o resultado filtrado pelo periodo), para o
     mesmo cache servir a qualquer intervalo consultado;
   - policy "Allow all" igual a da tabela `tokens`.
2. **Cache em memoria de 30 min para 12 h** — a baixa e imutavel depois de
   lancada. O cache de "nao encontrado" continua em 1 min.
3. **Concorrencia de 16 para 32** — o retry com backoff ja existente trata 429.
4. **Três camadas** no `enriquecerComBaixas()`: memoria (12 h) -> Supabase ->
   API. As baixas novas vao para o banco em lote (upsert de 200 em 200).
5. **Robustez**: se a tabela nao existir, o Supabase estiver fora do ar ou o
   app nao tiver credencial, o enrichment volta a funcionar so com a API (o
   erro e registrado e as tentativas param por 30 min).

### Resultado esperado

| Periodo | 1a carga (cache vazio) | Cargas seguintes |
|---------|-----------------------|------------------|
| LGP - jul/2026 | ~128 s (popula o cache) | ~2-5 s |
| Juvenal - out/2026 | ~148 s (popula o cache) | ~2-5 s |

O log `enriquecerComBaixas <empresa>: ... | cache memoria X, cache banco Y,
API Z | Xs` mostra de onde veio cada baixa.

### Como reverter (sem reescrever o historico ja publicado)

```bash
git revert --no-edit 0904139
git push origin main
```

A tabela `public.baixas_cache` pode ficar no banco (sem uso, ocupa pouco
espaco) ou ser removida com `DROP TABLE public.baixas_cache;`.

## 3.17 Banco/conta financeira no PDF e no XLSX (05/11/2026)

**Commit:** `230a293` — `feat: mostra o banco/conta financeira do titulo no PDF e no XLSX (Recebidos e Pagos)`

### O pedido

O banco (conta financeira) de cada titulo tinha que sair no PDF, tanto em
**Recebidos** quanto em **Pagos**.

### De onde vem o banco

A listagem da Conta Azul (contas a pagar/receber) **nao traz** o banco do
titulo: o campo `conta_id` vem vazio nessa listagem. Quem traz e a **baixa da
parcela** — o mesmo objeto que ja era consultado para trazer a data real do
pagamento:

```json
{
  "data_pagamento": "2026-10-30",
  "valor_composicao": { "valor_bruto": 1127.69, "desconto": 0.03, "valor_liquido": 1127.66 },
  "conta_financeira": { "id": "01a0f79f-...", "banco": "SICOOB", "nome": "Sicoob 3109" }
}
```

Como as baixas ja eram buscadas para todos os titulos de Pagos/Recebidos, o
banco veio **de graca** (nenhuma chamada extra a API).

**Prioridade:** banco da baixa (a conta realmente usada no pagamento) > banco
do `conta_id` da listagem (via mapa de contas) > vazio (`—` no relatorio).
O `aplicarBancoAosTitulos()` so preenche o banco quando ele ainda esta vazio,
e o `item.conta_id` **nao** foi alterado — assim o filtro de bancos do painel
continua exatamente igual.

### O que mudou no relatorio

| Arquivo | Mudanca |
|---------|---------|
| `src/lib/contaazul.server.ts` | `ItemLancamento.banco`; `compactarBaixa()` guarda `conta_financeira` (id/nome/banco); `extrairDadosBaixa()` extrai o banco; `enriquecerComBaixas()` aplica o banco no titulo; `aplicarBancoAosTitulos()` (fallback pelo mapa de contas) |
| `src/lib/contaazul.functions.ts` | `TituloDetalhe.banco`; o banco entra no `getDashboard` e no `getEmpresaBreakdown` (base do PDF/XLSX) |
| `src/lib/exportar.ts` | coluna **Banco** no PDF (entre Terceiro e Metodo) e no XLSX (entre Terceiro e Categoria) |

### Cache das baixas: versao 2

O formato guardado no cache (Supabase e memoria) mudou: agora ele tambem
guarda a `conta_financeira`. O `BAIXA_CACHE_VERSAO` foi para **2**, e as
linhas antigas do banco (sem o campo `v`) sao **ignoradas** — as baixas sao
buscadas de novo na API e regravidas no formato novo. Isso vale para a 1a
carga depois do deploy (a mais lenta, que repovoa o cache).

### Larguras das colunas no PDF

A coluna nova eats some espaco da descricao, entao as larguras foram
reajustadas (a soma continua = largura util da pagina, 277 mm):

| Coluna | Com Metodo | Sem Metodo |
|--------|-----------|------------|
| Data | 18 mm | 18 mm |
| Descricao | 95 mm | 111 mm |
| Fornecedor/Cliente | 80 mm | 88 mm |
| **Banco** | **28 mm** | **28 mm** |
| Metodo | 24 mm | — |
| Valor (R$) | 32 mm | 32 mm |

O nome do fornecedor/cliente continua cabendo em 1 linha (80/88 mm) e o banco
(`Sicoob 3109`, `Bradesco`, `Itaú`) cabe em 28 mm.

### Impacto nas folhas (teste com 120 titulos de descricao longa)

| Layout | Com Metodo | Sem Metodo |
|--------|-----------|------------|
| Antes (sem a coluna Banco) | 6 | 5 |
| Depois (com a coluna Banco) | 7 | 6 |

A coluna nova custa **1 folha** nesse teste de stress (120 titulos com
descricoes longas em uma unica tabela). Nos relatorios reais (dezenas de
titulos) o efeito e menor. Nao ha como mostrar uma coluna a mais sem custar
espaco: as larguras foram otimizadas (testadas 5 combinacoes — o resultado de
folhas foi o mesmo em todas).

### Testes

- `test-baixa.mts`: **19 verificacoes OK**, incluindo "banco vem da baixa"
  (`Sicoob 3109`) e "titulo sem banco fica vazio".
- PDF gerado com a funcao de producao e lido com `pdfjs`: a coluna Banco
  aparece com os valores (`Sicoob 3109`, `Itaú`, `Bradesco`, `—`).
- XLSX gerado com a funcao de producao e relido: cabecalho
  `Data | Descricao | Fornecedor | Banco | Categoria | Empresa | Metodo | Valor (R$)`.

### Como reverter (sem reescrever o historico ja publicado)

```bash
git revert --no-edit 230a293
git push origin main
```

### Detalhe: exportacao logo depois de um deploy

As libs do PDF/XLSX (`jspdf`, `jspdf-autotable`, `xlsx-js-style`) sao
carregadas **sob demanda** (import dinamico), entao ficam em arquivos separados
do bundle. A Vercel apaga os arquivos do deploy anterior: uma aba do painel
que ficou aberta ANTES do deploy e que clica em "PDF" tenta baixar um arquivo
que nao existe mais (404) e a exportacao falha com
`Failed to fetch dynamically imported module`.

Nao quebra nada: basta atualizar a pagina (F5). A mensagem de erro agora diz
isso de forma explicita ("Atualize a pagina (Ctrl+F5) e tente novamente").

## 3.18 Data errada (vencimento) e banco vazio — limite de 10 req/s da API (05/11/2026)

**Commit:** `fix: respeita o limite de 10 requisicoes por segundo da API da Conta Azul nas baixas`

### O relato

No painel da **Juvenal Transportes** (nov/2026) apareciam titulos com a data de
**VENCIMENTO** em vez da data do **pagamento/recebimento**, e varios titulos
sem **banco** (a coluna `—` no PDF). Exemplo: `CTE - 37535` (venc. 29/10)
mostrava 29/10 e nenhum banco.

### Causa raiz

A listagem de contas a pagar/receber da Conta Azul **nao traz** a data do
pagamento nem o banco — so o vencimento. Quem traz os dois e a **baixa da
parcela** (`GET /v1/financeiro/eventos-financeiros/parcelas/{id}/baixa`), que
era consultada para **cada** titulo.

O problema era o **limite de taxa da API**: a Conta Azul aceita **10 requisicoes
por segundo por conta conectada**:

> "Limite de requisicoes excedido: ate 10 por segundo por conta conectada"

As chamadas de baixa eram disparadas com **32 em paralelo**. O que passava do
limite voltava **429**, o titulo ficava **sem baixa** e o relatorio mantinha a
data do vencimento com o banco vazio. Confirmado em producao: sondando 120
titulos, **41 voltaram 429** e **nenhum** voltou 404 — o dado existia, so nao
chegava. (`CTE - 37535` tem baixa em **04/11/2026**, **Sicoob 3109**.)

Nao existe endpoint **em lote** de baixas (testados 10 candidatos: 404/400) e
nenhuma listagem traz `baixas`/`parcelas`/`conta_id` — a chamada
individualizada e obrigatoria.

### O que mudou

| Item | Antes | Agora |
|------|-------|-------|
| Chamadas de baixa | 32 em paralelo (429) | fila por tempo, **9 req/s** (folga sobre o limite de 10) |
| Intervalo entre chamadas | — | 111 ms, dobra ate 3 s se a API responder 429, volta a 111 ms depois de uma sequencia de acertos |
| Chamadas em voo | 32 | 24 (cada chamada leva ~2 s: 24 em voo sustentam 9 req/s) |
| Erro 429 / 5xx / rede | virava "titulo sem baixa" (cacheado) | **nao** e cacheado: a proxima carga tenta de novo |
| Orcamento de tempo | nenhum | **42 s** (`JRM_PRAZO_BAIXAS_MS`) — o que sobrou fica para a proxima carga |
| Lista no cache (2 min) | cacheada mesmo com baixas faltando | **nao** cacheada enquanto faltarem baixas (o cache do Supabase guarda o que ja foi buscado, entao cada carga avanca) |

Alem do limitador, a busca passou a devolver tres contadores:

- `sem_baixa` — falha **transitoria** (429/5xx/rede): a proxima carga tenta de novo;
- `sem_baixa_definitivo` — o titulo **nao tem baixa** na API (nao adianta repetir);
- `baixas_pendentes` — nem chegou a ser consultado (o orcamento de 42 s acabou).

### Painel

- `getDashboard` devolve `baixas_pendentes` (empresas com baixa faltando) e
  um aviso por empresa ("N titulo(s) sem a baixa — a data exibida pode ser o
  vencimento e o banco fica vazio").
- O front **refaz a consulta sozinho** (ate 6 rodadas, espera 4 s x rodada)
  enquanto houver baixas pendentes — como o cache guarda o que ja foi buscado,
  cada rodada avanca e a tela termina com a data real e o banco.
- Titulo **sem baixa na API** (definitivo) gera aviso separado e **nao** entra
  no refetch (repetir nao mudaria nada).

### Arquivos

| Arquivo | Mudanca |
|---------|---------|
| `src/lib/contaazul.server.ts` | limitador de taxa (`esperarVagaBaixa`, `baixaRecebeu429`, `baixaDeuCerto`); `buscarBaixaDaParcela` com 4 tentativas e status `ok/vazio/falha`; `enriquecerComBaixas` devolve `{ dados, semBaixa, semBaixaDefinitivo, pendentes }`; `ResultadoLista` com `sem_baixa`, `sem_baixa_definitivo`, `baixas_pendentes`; listas incompletas nao ficam no cache de 2 min |
| `src/lib/contaazul.functions.ts` | `DashboardData.baixas_pendentes`; avisos por empresa (transitorio x definitivo) |
| `src/routes/index.tsx` | refetch automatico das Baixas pendentes (ate 6 rodadas) |

### Variaveis de ambiente (opcionais)

| Variavel | Padrao | Para que serve |
|----------|--------|----------------|
| `JRM_BAIXAS_POR_SEGUNDO` | `9` | chamadas de baixa por segundo (maximo seguro: 9) |
| `JRM_PRAZO_BAIXAS_MS` | `42000` | orcamento de tempo da busca de baixas por carga (limite da funcao: 60 s) |

### Como reverter (sem reescrever o historico ja publicado)

```bash
git revert --no-edit <hash_do_commit>
git push origin main
```

## 3.19 Exportacao bloqueada enquanto as baixas nao chegam (05/11/2026)

**Commit:** `fix: bloqueia a exportacao enquanto a API ainda nao devolveu as baixas dos titulos`

### O que acontecia

Logo depois de um deploy (ou depois de clicar em **Recarregar**, que limpa o
cache do servidor) a busca das baixas leva alguns segundos — a API da Conta Azul
limita 10 requisicoes por segundo e a funcao da Vercel tem 60 s de limite. Nesse
intervalo o painel ainda mostrava os titulos, mas o **PDF/XLSX saiam com titulos
a menos** (27 de 36 recebidas e 90 de 93 pagos, no caso da Juvenal).

O motivo: o filtro de bancos do painel remove o titulo que **ainda nao tem
banco** (o banco vem da baixa). Enquanto a baixa nao chegou, o titulo fica de
fora do relatorio.

### O que mudou

| Item | Antes | Agora |
|------|-------|-------|
| Banner | (nenhum) | aviso amarelo "Consultando a data real do pagamento e o banco dos titulos" |
| Botoes PDF/XLSX | sempre liberados | **bloqueados** enquanto faltam baixas (ate 6 rodadas de refetch automatico) |
| Contador de rodadas | `useRef` (a tela nao sabia se ainda completava) | `useState` |
| Banner de avisos | "Falha na sincronizacao com a Conta Azul" | "Aviso da sincronizacao com a Conta Azul" (o caso do limite da API nao e falha) |

Depois de 6 rodadas o botao volta a ficar liberado (o aviso do servidor continua
na tela) — assim uma falha pontual da API nunca deixa o painel sem exportacao.

### Arquivos

| Arquivo | Mudanca |
|---------|---------|
| `src/routes/index.tsx` | `MAX_RODADAS_BAIXAS`, `rodadasBaixas` (state), `completandoBaixas`, banner de aviso e bloqueio dos botoes PDF/XLSX |

### Como reverter (sem reescrever o historico ja publicado)

```bash
git revert --no-edit <hash_do_commit>
git push origin main
```

## 3.20 Linha de TOTAL mesclada no PDF e no XLSX (06/11/2026)

**Commit:** `fix: mescla as celulas da linha de TOTAL no PDF e no XLSX`

### O que era

Nas tabelas exportadas (PDF e XLSX) a linha de TOTAL ocupava uma celula por
coluna: a celula "Data" ficava vazia, o rotulo "TOTAL" aparecia na coluna
"Descricao" e o valor na ultima coluna. O resultado era uma linha com varias
caixas vazias e o rotulo "TOTAL" no meio da tabela, longe do valor.

### O que mudou

| Item | Antes | Agora |
|------|-------|-------|
| PDF - Faturamento | Data vazia + "TOTAL" na coluna Cliente | Data + Cliente mescladas (rotulo "TOTAL") e valor na propria celula |
| PDF - Recebidos/Pagos | Data/Descricao/Fornecedor/Cliente/Banco/Metodo vazias + "TOTAL" na coluna Descricao | todas as colunas antes do VALOR mescladas em uma celula so (rotulo "TOTAL") e o valor na propria celula |
| XLSX - todas as abas | rotulo "TOTAL" na coluna B | rotulo "TOTAL" na coluna A, com as colunas ate o VALOR mescladas (`!merges`) |

Vale para **todas** as linhas de TOTAL: Faturamento, A Receber, A Pagar, Pagos e
Recebidos. O VALOR nunca entra no merge - continua na ultima coluna, no seu
formato de moeda.

### Como foi feito

- **PDF**: o `jspdf-autotable` (5.0.9) aplica os `colSpan` depois dos hooks,
  por isso o merge e feito no hook `didParseCell`: a celula da coluna 0 recebe
  o rotulo "TOTAL" e `colSpan` = (numero de colunas - 1). As celulas
  intermediarias sao apagadas, entao a linha de TOTAL sai sem as linhas
  verticais internas (uma celula larga + a celula do valor).
- **XLSX**: o rotulo vai para a coluna A, as celulas cobertas pelo merge ficam
  vazias (so o estilo, como o proprio Excel grava) e a area e registrada em
  `ws["!merges"]` (da coluna A ate a penultima coluna da linha do total).

### Arquivos

| Arquivo | Mudanca |
|---------|---------|
| `src/lib/exportar.ts` | `mesclarLinhaTotal` (PDF) e os merges da linha de TOTAL em `montarTabelaXlsx` (XLSX) |

### Como reverter (sem reescrever o historico ja publicado)

```bash
git revert --no-edit <hash_do_commit>
git push origin main
```

## 3.21 Rotulo TOTAL centralizado na celula mesclada (06/11/2026)

**Commit:** `fix: centraliza o rotulo TOTAL na celula mesclada do PDF e do XLSX`

### O que era

Depois da secao 3.20 (celulas da linha de TOTAL mescladas), o rotulo "TOTAL"
ficava grudado na borda esquerda da celula mesclada - parecia o rotulo da coluna
"Data" e nao o centro da linha.

### O que mudou

| Item | Antes | Agora |
|------|-------|-------|
| PDF | "TOTAL" alinhado a esquerda (no inicio da celula) | "TOTAL" **centralizado** na celula mesclada (Faturamento: Data + Cliente; listas: Data + Descricao + Fornecedor/Cliente + Banco + Metodo) |
| XLSX | rotulo "TOTAL" na coluna A alinhado a esquerda | rotulo "TOTAL" na coluna A **centralizado** na area mesclada |

O VALOR nao muda: continua na ultima coluna, alinhado a direita e com o formato
de moeda.

### Como foi feito

- **PDF**: no hook `didParseCell`, a celula mesclada recebe
  `data.cell.styles.halign = "center"` (o `colSpan` continua igual).
- **XLSX**: na linha de total, a coluna A passa a usar
  `alignment.horizontal = "center"` (as demais colunas continuam a direita).

### Arquivos

| Arquivo | Mudanca |
|---------|---------|
| `src/lib/exportar.ts` | `mesclarLinhaTotal` (PDF) e `montarTabelaXlsx` (XLSX) |

### Como reverter (sem reescrever o historico ja publicado)

```bash
git revert --no-edit <hash_do_commit>
git push origin main
```

## 3.22 Regras dos novos clientes + Resultado do XLSX (Recebidos - Pagos) (06/11/2026)

**Commits:**
- `fix: cadastra as regras dos novos clientes e troca o Resultado do XLSX para Recebidos - Pagos`
- `docs: registra as novas regras de cliente e o Resultado Recebidos - Pagos (secao 3.22)`

### 1. Regras de direcionamento do Faturamento

Clientes que apareciam na planilha sem regra (caiam em "OUTROS" e nao entravam no
faturamento da empresa dona):

| Cliente (planilha) | Antes | Agora |
|--------------------|-------|-------|
| S.A. GONDOLAS (com espaco) | OUTROS | **Rosangela** (mesma regra do "S.A.GONDOLAS") |
| DESINGTEX | OUTROS | **Juvenal** (grafia errada do DESIGNTEX) |
| MODULO EMBALAGENS | OUTROS | **Juvenal** |
| ZAR PINTURAS | OUTROS | **Juvenal** |

O casamento da regra passou a ignorar **espacos**: a chave e o nome normalizado sem
espacos (`chaveDeRegra`), entao "S.A. GONDOLAS" e "S.A.GONDOLAS" caem na mesma
regra, sem precisar duplicar a entrada no mapa.

### 2. Resultado do XLSX = Recebidos − Pagos

A aba "Resumo" do XLSX mostra o **caixa do periodo**:

```
Resultado = total de Recebidos − total de Pagos
```

| Item | Antes | Agora |
|------|-------|-------|
| Linha do Resumo | "Resultado (A receber - A pagar)" | "Resultado (Recebidos - Pagos)" |
| Nota abaixo da tabela | "Resultado = A Receber − A Pagar ..." | "Resultado = Recebidos − Pagos (Faturamento, A Receber e A Pagar não entram no cálculo)" |
| Calculo | A Receber − A Pagar | Recebidos − Pagos |

O PDF nao tem card de Resultado (continua so com Faturamento, Recebidos e Pagos).

### Arquivos

| Arquivo | Mudanca |
|---------|---------|
| `src/lib/planilha.server.ts` | `EMPRESA_POR_REMETENTE` (DESINGTEX, MODULO EMBALAGENS, ZAR PINTURAS), `chaveDeRegra` e `REGRAS_POR_CHAVE` (casamento sem espacos) |
| `src/lib/exportar.ts` | `calcularResultado` (Recebidos − Pagos), rotulo e nota da aba Resumo |

### Como reverter (sem reescrever o historico ja publicado)

```bash
git revert --no-edit <hash_do_commit>
git push origin main
```

## 3.23 Velocidade da carga: limitador por empresa, janela menor, cache duradouro e pre-aquecimento (06/11/2026)

**Commits:**
- `fix: acelera a carga do painel (limitador por empresa, janela menor, cache duradouro e pre-aquecimento)`
- `docs: registra as otimizacoes de velocidade do painel (secao 3.23)`

### O diagnostico (medido em producao em 06/11/2026)

| Cenario | Tempo | Observacao |
|----------|-------|------------|
| "Todas as empresas", nov/2026 (cache quente) | 1,1 s (2a chamada) / 12 s (1a, instancia fria da Vercel) | resultado completo |
| "Todas as empresas", set/2026 (2.610 titulos, cache frio) | 63,4 s na 1a rodada e 55,5 s na 2a | 2.069 -> 1.619 titulos ainda sem baixa |

Cada rodada do painel enriquecia ~450-540 titulos (9 req/s) e o front refaz a
consulta 6x: o mes fechava em **5-7 minutos**, e ate la as datas eram de
vencimento e o banco ficava vazio.

### Por que nao existe atalho na API (verificado na documentacao e na API real)

- A **API de Baixas** so tem `GET /v1/financeiro/eventos-financeiros/parcelas/{id}/baixa`
  (por parcela), POST, PATCH, DELETE e GET por `baixa_id`. **Nao existe
  listagem em lote** (developers.contaazul.com/docs/acquittance-apis-openapi.md).
- A **listagem** (`/v1/financeiro/contas-a-pagar`, `/contas-a-receber`) **nao traz
  a baixa**. O JSON real do item tem so: `id, descricao, data_vencimento, status,
  status_traduzido, total, nao_pago, pago, data_criacao, data_alteracao,
  data_competencia, categorias, centros_custo, fornecedor/cliente` — sem
  `data_pagamento`, sem `baixas`, sem `conta_financeira`.
- O campo `pago` da listagem e a **face**, nao o liquido. Exemplo real (LGP):
  `total=61.784,96 / pago=59.390,00`, e a baixa mostra `valor_bruto=59.390`,
  `juros=2.394,96`, `valor_liquido=61.784,96`. Portanto nao da para usar `pago`
  (o valor do titulo ficaria errado) — a baixa continua indispensavel.

### O que mudou

**1. Limitador de taxa POR EMPRESA (antes era global)**

A API cobra **10 req/s por conta conectada** — e cada empresa conectada tem o
seu proprio token, ou seja, a sua propria cota. O limitador era global (um
unico 9 req/s para as 4 empresas), o que desperdicava ~75% da capacidade.

Teste em producao: 4 empresas em paralelo a 9 req/s cada = **35,4 req/s
agregados**, com 3 respostas 429 em 792 chamadas (0,4%).

| Cenario | Antes (global) | Agora (por empresa) |
|----------|----------------|---------------------|
| 2 empresas em paralelo (set/2026) | 51,6 s | **25,8 s** (2x) |
| 4 empresas ("todas") | 1 cota de 9 req/s | 4 cotas de 9 req/s (ate 4x) |

**2. Janela de vencimento da listagem: 365 -> 180 dias**

A API exige `data_vencimento_de/_ate` mesmo quando o filtro real e por data de
pagamento — mas a janela e o que define o custo da listagem:

| Janela | 1a pagina (producao) |
|--------|----------------------|
| 365 dias | 3,4-5,9 s |
| 180 dias | **0,5-0,9 s** (5-10x) |

Os totais (`itens_totais`) foram **identicos** nas duas janelas em 5 periodos x
4 empresas (jan, abr, jul, set e nov/2026), e a API respeita o filtro (janela
impossivel devolve 0 itens) — ou seja, nenhum titulo pago no periodo fica de
fora.

**3. Cache de baixa com TTL por recencia do pagamento**

A baixa e imutavel, entao o cache pode durar mais:

| Tipo de titulo | TTL | Por que |
|----------------|-----|---------|
| Pago nos ultimos 7 dias (mes em andamento) | 12 h | e o que ainda pode ser corrigido |
| Periodo ja fechado | **30 dias** | depois da 1a busca o mes nao e mais buscado |

A validade e contada a partir de `atualizado_em` (quando a baixa foi buscada
na API), nao do momento da leitura — o cache nao "renova" sozinho.

**4. Pre-aquecimento por cron**

Rota `/api/cron/prewarm-baixas` (cron da Vercel, 1x/dia as 03:30 UTC): busca
as baixas do mes corrente e do anterior de todas as empresas em segundo plano.
E o mesmo trabalho que o painel faria ao abrir — so que adiantado, de
madrugada, sem ninguem esperando. O resultado do cache e identico ao que o
painel produziria.

**Extras:** a leitura do cache do Supabase passou a fazer os lotes (200 ids) em
PARALELO (4 por vez) — em um mes grande (2.600 titulos) a leitura serial gastava
~6 s so para montar a lista do que ja estava em cache.

### Variaveis de ambiente novas

| Variavel | Padrao | Para que serve |
|----------|--------|----------------|
| `JRM_BAIXAS_POR_SEGUNDO` | 9 | req/s de baixa POR EMPRESA |
| `JRM_BAIXAS_TTL_HORAS` | 12 | TTL do cache (pagamento recente) |
| `JRM_BAIXAS_TTL_LONGO_DIAS` | 30 | TTL do cache (periodo fechado) |
| `JRM_BAIXAS_RECENTE_DIAS` | 7 | o que conta como "recente" |
| `JRM_JANELA_VENCIMENTO_DIAS` | 180 | janela de vencimento da listagem |
| `JRM_PREAQUECER_MESES` | 2 | meses cobertos pelo pre-aquecimento |
| `JRM_PREAQUECER_ORCAMENTO_MS` | 40000 | tempo maximo do pre-aquecimento |

### Verificacoes

- **Titulos identicos** com 180 e 365 dias (153/54 e 116/10 em nov/2026;
  1.196/245 e 853/142 em set/2026) e **totais identicos** aos da producao.
- **Pre-aquecimento local** (mock do Supabase + API real): nov/2026 da Juvenal
  em 14,2 s, com Pagas 235.609,71 e Recebidas 455.108,80 — os mesmos valores
  do painel em producao.
- **TTL**: 7 de 7 casos OK (hoje, 3 dias, 6 dias, 8 dias, 5 meses, sem data e
  duas baixas com uma recente).
- **Paralelismo**: 2 empresas em paralelo, 51,6 s -> 25,8 s.

### Arquivos

| Arquivo | Mudanca |
|---------|---------|
| `src/lib/contaazul.server.ts` | limitador por empresa, TTL por recencia, janela de 180 dias, leitura do cache em paralelo, `preAquecerBaixas()` |
| `src/routes/api/cron/prewarm-baixas.ts` | rota do cron de pre-aquecimento (protegida pelo `CRON_SECRET`) |
| `vercel.json` | cron diario do pre-aquecimento (03:30 UTC) |

### Como reverter (sem reescrever o historico ja publicado)

```bash
git revert --no-edit <hash_do_commit>
git push origin main
```

---

## 3.24 Limitador unico por empresa + cache persistente do metodo de pagamento (06/11/2026)

**Commits:**
- `fix: limita toda chamada da API por empresa e guarda o metodo de pagamento em cache persistente`
- `docs: registra o limite real da API medido e o ajuste das chamadas de saldo (secoes 3.24 e 3.25)`

### O problema (regressao medida em producao em 06/11/2026)

Depois da secao 3.23 a 1a carga do painel ("todas", nov/2026) levou **116,6 s**
e deixou **46 titulos sem baixa** (data de vencimento no lugar da data real e
banco vazio). A 2a e a 3aloads eram rapidas (11,1 s e 4,1 s).

Os logs da Vercel apontaram a causa: **63 + 36 + 4 chamadas de "detalhe do
metodo de pagamento"** (busca da forma de pagamento de cada titulo em aberto)
saíam em **rajada**, sem nenhum limitador de taxa, e tomavam **429** em cima
das buscas de baixa — 24 retries e 23 respostas 429 numa unica carga.

### O que mudou

**1. TODA chamada da API passa pelo mesmo limitador por empresa**

O limitador (antes so das buscas de baixa) foi generalizado:

| Antes | Agora |
|-------|-------|
| `esperarVagaBaixa()` / `baixaRecebeu429()` / `baixaDeuCerto()` | `esperarVagaApi(empresa)` / `apiRecebeu429(empresa)` / `apiDeuCerto(empresa)` |
| apenas a busca de baixa | baixa + listagens + detalhe do metodo + saldo |
| `fetchComRetry(url, init, tentativas)` | `fetchComRetry(url, init, tentativas, empresa?)` |

A fila por tempo (uma chamada a cada ~111 ms por empresa) e o ajuste automatico
do intervalo (um 429 dobra o intervalo; varios acertos reduzem de volta) agora
valem para **todas** as chamadas da empresa.

**2. Cache persistente do METODO de pagamento (tabela `detalhes_cache`)**

O cache do metodo era so em memoria (5 min) e se perdia a cada cold start da
Vercel: a cada nova instancia o painel refazia ~100 chamadas de detalhe.

- migration `supabase/migrations/20261106000001_detalhes_cache.sql` (aplicada
  no banco): `empresa` + `titulo_id` (PK), `metodo`, `atualizado_em`;
- TTL de **12 h**, contado a partir de `atualizado_em` (a leitura nao renova);
- so **metodos preenchidos** sao cacheados (um titulo sem metodo pode ser
  preenchido depois pela empresa);
- leitura em lote (1 consulta a cada 200 titulos, 4 lotes em paralelo) e
  gravacao em lote (upsert);
- o cache de detalhes usa um aviso de "banco indisponivel" SEPARADO do das
  baixas: se a tabela ainda nao existir, o cache de datas continua funcionando.

### Verificacoes

**Teste local (mock do Supabase + API real da Conta Azul), Juvenal nov/2026:**

| Rodada | Chamadas de detalhe | Tempo |
|--------|--------------------|-------|
| 1a (cache vazio) | 70 | 10,0 s |
| 2a (cache em memoria) | 0 | 0 ms |
| 3a (modulo NOVO = cold start) | **0** (104 titulos lidos do Supabase) | 1,5 s |

Os tres resultados foram **identicos** (mesmos titulos, mesmo metodo, mesmo
valor).

**Producao ("todas", nov/2026), depois da correcao:**

| Chamada | Antes | Depois |
|---------|-------|--------|
| 1a (fria) | **116,6 s** + 46 sem baixa | **15,4 s** + 0 sem baixa |
| 2a | 11,1 s | 0,9 s |
| 3a | 4,1 s | 1,3 s |

Totais **iguais** em todas as rodadas: pagas 295 (R$ 1.030.651,11) e recebidas
78 (R$ 567.911,55).

---

## 3.25 Limite real da API (medido) e ajuste das chamadas de saldo (06/11/2026)

**Commits:**
- `fix: passa as chamadas de saldo pelo limitador por empresa (evita 429 e derruba a carga)`
- `docs: registra o limite real da API medido e o ajuste das chamadas de saldo (secoes 3.24 e 3.25)`

### O limite real da API (medido em producao, rota temporaria removida depois)

A API avisa "ate 10 requisicoes por segundo **por conta conectada**". A duvida
era se a cota e por empresa (4 empresas = 4 cotas) ou agregada. Medicao com
chamadas em taxa fixa, disparadas da Vercel:

| Cenario | Taxa | Chamadas | 429 | % |
|---------|------|----------|-----|---|
| 1 empresa x 9/s | 9/s | 73 | 0 | 0% |
| 2 empresas x 9/s | 18/s | 146 | 1 | 0,7% |
| 4 empresas x 9/s | 36/s | 292 | 12 | 4,1% |
| 4 empresas x 4/s | 16/s | 132 | 0 | 0% |

**Conclusion: o limite e POR EMPRESA** (10 req/s cada) — o limitador por
empresa da secao 3.23 esta correto e permite ~36 req/s no total.

### O que ainda furava a fila: as chamadas de SALDO

`buscarSaldos` busca o saldo de **cada conta financeira** da empresa
(LGP 25, Juvenal 17, JRM 6, Rosangela 6) com `fetch` CRU — ou seja, **fora
do limitador** (3 por vez, com 800 ms de pausa entre lotes). Isso somava
~3,75 req/s extras por empresa, estourava a cota de 10/s e fazia as buscas de
baixa/detalhe tomarem 429 (e a carga do painel demorar 2 minutos).

Correcoes:

- as chamadas de saldo passam pelo **mesmo limitador por empresa** (e alimentam
  o ajuste automatico de intervalo);
- o trabalho virou uma **esteira** de 8 chamadas em voo (sem o atraso artificial
  de 800 ms entre lotes): o limitador ja espaca as chamadas, entao nao ha mais
  para esperar a chamada mais lenta de cada lote;
- o `PATCH` de atualizacao de baixa (`atualizarBaixa`) tambem passou pelo
  limitador.

**Medicao local (LGP, 25 contas):**

| Antes | Depois |
|-------|--------|
| 12,5 s (3 por rajada a cada 800 ms, sem limite) | **3,8 s** (107-123 ms entre chamadas) |

### Por que ainda aparecem alguns 429

Os 429 que restam nao sao do desenho do app: acontecem quando **duas cargas do
painel correm ao mesmo tempo** (por exemplo, uma aba do navegador aberta +
o clique do usuario). Os logs mostram 3 requisicoes simultaneas na mesma
segunda (2x `getDashboard` + 1x `getEmpresaBreakdown`), e os 429 se
dividem entre elas. Uma carga isolada nao toma 429.

### Arquivos

| Arquivo | Mudanca |
|---------|---------|
| `src/lib/contaazul.server.ts` | limitador unico por empresa para toda chamada da API; cache persistente do metodo (`detalhes_cache`); saldo na esteira e dentro do limitador |
| `supabase/migrations/20261106000001_detalhes_cache.sql` | nova tabela `detalhes_cache` (aplicada no banco) |

### Como reverter (sem reescrever o historico ja publicado)

```bash
git revert --no-edit <hash_do_commit>
git push origin main
```

---

## 3.26 Cargas sequenciais na pagina: o breakdown so depois do dashboard (06/11/2026)

**Commits:**
- `fix: busca o breakdown (A Receber/A Pagar) depois do dashboard (evita 3 cargas paralelas e o estouro do limite de 60s)`
- `docs: registra o sequenciamento das cargas da pagina e a validacao da exportacao em producao (secao 3.26)`

### O problema

A secao 3.25 mediu o limite da API (10 req/s **por empresa**) e deixou claro que
o limitador so funciona **dentro de uma instancia**. Na pagina, porem, as tres
server functions sao chamadas **em paralelo**:

| Server fn | Origem | Peso |
|------------|--------|------|
| `getDashboard` | cards + listas de Pagos/Recebidos | pesado (API da Conta Azul) |
| `getEmpresaBreakdown` | listas de A Receber/A Pagar | pesado (API da Conta Azul) |
| `getFaturamento` | planilha de cargas (Google Sheets) | leve (nao usa a API da Conta Azul) |

Cada uma roda em uma **instancia diferente da Vercel**, e cada instancia tem o
**seu proprio limitador por empresa**. Resultado: 2-3x a cota da API, 429 em
cascata, o retry estourando o tempo limite de 60 s da funcao e a tela presa em
**"Sincronizando..."** (as vezes por varios minutos).

Evidencia nos logs de 06/11/2026 (22:49-22:50 UTC): 3 requisicoes na mesma
segunda (2x `getDashboard` + 1x `getEmpresaBreakdown`), **27 respostas 429** e
uma requisicao que durou **49,3 s**.

### O que mudou

Em `src/routes/index.tsx`, a query do breakdown so e habilitada **depois**
que a query do dashboard do periodo atual termina com sucesso:

```tsx
const dashboardPronto =
  queryClient.getQueryState(["dashboard", empresa, dataInicio, dataFim])?.status === "success";

const { data: breakdown } = useQuery({
  queryKey: ["breakdown", empresa, dataInicio, dataFim],
  queryFn: () => getEmpresaBreakdownFn({ ... }),
  enabled: !!dataInicio && !!dataFim && dashboardPronto,
  // ...
});
```

O `getFaturamento` continua em paralelo: ele le a **planilha do Google
Sheets** e nao consome a cota da Conta Azul.

### Medicoes (producao, "todas", nov/2026)

| Chamada isolada | 1a | 2a |
|------------------|----|----|
| `getDashboard` | **7,1 s** | **1,1 s** |
| `getEmpresaBreakdown` (4 empresas) | **6,4 s** | - |
| `getEmpresaBreakdown` (1 empresa) | 4,4 s | - |

Com o sequenciamento, a pagina carrega o dashboard e depois o breakdown, sem
estourar o limite de 60 s e sem 429 (no log do dia: dashboard em **3,9 s** com
o cache de baixas quente).

Totais conferidos (iguais em todas as rodadas): **pagas 295 (R$ 1.030.651,11)**
e **recebidas 78 (R$ 567.911,55)**, **0 titulos sem baixa**.

### Validacao da exportacao em producao (PDF e XLSX)

Exportados direto da pagina em producao ("Todas as Empresas", 01-30/11/2026):

**PDF** (17 paginas)

- cabecalho: Faturamento R$ 538.064,12 | Recebidos R$ 567.911,55 | Pagos R$ 1.030.651,11;
- **0 celulas de banco vazio** — os bancos vem da **baixa** (Sicoob 3109, Sicoob,
  Sicoob 3049, Bradesco, Itau, Caixa);
- datas **reais de pagamento** (03 a 06/11/2026) nas tabelas de titulos (as
  datas futuras 07 e 09/11 aparecem so na tabela de Faturamento, que e a
  programacao de carga);
- linha de **TOTAL com 2 celulas** (rotulo mesclado + valor), rotulo
  **centralizado** (x do texto = 362,5 = centro da celula mesclada 28,3-722,8).

**XLSX** (6 abas: Resumo, Faturamento, A Receber, A Pagar, Pagos, Recebidos)

| Aba | Qtd. | TOTAL |
|-----|------|-------|
| A Receber | 106 | R$ 4.836.825,25 |
| A Pagar | 522 | R$ 3.875.522,03 |
| Pagos | 295 | R$ 1.030.651,11 |
| Recebidos | 78 | R$ 567.911,55 |

- linha de TOTAL: rotulo mesclado (`A:G`) **centralizado**, valor na ultima
  coluna **alinhado a direita**;
- aba Resumo: **Resultado (Recebidos - Pagos) = R$ -462.739,56**
  (567.911,55 - 1.030.651,11).

### Arquivos

| Arquivo | Mudanca |
|---------|---------|
| `src/routes/index.tsx` | breakdown so e buscado depois que o dashboard termina |

### Como reverter (sem reescrever o historico ja publicado)

```bash
git revert --no-edit <hash_do_commit>
git push origin main
```

---

## 3.27 Pre-aquecimento que realmente renova o cache do mes corrente (07/11/2026)

**Commits:**
- `fix: o pre-aquecimento renova as baixas do mes em andamento (o cron rodava antes do TTL de 12h vencer)`
- `docs: registra o diagnostico do pre-aquecimento e a correcao do refresh forcado (secao 3.27)`

### O problema (achado em 07/11/2026, na 1a carga do dia)

Medindo a carga de "todas" (nov/2026) as 13:56 UTC de 07/11, a 1a chamada
levou **27,9 s** (a 2a, 1,3 s). O esperado era ~7 s: o cache de baixas devia
estar aquecido pelo cron da madrugada.

Investigando o cache no Supabase (`baixas_cache`):

| Momento | Escritas no cache |
|---------|-------------------|
| 05/11 19:00 UTC | 625 (uso do painel) |
| 06/11 18:00 UTC | 991 (uso do painel) |
| **07/11 04:00 UTC** | **916 (o cron rodou)** |
| 07/11 13:00 UTC | 281 (a medicao) |

O cron **rodou** (escreveu 916 linhas as 04:00 UTC), mas **nao renovou o que
importava**. Motivo: o TTL das baixas recentes e de **12 h** e o painel e usado
no fim da tarde (escritas as 18:55 UTC de 06/11) — essas entradas so vencem
as **06:55 UTC de 07/11**. O cron das **03:30 UTC** rodou **antes** do
vencimento, encontrou tudo "fresco" e nao buscou nada de novo. Resultado: a
primeira carga do dia seguinte pagava a API inteira (~28 s).

Ou seja: o pre-aquecimento funcionava, mas na hora errada — e, mesmo na hora
certa, ele nao renova o que ainda esta dentro do TTL.

### O que mudou

**1. Refresh FORCADO no mes em andamento (`src/lib/contaazul.server.ts`)**

O pre-aquecimento agora ignora o cache das baixas do **mes corrente** e as
busca de novo na API, gravando o resultado com a data de gravacao nova.
Flag `forcarRefreshBaixas`, ligada so durante a execucao do cron:

| Cache | Onde | Com o refresh forcado |
|-------|------|-----------------------|
| baixa (memoria) | `buscarBaixaDaParcela` | ignorado |
| baixa (Supabase) | `lerBaixasDoSupabase` | ignorado (a linha e rebuscada) |
| lista (memoria, 2 min) | `buscarPagas` / `buscarRecebidas` | ignorado |

O **mes corrente** e a fase 1 do pre-aquecimento; os **meses ja fechados**
(TTL longo de 30 dias) continuam na fase 2, sem refresh forcado — o cache deles
so precisa ser preenchido, nao renovado.

**2. Horario do cron (`vercel.json`): 03:30 UTC -> 08:00 UTC**

O cache renovado as 08:00 UTC fica valido por 12 h (ate as 20:00 UTC), o que
cobre o horario de uso do painel (15h-16h, hora de Sao Paulo). Antes, a
renovacao (quando existia) valia so ate as 15:30 UTC.

### Teste executado (API da Conta Azul e Supabase FALSOS, mock local)

```bash
node --no-warnings --experimental-transform-types test-prewarm.mts 1
node --no-warnings --experimental-transform-types test-prewarm.mts 2
```

| Cenario | Resultado |
|----------|-----------|
| 1a execucao (popula o cache) | 4 chamadas de baixa, 2 linhas no cache |
| 2a execucao (mes corrente) | **+4 chamadas** (as baixas foram re-buscadas) e cache regravado |
| 2a execucao (2 meses) | **+4 chamadas** — so o mes corrente e forcado |
| chamada normal (sem o cron) | **+0 chamadas** — o cache continua sendo reutilizado |

**RESULTADO: OK** nos dois cenarios.

### Verificacao em producao (07/11/2026)

Cron disparado na mao (`vercel crons run /api/cron/prewarm-baixas`) na versao
publicada, e o log da execucao:

| Etapa | Empresa | Resultado |
|-------|---------|-----------|
| Fase 1 (mes corrente, **refresh forcado**) | LGP | 10/10 e 116/116 titulos — `cache banco 0, API 116` |
| | JRM | 8/8 e 1/1 — `cache banco 0, API 8` |
| | Rosangela | 18/18 e 13/13 — `cache banco 0, API 18` |
| | Juvenal | 54/54 e 153/153 — `cache banco 0, API 153` |
| Fase 2 (out/2026, mes fechado, **sem** refresh) | JRM / Rosangela / LGP | `cache banco 4, API 0` / `97, API 0` / `130, API 0` — cache reutilizado |
| | Juvenal | `cache banco 173, API 61` — so os que ainda nao estavam no cache |

- execucao completa em **38,3 s** (limite da funcao na Vercel: 60 s);
- **2 respostas 429** no meio do caminho, absorvidas pelo retry (todos os
  titulos terminaram com `0 pendentes`);
- cache no Supabase: **3.363 linhas** (antes 2.813), com as escritas do mes
  corrente em 07/11 14:56-14:57 UTC.

**Carga do painel logo depois do cron:**

| | Antes da correcao | Depois |
|---|-------------------|--------|
| 1a carga ("todas", nov/2026) | 27,9 s | **7,1 s** |
| 2a carga | 1,3 s | **1,0 s** |

Totais iguais em todas as medicoes: pagas **295 (R$ 1.030.651,11)**, recebidas
**78 (R$ 567.911,55)**, **0 titulos sem baixa**.

### Arquivos

| Arquivo | Mudanca |
|---------|---------|
| `src/lib/contaazul.server.ts` | `forcarRefreshBaixas` + `definirForcarRefreshBaixas()`; o pre-aquecimento forca o refresh do mes corrente (fases 1 e 2) |
| `vercel.json` | cron de pre-aquecimento: `30 3 * * *` -> `0 8 * * *` |

### Como reverter (sem reescrever o historico ja publicado)

```bash
git revert --no-edit <hash_do_commit>
git push origin main
```

---

## 3.28 Filtro de bancos decide pelo banco da baixa e a Alvarenga vira transportadora separada (09/11/2026)

**Commits:**
- `fix: o filtro de bancos decide pelo banco da baixa e a Alvarenga vira transportadora separada no relatorio`
- `docs: registra a correcao do filtro de bancos e o bloco proprio da Alvarenga Transportes (secao 3.28)`

### O problema (dois, no mesmo filtro)

**1. Titulos de contas que nao sao bancos vazavam para o relatorio.**

O `filtrarPorBancos` antigo so olhava o `conta_id` da LISTAGEM e o mapa de
contas — e ignorava `i.banco`, que e o nome da conta financeira **usada na
baixa** (o pagamento de verdade). Como ha titulos cujo vinculo na listagem
nao bate com a conta usada, contas como CARTÃO DE CRÉDITO, Banco do Brasil,
Daycoval, P.F., Devolucao e Garantia apareciam no relatorio.

Medicao em producao (dashboard, `checa-cartoes.mjs`, 09/11/2026), titulos de
ago-dez/2026 com banco fora dos 4 bancos exibidos:

| Empresa | Lista | Conta | Qtd | Valor |
|---------|-------|-------|-----|-------|
| LGP | Pagos | ALVARENGA TRANSPORTES | 21 | R$ 12.644,99 |
| LGP | Pagos | CARTÃO DE CRÉDITO | 95 | R$ 47.423,07 |
| LGP | Pagos | Devolução | 5 | R$ 64.501,05 |
| LGP | Pagos | P.F. | 3 | R$ 7.397,52 |
| LGP | Recebidos | Daycoval | 8 | R$ 5.649.044,01 |
| JRM | Pagos | P.F. | 1 | R$ 12.960,00 |
| Juvenal | Pagos | Garantia | 1 | R$ 8.800,79 |
| Juvenal | Pagos/Recebidos | Sicoob 3049 | 904 | R$ 1.978.699,96 |
| Juvenal | Pagos | (sem banco) | 892 | R$ 1.968.311,72 |

**2. A "ALVARENGA TRANSPORTES" nao era tratada como transportadora.**

Dentro da conta da Conta Azul da LGP existe a conta financeira **ALVARENGA
TRANSPORTES** (ICMS Alvarenga, compra do fornecedor da Alvarenga, seguro
RC-V/RCTR-C, PIS/COFINS...). O usuario queria esses titulos **fora** do bloco
da LGP e com bloco **proprio** no PDF, como se fosse outra transportadora.

### O que mudou

**1. Lista unica dos 4 bancos (`src/lib/bancos.ts`)**

`BANCOS_DO_GRUPO = ["BRADESCO", "ITAU", "SICOOB 3049", "SICOOB 3109"]` passa a
ser a fonte unica para **todas** as empresas (`BANCOS_POR_EMPRESA` e
`BANCOS_PADRAO` apontam para ela). Antes, `BANCOS_PADRAO` (usado por quem nao
esta no mapa, ex.: Juvenal) era `["ITAU", "SICOOB", "SICOOB 3109", "BRADESCO"]`
— sem o 3049, o que faria sumir **R$ 1,98M** de titulos reais do Juvenal.

**2. O filtro decide pelo banco da BAIXA (`filtrarPorBancos`, `contaazul.server.ts`)**

Ordem de decisao, do mais confiavel para o menos:

1. `i.banco` (conta usada na baixa) — **tem prioridade**;
2. sem baixa, o vinculo da listagem (`conta_id` -> mapa de contas);
3. sem banco conhecido: **mantido** (conservador — Juvenal tem ~890 titulos/mes
   sem banco e nao podem sumir da lista);
4. conta de OUTRA transportadora (`empresaDaConta`): **mantido**, porem sai do
   bloco da empresa dona da conta (item 3 abaixo);
5. banco conhecido fora dos 4: **removido** (Cartao, BB, Daycoval, P.F.,
   Devolucao, Garantia, Veloe...).

Para isso `aplicarBancoAosTitulos` passou a rodar **antes** do filtro (o nome
do banco precisa existir para a decisao); a ordem antiga fazia o filtro ver
so o `conta_id`.

**3. A conta ALVARENGA TRANSPORTES vira uma transportadora propria (`bancos.ts`)**

- `EMPRESA_POR_CONTA`: mapa "conta financeira" -> "transportadora" (hoje so a
  ALVARENGA TRANSPORTES -> "Alvarenga Transportes");
- `empresaDaConta(nome)`: devolve a transportadora dona de uma conta;
- `empresaDoTitulo(titulo, mapa, empresaPadrao)`: transportadora dona de um
  titulo (banco da baixa primeiro, depois a conta da listagem);
- `separarPorTransportadora(...)`: reparte as 4 listas de uma empresa em
  **blocos** por transportadora.

`getDashboard` (detalhamento de Pagos/Recebidas) e `getEmpresaBreakdown`
(A Receber/A Pagar) agora devolvem **um bloco por transportadora**: os
titulos da conta ALVARENGA saem do bloco "LGP Transportes" e viram o bloco
"Alvarenga Transportes". No `exportar.ts`, a chave `ALVARENGA` (faturamento
ORTHOCRIN, que ja existia na planilha) passa a se chamar **"Alvarenga
Transportes"** — faturamento e titulos caem no MESMO bloco.

O XLSX nao precisa de agrupamento: a coluna "Empresa" das abas passa a
mostrar "Alvarenga Transportes" nos titulos daquela conta.

### Testes executados (API da Conta Azul e Supabase FALSOS / PDF e XLSX reais)

Tres suites locais, todas verdes:

| Suite | O que cobre |
|-------|-------------|
| `test-blocos.mts` | 14 casos do `filtrarPorBancos` (prioridade da baixa, remocao de Cartao/BB/Daycoval/P.F./Devolucao/Garantia/Veloe, manutencao de sem-banco e de Sicoob 3049/3109), `empresaDoTitulo`, `separarPorTransportadora` (2 blocos, 1 bloco quando nao ha titulos de outra transportadora) e a lista exibida das 5 empresas |
| `test-pdf-blocos.mts` | PDF real com visao "Todas": bloco "Alvarenga Transportes" em pagina propria, com os titulos dela e o faturamento ORTHOCRIN; bloco "LGP Transportes" sem nenhum titulo da Alvarenga; bloco "Juvenal" so com faturamento; nenhuma mencao a CARTÃO DE CRÉDITO / Banco do Brasil / Daycoval / P.F. / Devolução / Garantia / Veloe |
| `test-xlsx-blocos.mts` | XLSX real: coluna "Empresa" com as duas transportadoras em A Receber/A Pagar/Pagos/Recebidos, linha TOTAL com o valor certo e Resultado = Recebidos − Pagos |

### Verificacao em producao (09/11/2026)

Deploy do commit `d6dcb32` no ar e checagem com `checa-cartoes.mjs "todas"
2026-08-01 2026-12-31` (mesma janela da medicao inicial), direto no serverFn
de producao:

| Indicador | Antes (09/11, baseline) | Depois |
|-----------|------------------------|--------|
| Card Contas Pagas | R$ 24.084.312,37 | **R$ 23.943.229,94** |
| Card Contas Recebidas | R$ 21.113.171,11 | **R$ 15.464.127,10** |
| Titulos com banco fora dos 4 (Cartao, BB, Daycoval, P.F., Devolucao, Garantia) | 113 (105 pagos + 8 recebidos) | **0** |
| Blocos de Pagos | — | LGP (2296) \| **Alvarenga Transportes (21)** \| Rosangela (301) \| JRM (73) \| Juvenal (3588) |
| Blocos de Recebidas | — | LGP (383) \| **Alvarenga Transportes (0)** \| Rosangela (243) \| JRM (17) \| Juvenal (802) |

As diferencas dos cards fecham exatamente com a medicao inicial:

- Pagas: **-R$ 141.082,43** = CARTAO 47.423,07 + Devolucao 64.501,05 +
  P.F. 7.397,52 + P.F. JRM 12.960,00 + Garantia 8.800,79;
- Recebidas: **-R$ 5.649.044,01** = Daycoval (8 titulos da LGP);
- Os 21 titulos da conta Alvarenga (R$ 12.644,99) continuam nos cards (a
  separacao muda so as LISTAS), agora no bloco proprio.

O unico grupo que ainda aparece como "fora da lista" sao **364 titulos com
banco vazio (R$ 1.016.674,56)** — todos mantidos de proposito pela regra
conservadora (sem banco conhecido, mantem; a maior parte e do Juvenal, que
nao tem vinculo de conta na listagem).

### Arquivos

| Arquivo | Mudanca |
|---------|---------|
| `src/lib/bancos.ts` | `BANCOS_DO_GRUPO` (4 bancos) unico para todas as empresas; `EMPRESA_POR_CONTA`, `empresaDaConta`, `empresaDoTitulo`, `separarPorTransportadora` |
| `src/lib/contaazul.server.ts` | `filtrarPorBancos` decide pelo banco da baixa; mantem conta de outra transportadora e titulo sem banco |
| `src/lib/contaazul.functions.ts` | `aplicarBancoAosTitulos` antes do filtro; `detalhamento` e `getEmpresaBreakdown` em blocos por transportadora |
| `src/lib/exportar.ts` | rotulo `ALVARENGA` = "Alvarenga Transportes" |

### Como reverter (sem reescrever o historico ja publicado)

```bash
git revert --no-edit <hash_do_commit>
git push origin main
```

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

### Referencia para reverter: correcao da paginacao de Pagos/Recebidos (04/11/2026)

**Commit do fix:** `76ced54` — `fix: paginas de pagos/recebidos recusadas pela API (rate limit) viravam total parcial no carregamento automatico`
**Commit do docs:** `24ca044` (secao 3.11 deste arquivo)
**Tag de referencia:** `correcao-paginas` — apontando para `76ced54`, publicada no remoto (sobrevive a limpeza do clone local)

**O que o fix alterou (3 arquivos):**

| Arquivo | Mudanca |
|---------|---------|
| `src/lib/contaazul.server.ts` | `fetchPaginaRobusta()` (novo), `MAX_PASSES_PAGINACAO`, tipo `ResultadoLista` (`ok` + `incompleto`) e a paginacao de `buscarPagasInterna` / `buscarRecebidasInterna` reescritas |
| `src/lib/contaazul.functions.ts` | campo `dados_incompletos` em `DashboardData` + avisos de "nova tentativa automatica" no `getDashboard` |
| `src/routes/index.tsx` | refetch automatica em background (3 s / 6 s / 9 s, max 3) quando `dados_incompletos` volta preenchido |

**Como reverter (sem reescrever o historico ja publicado):**

```bash
# Reverte SO o fix, em um commit novo (nao usa reset/force)
git revert --no-edit 76ced54
git push origin main

# Se tambem quiser tirar a documentacao da correcao:
git revert --no-edit 24ca044
git push origin main
```

**O que volta a acontecer apos o revert:** o comportamento antigo — se a API da
Conta Azul derrubar uma pagina no meio da paginacao (rate limit), o card
"Contas Pagas" passa a exibir um total PARCIAL sem aviso por ate 2 minutos
(cache), so se corrigindo quando o usuario clica em **Recarregar** (que limpa o
cache). As 19 assercoes do teste da secao 3.11 voltariam a falhar.

---

## 5. Estrutura de Arquivos Relevantes

- `src/lib/contaazul.functions.ts` — `getDashboard`, `getEmpresaBreakdown`, `listarEmpresas`, `inspecionarRecebimentos`, `finalizarAutorizacao` (troca o `code` OAuth por token)
- `src/lib/contaazul.server.ts` — `obterToken`, `renovarToken`, `pedirToken` (endpoint v2 com fallback legado), `buscarSaldos`, `buscarV2`, `buscarPagas`, `buscarRecebidas`, `filtrarPorBancos`, `mapaContaParaBanco`, `extrairContaId`, `basicAuth`, `getSupabase`
- `src/lib/bancos.ts` — lista de bancos exibidos por empresa (`BANCOS_POR_EMPRESA`, `bancosPermitidosDaEmpresa`, `bancoPermitido`); compartilhada entre o frontend e o filtro dos titulos no backend
- `src/lib/exportar.ts` — `exportarPdf` (cards, secoes e paginacao do PDF) e `construirXlsx` (aba Resumo + abas das listas); `ROTULOS` (todas) e `ROTULOS_PDF` (so Recebidos e Pagos)
- `src/routes/index.tsx` — Dashboard frontend, indicador de sync, KPI cards, projeto diaria, deteccao do `code` OAuth na raiz e botoes "Conectar Conta Azul"
- `src/routes/api/autorizar.ts` — Redirecionamento para login da Conta Azul (`state` = nome da empresa)
- `src/routes/api/callback.ts` — Legado (usa `redirect_uri` `/api/callback`, que nao e a cadastrada). **Nao e usado pelo fluxo atual.**
- `src/routes/api/debug-pagas.ts` — Diagnostico do JSON cru das contas a pagar baixadas (status ACQUITTED/PAGO)
- `src/routes/api/debug-recebidos.ts` — Diagnostico do JSON cru das contas a receber baixadas (status ACQUITTED/PAGO)
- `src/routes/api/cron/renovar-tokens.ts` — Rota do cron diario da Vercel (renovacao em lote de tokens); aceita `Authorization: Bearer CRON_SECRET`, header `X-Cron-Secret` ou `?secret=`; `?teste=slack` envia mensagem de teste ao Slack
- `src/lib/planilha.server.ts` — `buscarFaturamentoPlanilha`, `lerTituloPlanilha` (nome da planilha via `/edit`, fallback export CSV), `mesDoTitulo` (deduz `YYYY-MM` do nome)
- `src/lib/contaazul.server.ts` — `executarRenovacaoEmLote`, `testarSlack`/`enviarAlertaSlack` (webhook `SLACK_WEBHOOK_URL`), `obterToken` com renovacao proativa, lock distribuido

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

### Tabela `planilhas_mes`

Cadastro da planilha de faturamento de **cada mes** (migration `20261101000001_planilhas_mes.sql`, executada no Supabase com seed de 60 meses: jan/2026 a dez/2030).

| Coluna | Tipo | Descricao |
|--------|------|-----------|
| `mes` | text (PK) | Mes no formato `YYYY-MM` (ex: `2026-11`) |
| `url` | text | URL da planilha do Google Sheets |
| `id_planilha` | text | Id extraido da URL (`/spreadsheets/d/<id>`) |
| `cadastrada` | boolean | `true` quando ha URL registrada para o mes |
| `created_at` / `updated_at` | timestampz | Auditoria |

**Registro:** o fluxo na sidebar le o **nome da planilha** (`lerTituloPlanilha`, pagina `/edit` primeiro), deduz o mes/ano (`mesDoTitulo`, ex.: `"10.26 OUTUBRO"` -> `2026-10`), mostra painel de confirmacao com **seletor de mes** (sugestao pre-selecionada) e **so registra depois da confirmacao do usuario**. Se o nome nao indicar o mes, propoe o mes visado no painel. O registro e **upsert pela PK `mes`** (idempotente: re-registrar nao cria duplicata; URL diferente no mesmo mes substitui a anterior, com aviso no painel). Se o mes nao tiver planilha, `getFaturamento` devolve `meses_sem_planilha` e o painel exibe aviso.

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