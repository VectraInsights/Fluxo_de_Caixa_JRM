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

**ATENCAO — Alvarenga:** nao existe (e nao vai existir) no dropdown de empresas. Ela aparece
APENAS na visao "Todas as Empresas". Remetente sem regra cai em "OUTROS" (entra no "todas").

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

## 3.6 Resultado dos relatorios (A Receber − A Pagar)

O relatorio ganha um valor de **Resultado**, calculado **apenas com "A Receber" e
"A Pagar"**:

```
Resultado = total de A Receber − total de A Pagar
```

Faturamento e Pagos **nao entram** no calculo.

| Parte | Onde aparece |
|-------|--------------|
| XLSX | aba "Resumo", linha "Resultado (A receber - A pagar)" (verde/vermelho conforme o sinal) + nota explicativa abaixo da tabela |

O **titulo do PDF** e so **"Fluxo de Caixa"** (antes era "Fluxo de Caixa —
Faturamento, A Receber, A Pagar e Pagos").

> **Nota (03/11/2026, `852ac2d`):** o **card de Resultado saiu do PDF** e o PDF
> passou a mostrar **apenas Faturamento, Recebidos e Pagos** (3 cards, 3 secoes).
> O Resultado continua **apenas no XLSX** (aba "Resumo") — e por isso
> `calcularResultado()` nao e mais chamado pelo `exportarPdf`.

> **Nota:** o commit `5cd6da6` tinha tirado Faturamento e Pagos do resumo; o
> `8ca4056` volta os 4 cards e acrescenta o card/linha "Resultado".

Implementacao: `calcularResultado(rel)` em `exportar.ts` (soma de `rel.receber` menos
soma de `rel.pagar`).

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