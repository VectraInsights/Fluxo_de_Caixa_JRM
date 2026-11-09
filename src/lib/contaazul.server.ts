import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { bancoPermitido, empresaDaConta } from "./bancos";

// Singleton: cria o cliente uma única vez por processo (seguro pois as
// credenciais são env vars imutáveis durante o ciclo de vida do servidor).
// Nota: o cache de dados (detalheCache, listCache, saldoCache) é in-memory e
// é perdido ao reiniciar o servidor — comportamento esperado nesta arquitetura.
let _supabase: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (_supabase) return _supabase;
  const url = process.env.JRM_SUPABASE_URL;
  const key = process.env.JRM_SUPABASE_KEY;
  if (!url || !key) throw new Error("JRM_SUPABASE_URL/JRM_SUPABASE_KEY não configurados");
  _supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _supabase;
}

export function removerAcentos(s: string): string {
  if (!s) return "";
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function basicAuth(): string {
  const id = process.env.CONTA_AZUL_CLIENT_ID!;
  const secret = process.env.CONTA_AZUL_CLIENT_SECRET!;
  return Buffer.from(`${id}:${secret}`).toString("base64");
}

// Endpoints de troca de token da Conta Azul.
// O documentado hoje (portal novo / API v2) é api-v2.contaazul.com/oauth/token.
// O host auth.contaazul.com/oauth2/token é o antigo (API v1, descontinuada) e
// rejeita apps registrados no portal novo com "invalid_client" — por isso o
// endpoint v2 é tentado primeiro e o legado só entra como fallback.
const ENDPOINT_TOKEN_V2 = "https://api-v2.contaazul.com/oauth/token";
const ENDPOINT_TOKEN_LEGADO = "https://auth.contaazul.com/oauth2/token";

// Secreto opcional para proteger o endpoint cron de renovacao.
// Deve ser configurado como env var CRON_SECRET na Vercel e enviado
// pelo serviço externo (cron-job.org / GitHub Actions) no header
// X-Cron-Secret.
export function cronSecret(): string | undefined {
  return process.env.CRON_SECRET || undefined;
}

// ------------------- Alerta Slack (webhook) -------------------
// Envia mensagem para um canal do Slack via Incoming Webhook.
// Configurar env var SLACK_WEBHOOK_URL na Vercel com a URL gerada no Slack.
export async function enviarAlertaSlack(
  empresa: string,
  evento: string,
  erro: string | null,
  acao: string,
): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;

  const erroTxt = erro ? `\n*Erro:* ${erro}` : "";
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `🚨 *Falha de token — Fluxo de Caixa JRM*\n*Empresa:* ${empresa}\n*Evento:* ${evento}${erroTxt}\n*Ação:* ${acao}`,
      }),
    });
  } catch {
    // falha silenciosa: nao deixa o fluxo principal quebrar por causa do Slack
  }
}

// Envia uma mensagem de TESTE para o Slack e reporta o resultado HTTP.
// Chamado pelo endpoint GET /api/cron/renovar-tokens?teste=slack para validar
// a configuracao SLACK_WEBHOOK_URL ponta a ponta (env var -> app -> webhook).
export async function testarSlack(): Promise<{
  ok: boolean;
  status: number | null;
  detalhe: string;
}> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    return {
      ok: false,
      status: null,
      detalhe:
        "SLACK_WEBHOOK_URL nao configurada na Vercel (verificar escopo Production e redeploy)",
    };
  }
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "✅ Teste do Fluxo de Caixa JRM: alertas do Slack configurados com sucesso.",
      }),
    });
    const corpo = (await res.text()).slice(0, 100);
    log("info", `teste slack: status ${res.status}`);
    return {
      ok: res.ok,
      status: res.status,
      detalhe: res.ok ? "mensagem enviada" : corpo,
    };
  } catch (e) {
    log("warn", `teste slack: ${(e as Error).message}`);
    return { ok: false, status: null, detalhe: (e as Error).message };
  }
}

// ------------------- Log de eventos persistente (Supabase) -------------------
export async function gravarLogEvento({
  empresa,
  evento,
  erro,
  detalhe,
  acao_necessaria,
}: {
  empresa: string;
  evento: string;
  erro?: string | null;
  detalhe?: string | null;
  acao_necessaria?: string | null;
}): Promise<void> {
  try {
    const sb = getSupabase();
    await sb.from("logs_eventos").insert({
      empresa,
      evento,
      erro: erro ?? null,
      detalhe: detalhe ?? null,
      acao_necessaria: acao_necessaria ?? null,
    });
  } catch {
    // falha silenciosa: nao quebra o fluxo principal por causa do log
  }
}

// ------------------- Lock distribuído (Supabase) -------------------
// Evita que duas instancias serverless renovem o refresh_token da mesma
// empresa ao mesmo tempo (o refresh_token e rotacionado pela Conta Azul).
const LOCK_TTL_SEGUNDOS = 300; // 5 minutos

async function tentarObterLock(empresa: string, lockedBy: string): Promise<boolean> {
  const sb = getSupabase();
  const agora = new Date().toISOString();
  const { data: existente } = await sb
    .from("token_locks")
    .select("locked_at")
    .eq("empresa", empresa)
    .maybeSingle();
  if (!existente) {
    // ainda nao tem lock: tenta criar
    const { error } = await sb.from("token_locks").insert({
      empresa,
      locked_at: agora,
      locked_by: lockedBy,
    });
    return !error;
  }
  const lockEm = new Date(existente.locked_at).getTime();
  const expirado = Date.now() - lockEm > LOCK_TTL_SEGUNDOS * 1000;
  if (!expirado) return false;
  // lock expirado: tenta adquirir novamente
  const { error: err2 } = await sb
    .from("token_locks")
    .update({ locked_at: agora, locked_by: lockedBy })
    .eq("empresa", empresa);
  return !err2;
}

async function liberarLock(empresa: string): Promise<void> {
  const sb = getSupabase();
  await sb.from("token_locks").delete().eq("empresa", empresa);
}

export async function pedirToken(params: Record<string, string>): Promise<Response> {
  const tentar = (url: string) =>
    fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth()}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(params),
    });

  const resV2 = await tentar(ENDPOINT_TOKEN_V2);
  if (resV2.ok) return resV2;

  const corpoV2 = await resV2.clone().text();
  log(
    "warn",
    `token ${params.grant_type} em ${ENDPOINT_TOKEN_V2} -> ${resV2.status} ${corpoV2.slice(0, 200)}`,
  );

  // 401 / invalid_client: as credenciais podem ser válidas apenas no host legado.
  const pareceCredencial =
    resV2.status === 401 || corpoV2.toLowerCase().includes("invalid_client");
  if (!pareceCredencial) return resV2;

  const resLegado = await tentar(ENDPOINT_TOKEN_LEGADO);
  if (resLegado.ok) {
    log("info", `token ${params.grant_type} obtido no endpoint legado`);
    return resLegado;
  }

  const corpoLegado = await resLegado.text();
  log(
    "warn",
    `token ${params.grant_type} em ${ENDPOINT_TOKEN_LEGADO} -> ${resLegado.status} ${corpoLegado.slice(0, 200)}`,
  );
  // Devolve o erro do endpoint documentado (é o mais explicativo).
  return new Response(corpoV2, {
    status: resV2.status,
    headers: { "Content-Type": "application/json" },
  });
}

// ------------------- Logs em memória (ring buffer) -------------------
type LogEntry = { ts: number; nivel: "debug" | "info" | "warn" | "error"; msg: string };
const LOGS: LogEntry[] = [];
const LOGS_MAX = 200;
export function log(nivel: LogEntry["nivel"], msg: string) {
  LOGS.push({ ts: Date.now(), nivel, msg });
  if (LOGS.length > LOGS_MAX) LOGS.splice(0, LOGS.length - LOGS_MAX);
  // espelha no console também
  const fn = nivel === "error" ? console.error : nivel === "warn" ? console.warn : console.log;
  fn(`[ca] ${msg}`);
}
export function getLogs(): LogEntry[] {
  return LOGS.slice().reverse();
}
export function limparLogs() {
  LOGS.length = 0;
}

// ------------------- Caches do Dashboard --------------------
// O cache guarda a PROMESSA em andamento (não só o resultado): chamadas
// concorrentes (ex.: getDashboard + getEmpresaBreakdown) compartilham a
// MESMA requisição à API da Conta Azul em vez de duplicar as chamadas.
export type ItemLancamento = {
  id?: string;
  data: string;
  valor: number;
  metodo: string | null;
  conta_id?: string;
  // Nome do banco/conta financeira do titulo (preenchido a partir do
  // conta_id + mapa de contas; usado no PDF/XLSX e no filtro de bancos).
  banco?: string | null;
  descricao?: string | null;
  terceiro?: string | null;
  categoria?: string | null;
  // Valores acessorios de pagamento (juros, multa, desconto) e o valor
  // efetivamente pago (quando a API disponibiliza). Usados para nao perder
  // lancamentos com juros/multa: o campo "pago" da API pode vir com o valor
  // original do titulo, sem os acrescimos.
  juros?: number;
  multa?: number;
  desconto?: number;
  valor_pago?: number;
  // IDs para consulta de baixa (valor liquido real via valor_composicao da Conta Azul)
  baixa_id?: string;
  parcela_id?: string;
  // Valores originais brutos da API (usados internamente na enriquecimento de baixa)
  _pago?: number;
  _total?: number;
};

// Resultado de uma busca de lista (Pagos / Recebidos / A Receber / A Pagar).
// `ok` = resultado pode ser tratado como definitivo (e pode ser cacheado).
// `incompleto` = alguma pagina da API nao pôde ser lida (rate limit / rede),
// logo `dados` pode estar PARCIAL — nunca deve aparecer como total final sem
// uma nova tentativa.
export type ResultadoLista = {
  dados: ItemLancamento[];
  ok: boolean;
  incompleto?: boolean;
  // Quantos titulos ficaram SEM a baixa da parcela (a API recusou por limite
  // de taxa). Esses titulos exibem a data de VENCIMENTO e o banco vazio ate
  // a proxima carga conseguir consultar a baixa.
  sem_baixa?: number;
  // Quantos titulos NAO tem baixa na API (a parcela nunca foi baixada). Nao ha
  // data de pagamento nem banco para buscar — nao adianta repetir a consulta.
  sem_baixa_definitivo?: number;
  // Quantos titulos ainda nao foram buscados (o orcamento de tempo da funcao
  // acabou antes). Ficam para a proxima carga — o painel refaz a consulta
  // sozinho ate completar.
  baixas_pendentes?: number;
};

type EntradaCache<T> = { promessa: Promise<T>; exp: number };

const detalheCache = new Map<string, EntradaCache<{ metodo: string | null; erro: boolean }>>();
const DETALHE_TTL_MS = 5 * 60 * 1000;

const listCache = new Map<string, EntradaCache<ResultadoLista>>();
const LIST_TTL_MS = 2 * 60 * 1000; // 2 minutos de cache para listas

const saldoCache = new Map<
  string,
  EntradaCache<{ lista: { id: string; nome: string; saldo: number }[]; ok: boolean; todas: ContaSaldo[] }>
>();
const SALDO_TTL_MS = 2 * 60 * 1000; // 2 minutos de cache para saldos

// ------------------- Baixa da parcela: data REAL do pagamento -------------------
// A listagem de contas a pagar/receber traz apenas o VENCIMENTO do titulo
// (data_vencimento) — a data em que o dinheiro saiu/entrou aparece so na BAIXA
// da parcela:
//   GET /v1/financeiro/eventos-financeiros/parcelas/{parcela_id}/baixa
// A baixa traz `data_pagamento` (data real do caixa) e o `valor_composicao`
// (valor_bruto / desconto / juros / multa / valor_liquido).
//
// A baixa e imutavel depois de lancada, entao o resultado fica em cache por 12
// horas: em um mes com centenas de titulos isso evita repetir centenas de
// chamadas a cada recarga do dashboard.
//
// Duas camadas de cache:
//   1. memoria (baixaCache): rapida, mas vive so na instancia da Vercel e
//      some a cada cold start;
//   2. Supabase (tabela public.baixas_cache): sobrevive ao cold start e e
//      compartilhado entre as instancias — e o que transforma a 2a carga do
//      dia de ~2 minutos em poucos segundos.

type DadosBaixa = {
  data_pagamento: string | null;
  desconto: number;
  juros: number;
  multa: number;
  valor_bruto: number;
  valor_liquido: number;
  valor_pago: number;
  // Banco/conta financeira usada no pagamento (vem da baixa).
  banco: string | null;
  conta_id: string | null;
};

// Versao do formato guardado no cache (Supabase e memoria). Ao mudar o que e
// guardado, incremente: as linhas antigas sao ignoradas e as baixas sao
// buscadas de novo na API.
const BAIXA_CACHE_VERSAO = 2;

// Cache em memoria: guarda as BAIXAS CRUAS (array), e nao o resultado ja
// filtrado pelo periodo — assim o mesmo cache serve para qualquer intervalo
// (um titulo pode ter baixas em meses diferentes).
const baixaCache = new Map<string, { exp: number; baixas: any[] | null }>();

// TTL do cache de baixa. A baixa e IMUTAVEL (o ERP nao a altera; so e
// corrigida raramente), entao o cache pode durar bem mais que as 12 horas:
//   - titulo pago nos ultimos BAIXA_RECENTE_DIAS (o mes em andamento): TTL
//     curto — e o que ainda pode ser corrigido pela empresa;
//   - titulo de periodo ja fechado: TTL longo — depois da 1a busca o mes nao
//     e mais buscado na API (o reload passa a ser instantaneo).
const BAIXA_TTL_MS = Number(process.env.JRM_BAIXAS_TTL_HORAS || "12") * 60 * 60 * 1000;
const BAIXA_TTL_LONGO_MS =
  Number(process.env.JRM_BAIXAS_TTL_LONGO_DIAS || "30") * 24 * 60 * 60 * 1000;
const BAIXA_RECENTE_DIAS = Number(process.env.JRM_BAIXAS_RECENTE_DIAS || "7");
const BAIXA_TTL_MS_VAZIO = 60 * 1000; // erro/404 nao fica horas no cache
const CHUNK_CACHE_BANCO = 200; // ids por consulta/upsert no Supabase

// ------------------- Cache persistente do METODO de pagamento -----------------
//
// A forma de pagamento (BOLETO, DINHEIRO, PIX...) de um titulo nao muda
// depois de lancada. O cache em memoria (detalheCache, 5 min) some a cada
// cold start da Vercel: a cada nova instancia o painel refazia ~100 chamadas
// "detalhe do titulo" — e essas chamadas saiam em rajada, tomavam 429 e
// alongavam a carga para ~2 minutos.
//
// Com a tabela public.detalhes_cache o metodo sobrevive ao cold start e e
// compartilhado entre as instancias: a 2a carga do dia nao faz nenhuma
// chamada de detalhe.
//
// TTL: 12 h (o metodo e estavel; 12 h da para a empresa corrigir um lancamento
// e ainda assim nao pagar o preco de refazer as chamadas todo dia).
const DETALHE_TTL_BANCO_MS =
  Number(process.env.JRM_DETALHES_TTL_HORAS || "12") * 60 * 60 * 1000;

/**
 * TTL de uma baixa conforme a RECENCIA do pagamento: pagamento nos ultimos
 * dias usa o TTL curto (12 h); pagamento de periodo ja fechado usa o TTL
 * longo (30 dias).
 */
export function ttlDaBaixa(baixas: any[]): number {
  const limite = Date.now() - BAIXA_RECENTE_DIAS * 24 * 60 * 60 * 1000;
  for (const b of baixas) {
    const dp = typeof b?.data_pagamento === "string" ? b.data_pagamento : null;
    if (!dp) continue;
    const ts = Date.parse(`${dp}T00:00:00Z`);
    if (Number.isFinite(ts) && ts >= limite) return BAIXA_TTL_MS;
  }
  return BAIXA_TTL_LONGO_MS;
}

// ------------------- Limite de requisicoes da API (POR EMPRESA) ----------------
//
// A Conta Azul aceita 10 requisicoes por SEGUNDO POR CONTA CONECTADA:
//   "Limite de requisicoes excedido: ate 10 por segundo por conta conectada".
// Cada empresa conectada tem o seu proprio token, ou seja, a sua propria
// conta: o limite NAO e global para o app.
//
// Medido em producao (06/11/2026): 4 empresas em paralelo, 9 req/s cada
// (35,4 req/s no agregado) -> 792 chamadas com apenas 3 respostas 429 (0,4%).
// Antes o limitador era global (um unico 9 req/s para as 4 empresas), o que
// desperdicava ~75% da capacidade.
//
// IMPORTANTE: o limite vale para TODA chamada a API da empresa (baixas,
// listagens e detalhes do metodo de pagamento). Antes, a busca do metodo
// saia em rajada (4 por vez, sem limite) e tomava 429 em cima das baixas —
// era o que deixava a carga do painel levar 2 minutos.
//
// Disparando 32 chamadas em paralelo, uma parte das baixas voltava 429 e o
// titulo ficava SEM baixa: no relatorio saia a data de VENCIMENTO (errada) e
// o banco vazio ("—"). Agora as chamadas sao ESPACADAS no tempo (fila por
// tempo) e o intervalo se ajusta sozinho: um 429 dobra o intervalo, e varias
// respostas seguidas de sucesso o reduzem de volta.
const BAIXAS_POR_SEGUNDO = Number(process.env.JRM_BAIXAS_POR_SEGUNDO || "9"); // folga sobre o limite de 10
const BAIXA_INTERVALO_MIN_MS = 1000 / Math.max(1, BAIXAS_POR_SEGUNDO);
const BAIXA_INTERVALO_MAX_MS = 3000;

// Estado do limitador POR EMPRESA (cada conta conectada tem a sua propria
// cota de 10 req/s).
type EstadoLimite = { intervaloMs: number; proximoSlot: number; apos429: boolean };
const limitesApi = new Map<string, EstadoLimite>();

function estadoLimite(empresa: string): EstadoLimite {
  let e = limitesApi.get(empresa);
  if (!e) {
    e = { intervaloMs: BAIXA_INTERVALO_MIN_MS, proximoSlot: 0, apos429: false };
    limitesApi.set(empresa, e);
  }
  return e;
}

/** Espera a vez deste pedido na fila (espaca as chamadas na taxa da API). */
async function esperarVagaApi(empresa: string): Promise<void> {
  const e = estadoLimite(empresa);
  const agora = Date.now();
  const slot = Math.max(agora, e.proximoSlot);
  e.proximoSlot = slot + e.intervaloMs;
  const espera = slot - agora;
  if (espera > 0) await new Promise((r) => setTimeout(r, espera));
}

/** A API recusou por limite de taxa: aumenta o intervalo entre as chamadas. */
function apiRecebeu429(empresa: string): void {
  const e = estadoLimite(empresa);
  e.apos429 = true;
  e.intervaloMs = Math.min(e.intervaloMs * 2, BAIXA_INTERVALO_MAX_MS);
}

/** A chamada deu certo: depois de uma sequencia de acertos, alivia o intervalo. */
function apiDeuCerto(empresa: string): void {
  const e = estadoLimite(empresa);
  if (e.apos429) {
    // so alivia depois de uma sequencia de acertos (evita oscilar)
    e.apos429 = false;
    e.intervaloMs = Math.min(e.intervaloMs, BAIXA_INTERVALO_MAX_MS);
    return;
  }
  if (e.intervaloMs > BAIXA_INTERVALO_MIN_MS) {
    e.intervaloMs = Math.max(BAIXA_INTERVALO_MIN_MS, e.intervaloMs * 0.92);
  }
}

// Quantas chamadas de baixa ficam em voo ao mesmo tempo. Cada chamada leva
// ~2 s na API, entao sao necessarios ~20 em voo para sustentar 9 req/s.
const CONCORRENCIA_BAIXAS = 24;

// Janela de VENCIMENTO usada nas listagens de pagas/recebidas.
//
// A API exige data_vencimento_de/_ate mesmo quando o filtro real e por data
// de pagamento (orientacao oficial Conta Azul) — mas a janela e exatamente o
// que define o custo da listagem: com 365 dias a 1a pagina levava 3,4-5,9 s
// (medido em producao em 05/11 e 06/11/2026); com 180 dias cai para
// 0,5-0,9 s (5-10x). Os totais (`itens_totais`) foram IDENTICOS nas duas
// janelas em 5 periodos x 4 empresas (jan, abr, jul, set e nov/2026) e a API
// respeita o filtro (uma janela impossivel devolve 0 itens) — ou seja, nenhum
// titulo pago no periodo fica de fora.
const JANELA_VENCIMENTO_DIAS = Number(process.env.JRM_JANELA_VENCIMENTO_DIAS || "180");

// Orcamento de tempo da busca de baixas. A funcao da Vercel tem 60 s de
// limite (plano Hobby) e a API so aceita 10 req/s POR EMPRESA: em um mes
// grande (1.300 titulos) nao da para buscar tudo de uma vez. A busca para
// quando o orcamento acaba e o que sobrou fica para a proxima carga — o
// cache no Supabase garante que cada carga avanca (e o painel refaz a
// consulta sozinho).
let prazoBaixasMs = Number(process.env.JRM_PRAZO_BAIXAS_MS || "42000");

/** Ajusta o orcamento de tempo da busca de baixas (usado pelo pre-aquecimento). */
export function definirPrazoBaixas(ms: number): void {
  prazoBaixasMs = Math.max(1000, ms);
}

// Refresh FORCADO das baixas: quando ligado, o cache (memoria e Supabase) e
// ignorado e a baixa e buscada de novo na API. E o que o pre-aquecimento usa
// no mes EM ANDAMENTO.
//
// Motivo (medido em 07/11/2026): o TTL das baixas recentes e de 12 h, mas o
// painel e usado no fim da tarde (escritas no cache as 18:55 UTC). O cron de
// pre-aquecimento rodava as 03:30 UTC — ANTES dessas entradas vencerem (so
// vencem as 06:55 UTC) — entao encontrava tudo "fresco" e nao renovava nada:
// a primeira carga do dia seguinte pagava a API inteira (~28 s). Forcando o
// refresh no mes corrente, o cron sempre renova o que o usuario vai ver.
let forcarRefreshBaixas = false;

/** Liga/desliga o refresh forcado das baixas (usado pelo pre-aquecimento). */
export function definirForcarRefreshBaixas(valor: boolean): void {
  forcarRefreshBaixas = valor;
}

// Quando o cache do Supabase falha (tabela ainda nao criada, sem permissao,
// Supabase fora do ar), nao insistir a cada requisição: espera 30 min.
let cacheBancoIndisponivelAte = 0;

// O mesmo para o cache de DETALHES (metodo de pagamento), mas separado: se a
// tabela `detalhes_cache` ainda nao existir, o cache de BAIXAS (que e o
// critico para as datas) continua funcionando normalmente.
let cacheDetalhesIndisponivelAte = 0;

// Modo de exibicao do valor do titulo:
//   "face"   = valor cheio do titulo (valor_bruto da baixa)
//   "liquido" = o que saiu/entrou no caixa (valor_bruto - desconto + juros + multa)
// Confirmado pelo usuario: o card e o PDF usam o valor LIQUIDO (com o desconto
// da Conta Azul aplicado) tanto nas contas pagas quanto nas recebidas.
const VALOR_PAGAS: "face" | "liquido" = "liquido";
const VALOR_RECEBIDAS: "face" | "liquido" = "liquido";

// Lê o cache ou dispara a criação; chamadas concorrentes recebem a MESMA promise.
// Resultados marcados como não utilizáveis (ok=false / erro=true) são removidos.
function lerOuCriar<T>(
  cache: Map<string, EntradaCache<T>>,
  key: string,
  ttlMs: number,
  criar: () => Promise<T>,
  manter: (r: T) => boolean,
): Promise<T> {
  const agora = Date.now();
  const atual = cache.get(key);
  if (atual && atual.exp > agora) return atual.promessa;
  const promessa = criar();
  cache.set(key, { promessa, exp: agora + ttlMs });
  promessa
    .then((r) => {
      if (!manter(r)) cache.delete(key);
    })
    .catch(() => cache.delete(key));
  return promessa;
}

export function limparCacheDetalhes() {
  detalheCache.clear();
  listCache.clear();
  saldoCache.clear();
  log("info", "cache de detalhes, listas e saldos limpo");
}

// ------------------- Retry helper ------------------------------------
//
// `empresa` (opcional) e a chave da COTA da API: quando informado, TODA
// tentativa passa pelo mesmo limitador por empresa (10 req/s por conta
// conectada) das buscas de baixa. Sem isso, a busca do metodo de pagamento
// saia em rajada e tomava 429 em cima das baixas — era o que deixava a
// carga do painel levar 2 minutos.
async function fetchComRetry(
  url: string,
  init: RequestInit,
  tentativas = 5,
  empresa?: string,
): Promise<Response> {
  let ultErro: any = null;
  for (let i = 0; i < tentativas; i++) {
    try {
      // Fila por tempo: respeita o limite de 10 req/s da API (POR EMPRESA).
      if (empresa) await esperarVagaApi(empresa);
      const r = await fetch(url, init);
      // 429 / 5xx: retry com backoff
      if (r.status === 429 || (r.status >= 500 && r.status < 600)) {
        if (empresa) apiRecebeu429(empresa);
        if (i < tentativas - 1) {
          let espera = 300 * Math.pow(2, i);
          const retryAfter = r.headers.get("retry-after");
          if (retryAfter) {
            const segundos = parseInt(retryAfter, 10);
            if (!isNaN(segundos) && segundos > 0) {
              espera = segundos * 1000;
            }
          } else if (r.status === 429) {
            espera = 1000 * Math.pow(2, i);
          }
          log("warn", `retry ${i + 1}/${tentativas} ${r.status} em ${url.slice(0, 120)} (espera ${espera}ms)`);
          await new Promise((res) => setTimeout(res, espera));
          continue;
        }
      }
      // Resposta boa (inclusive 4xx definitivo): alivia o intervalo.
      if (empresa) apiDeuCerto(empresa);
      return r;
    } catch (e) {
      ultErro = e;
      if (i < tentativas - 1) {
        const espera = 300 * Math.pow(2, i);
        log("warn", `retry ${i + 1}/${tentativas} erro rede ${String(e).slice(0, 100)} (espera ${espera}ms)`);
        await new Promise((res) => setTimeout(res, espera));
        continue;
      }
    }
  }
  if (ultErro) throw ultErro;
  // não deveria chegar aqui
  return fetch(url, init);
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

// Numero de vezes que a paginacao de uma lista (Pagos/Recebidos) pode ser
// REINICIADA do zero quando uma pagina falha no meio. A API da Conta Azul derruba
// paginas intermediarias com rate limit; sem isto a busca parava na pagina com
// erro e devolvia so o que ja tinha lido — o card "Contas Pagas" mostrava um
// total menor no carregamento automatico e o total certo quando o usuario clicava
// em Recarregar (que limpa o cache e refaz tudo).
//
// 2 passagens + 2 tentativas por pagina limita o pior caso a ~9s; se ainda assim
// ficar incompleto, o resultado nao e cacheado e a TELA refaz a consulta sozinha
// (ver "dados_incompletos" em getDashboard), quando o limite da API ja passou.
const MAX_PASSES_PAGINACAO = 2;

// Busca UMA pagina da listagem, com retries, backoff e renovacao de token.
//
// Devolve a resposta quando ela veio com sucesso OU com um ERRO DEFINITIVO
// (4xx fora de 401/429 — ex.: um status que esta conta nao aceita, que nao vai
// passar repetindo). Devolve `null` quando esgotou as tentativas em erro
// TRANSITORIO (429 / 5xx / rede) — nesse caso quem chama reinicia a
// paginacao inteira.
//
// DIFERENTE do `if (!res.ok) break` de antes: aqui uma falha transitória de uma
// pagina nunca e tratada como "acabaram os dados". A paginacao so termina de
// verdade quando a API devolve uma pagina com menos itens que o tamanho da pagina.
async function fetchPaginaRobusta(
  empresa: string,
  url: string,
  tokenRef: { token: string },
): Promise<Response | null> {
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    let res: Response;
    try {
      // 2 tentativas internas: cobre 429/5xx/rede com backoff (retry-after respeitado).
      // Mantidas baidas de proposito: quem re-tenta de verdade e o repasse da
      // paginacao e, depois, a refetch automatica da tela.
      res = await fetchComRetry(
        url,
        { headers: { Authorization: `Bearer ${tokenRef.token}` } },
        2,
        empresa,
      );
    } catch (e) {
      log("warn", `fetchPagina ${empresa} falha de rede (tentativa ${tentativa}/2): ${String(e).slice(0, 100)}`);
      await sleep(1200);
      continue;
    }

    if (res.status === 401) {
      const novo = await renovarToken(empresa);
      if (novo) tokenRef.token = novo;
      await sleep(300);
      continue;
    }

    if (res.ok) return res;

    const transitorio = res.status === 429 || res.status >= 500;
    if (!transitorio) {
      log("warn", `fetchPagina ${empresa} erro definitivo status=${res.status} (nao sera repetido)`);
      return res;
    }

    log("warn", `fetchPagina ${empresa} status=${res.status} transitorio (tentativa ${tentativa}/2)`);
    await sleep(1200);
  }
  return null;
}

// Busca TODAS as paginas de uma listagem em PARALELO.
//
// A primeira pagina devolve `itens_totais`, que informa quantas paginas
// existem. Antes as paginas eram buscadas uma a uma (com 150 ms de espera
// entre elas): no periodo de outubro, com ~660 titulos pagos da LGP, isso
// levava ~7 s so de listagem. Agora as paginas restantes sao buscadas 3 por
// vez, cortando esse tempo pela metade ou mais.
//
// Mantem o retry robusto por pagina (fetchPaginaRobusta): erro transitorio
// (429/5xx/rede) devolve `falhou` para o chamador reiniciar a paginacao
// inteira; erro definitivo (4xx fora de 401/429) devolve `erroDefinitivo`.
const TAMANHO_PAGINA_LISTAGEM = 100;

async function listarTodasPaginas(
  empresa: string,
  urlDaPagina: (pagina: number) => string,
  tokenRef: { token: string },
): Promise<{ itens: any[]; falhou: boolean; erroDefinitivo: boolean; paginas: number }> {
  const CONCORRENCIA = 3;

  async function buscarPagina(pagina: number) {
    const res = await fetchPaginaRobusta(empresa, urlDaPagina(pagina), tokenRef);
    if (res === null) {
      return { pagina, itens: [] as any[], itensTotais: 0, falhou: true, erroDefinitivo: false };
    }
    if (!res.ok) {
      return { pagina, itens: [] as any[], itensTotais: 0, falhou: false, erroDefinitivo: true };
    }
    try {
      const j: any = await res.json();
      const itensPagina: any[] = j.itens || (Array.isArray(j) ? j : []);
      return {
        pagina,
        itens: itensPagina,
        itensTotais: Number(j.itens_totais || 0),
        falhou: false,
        erroDefinitivo: false,
      };
    } catch {
      return { pagina, itens: [] as any[], itensTotais: 0, falhou: true, erroDefinitivo: false };
    }
  }

  const primeira = await buscarPagina(1);
  if (primeira.falhou) return { itens: [], falhou: true, erroDefinitivo: false, paginas: 0 };
  if (primeira.erroDefinitivo) return { itens: [], falhou: false, erroDefinitivo: true, paginas: 0 };

  const itens: any[] = [...primeira.itens];
  let falhou = false;
  let erroDefinitivo = false;
  let ultimaPagina = 1;
  let ultimaQtd = primeira.itens.length;

  // Quantas paginas existem: `itens_totais` da primeira resposta.
  const paginasPrevistas =
    primeira.itensTotais > 0 ? Math.ceil(primeira.itensTotais / TAMANHO_PAGINA_LISTAGEM) : 1;

  // Busca as paginas restantes EM PARALELO (3 por vez).
  const restantes: number[] = [];
  for (let p = 2; p <= paginasPrevistas; p++) restantes.push(p);

  for (let i = 0; i < restantes.length; i += CONCORRENCIA) {
    const lote = restantes.slice(i, i + CONCORRENCIA);
    const respostas = await Promise.all(lote.map((p) => buscarPagina(p)));
    // Promise.all preserva a ordem do lote: os titulos continuam em ordem de
    // pagina (cronologica, como a API devolve).
    for (const r of respostas) {
      if (r.falhou) falhou = true;
      if (r.erroDefinitivo) erroDefinitivo = true;
      itens.push(...r.itens);
      ultimaPagina = Math.max(ultimaPagina, r.pagina);
      ultimaQtd = r.itens.length;
    }
    if (falhou || erroDefinitivo) break;
  }

  // Cauda adaptativa: so entra quando a API NAO informa `itens_totais` —
  // nesse caso a unica fonte de verdade e a pagina que vem incompleta.
  // (quando o total e informado, buscar paginas extras alem dele traria
  // duplicatas, porque a API repete a ultima pagina em vez de devolver uma
  // pagina vazia).
  if (primeira.itensTotais === 0 && !falhou && !erroDefinitivo) {
    let extras = 0;
    while (ultimaQtd >= TAMANHO_PAGINA_LISTAGEM && extras < 50) {
      extras++;
      const r = await buscarPagina(ultimaPagina + 1);
      // Pagina fora do range: a API responde vazio ou com erro — fim da lista.
      if (r.falhou || r.erroDefinitivo || r.itens.length === 0) break;
      itens.push(...r.itens);
      ultimaPagina = r.pagina;
      ultimaQtd = r.itens.length;
    }
  }

  return { itens, falhou, erroDefinitivo, paginas: ultimaPagina };
}

// Deduplica refreshes concorrentes por empresa (evita invalidar refresh_token rotacionado)
const refreshEmAndamento = new Map<string, Promise<string | null>>();

async function executarRefresh(empresa: string): Promise<string | null> {
  const sb = getSupabase();
  const { data } = await sb
    .from("tokens")
    .select("refresh_token,access_token,updated_at,expires_at")
    .eq("empresa", empresa)
    .limit(1);
  if (!data || !data.length) return null;
  const refresh = data[0].refresh_token;

  if (data[0].updated_at) {
    const idadeMs = Date.now() - new Date(data[0].updated_at).getTime();
    if (idadeMs < 30_000 && data[0].access_token) return data[0].access_token;
  }

  // Lock distribuído: evita renovacoes concorrentes entre instancias serverless.
  const lockedBy = `${crypto.randomUUID()}-${Date.now()}`;
  const lockObtido = await tentarObterLock(empresa, lockedBy);
  if (!lockObtido) {
    log("warn", `refresh ja em andamento por outra instancia: ${empresa}`);
    return null;
  }

  try {
    log("info", `renovando token: ${empresa}`);
    const res = await pedirToken({
      grant_type: "refresh_token",
      refresh_token: refresh,
    });

    if (res.ok) {
      const j: any = await res.json();
      const agora = new Date().toISOString();
      const expiresIn = j.expires_in ? j.expires_in * 1000 : 3600 * 1000;
      const expiresAt = new Date(Date.now() + expiresIn).toISOString();

      await sb
        .from("tokens")
        .update({
          access_token: j.access_token,
          refresh_token: j.refresh_token,
          status: "ATIVO",
          mensagem_erro: null,
          expires_at: expiresAt,
          updated_at: agora,
        })
        .eq("empresa", empresa);
      log("info", `token renovado: ${empresa}`);
      await gravarLogEvento({
        empresa,
        evento: "token_renovado",
        acao_necessaria: null,
      });
      return j.access_token;
    }

    const txt = await res.text();
    const corpoLower = txt.toLowerCase();

    // Falha definitiva: acesso revogado ou refresh token invalido/inexistente.
    // Nao ha reativacao automatica: e necessario reconectar via OAuth.
    const ehDefinitivo =
      res.status === 400 &&
      (corpoLower.includes("access_revoked") ||
        corpoLower.includes("invalid_refresh_token") ||
        corpoLower.includes("invalid_grant"));

    // Falha por credenciais do aplicativo (invalid_client): nao e problema da empresa.
    const ehInvalidoClient = corpoLower.includes("invalid_client");

    if (ehDefinitivo) {
      await sb
        .from("tokens")
        .update({
          status: "ERRO",
          mensagem_erro: `Token revogado: ${res.status} ${txt.slice(0, 300)}`,
          updated_at: new Date().toISOString(),
        })
        .eq("empresa", empresa);
      log("error", `token revogado: ${empresa} -> ${txt.slice(0, 300)}`);
      await gravarLogEvento({
        empresa,
        evento: "token_revogado",
        erro: txt.slice(0, 300),
        acao_necessaria: "reconectar_via_oauth",
      });
      await enviarAlertaSlack(
        empresa,
        "token_revogado",
        txt.slice(0, 200),
        "Reconectar a empresa via botao 'Conectar Conta Azul'",
      );
      return null;
    }

    if (ehInvalidoClient) {
      await sb
        .from("tokens")
        .update({
          status: "ERRO",
          mensagem_erro: `Credenciais do aplicativo invalidas: ${res.status} ${txt.slice(0, 300)}`,
          updated_at: new Date().toISOString(),
        })
        .eq("empresa", empresa);
      log("error", `client invalido: ${empresa} -> ${txt.slice(0, 300)}`);
      await gravarLogEvento({
        empresa,
        evento: "client_invalido",
        erro: txt.slice(0, 300),
        acao_necessaria: "verificar_CONTA_AZUL_CLIENT_ID_SECRET_na_Vercel",
      });
      await enviarAlertaSlack(
        empresa,
        "client_invalido",
        txt.slice(0, 200),
        "Verificar variaveis CONTA_AZUL_CLIENT_ID e CONTA_AZUL_CLIENT_SECRET na Vercel",
      );
      return null;
    }

    // Falha transitória (rede, 429, 5xx): nao marca ERRO, apenas avisa.
    log("warn", `refresh falhou (transitório): ${empresa} ${res.status}`);
    await gravarLogEvento({
      empresa,
      evento: "refresh_transitorio",
      erro: `${res.status} ${txt.slice(0, 200)}`,
      acao_necessaria: "tentar_novamente_em_alguns_minutos",
    });
    return null;
  } finally {
    await liberarLock(empresa);
  }
}

export async function renovarToken(empresa: string): Promise<string | null> {
  const emAndamento = refreshEmAndamento.get(empresa);
  if (emAndamento) return emAndamento;
  const p = executarRefresh(empresa).finally(() => {
    refreshEmAndamento.delete(empresa);
  });
  refreshEmAndamento.set(empresa, p);
  return p;
}

export async function obterToken(empresa: string): Promise<string | null> {
  const sb = getSupabase();
  const { data } = await sb
    .from("tokens")
    .select("access_token,status,expires_at")
    .eq("empresa", empresa)
    .limit(1);
  if (data && data.length) {
    const linha = data[0];
    if (linha.status === "ERRO") return renovarToken(empresa);

    // Renovacao proativa: se o access_token esta prestes a expirar (menos de 5 min),
    // renova antes de usar, evitando que o usuario veja dados zerados.
    if (linha.expires_at) {
      const agora = Date.now();
      const expiraEm = new Date(linha.expires_at).getTime();
      const margemSeguranca = 5 * 60 * 1000; // 5 minutos
      if (expiraEm - agora < margemSeguranca) {
        return renovarToken(empresa);
      }
    }

    if (linha.access_token) return linha.access_token;
  }
  return renovarToken(empresa);
}

// ------------------- Renovacao em lote (cron) -------------------
// Renova o access_token de todas as empresas cujo token esta prestes a
// expirar (ou sem registro de validade). Idempotente: rodar duas vezes ou
// perder uma execucao nao causa problema (o lock distribuido evita renovacoes
// concorrentes e o refresh ja e no-op para tokens ainda validos).
// Usado pelo cron nativo da Vercel (GET /api/cron/renovar-tokens) e pela
// server function renovarTodosTokens (chamada manual/externa).
export async function executarRenovacaoEmLote(): Promise<{
  total: number;
  renovados: number;
  falhados: number;
  detalhes: Array<{ empresa: string; acao: string }>;
}> {
  const sb = getSupabase();
  const { data: empresas } = await sb
    .from("tokens")
    .select("empresa,refresh_token,expires_at,status")
    .order("empresa");

  const resultados = await Promise.all(
    (empresas || []).map(async (emp: any) => {
      const empresa = emp.empresa as string;
      // Pula empresas que nao tem refresh_token (nao podem renovar sozinhas)
      if (!emp.refresh_token) {
        return { empresa, acao: "sem_refresh_token" };
      }

      // Se expira em mais de 10 min, nao precisa renovar agora
      if (emp.expires_at) {
        const expiraEm = new Date(emp.expires_at).getTime();
        const agora = Date.now();
        if (expiraEm - agora > 10 * 60 * 1000) {
          return { empresa, acao: "valido" };
        }
      }

      const token = await renovarToken(empresa);
      return {
        empresa,
        acao: token ? "renovado" : "falhou",
      };
    }),
  );

  const renovados = resultados.filter((r) => r.acao === "renovado").length;
  const falhados = resultados.filter((r) => r.acao === "falhou").length;

  log(
    "info",
    `renovacao em lote: ${empresas?.length ?? 0} empresas, ${renovados} renovados, ${falhados} falharam`,
  );

  return {
    total: empresas?.length ?? 0,
    renovados,
    falhados,
    detalhes: resultados,
  };
}

// ------------------- Pre-aquecimento do cache de baixas -------------------
//
// O painel so demora quando o cache NAO tem a baixa do titulo (a API da Conta
// Azul nao tem listagem em lote: e 1 chamada por parcela). Este job roda 1x
// por dia (cron da Vercel, de madrugada) e busca as baixas do mes corrente e
// do anterior em segundo plano: quando o usuario abre o painel, o cache ja
// esta pronto e a carga e instantanea.
//
// O trabalho e sempre o MESMO que o painel faria — por isso o cache fica
// igual (e o resultado e o mesmo). A diferenca e QUANDO ele acontece: de
// madrugada, sem ninguem esperando.

/** Periodos (meses) cobertos pelo pre-aquecimento: mes atual e anteriores. */
function periodosDoPreAquecimento(quantos: number): { ini: string; fim: string }[] {
  const out: { ini: string; fim: string }[] = [];
  const hoje = new Date();
  for (let k = 0; k < quantos; k++) {
    const ini = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - k, 1));
    const fim = new Date(Date.UTC(ini.getUTCFullYear(), ini.getUTCMonth() + 1, 0));
    out.push({
      ini: ini.toISOString().slice(0, 10),
      fim: fim.toISOString().slice(0, 10),
    });
  }
  return out;
}

export async function preAquecerBaixas(opcoes?: {
  meses?: number;
  orcamentoMs?: number;
}): Promise<{
  empresas: number;
  periodos: number;
  orcamentoMs: number;
  resumo: Array<{
    empresa: string;
    periodo: string;
    pagas: number;
    recebidas: number;
    pendentes: number;
    sem_baixa: number;
  }>;
}> {
  const meses = Math.max(1, opcoes?.meses ?? Number(process.env.JRM_PREAQUECER_MESES || "2"));
  const orcamentoMs = Math.max(
    5000,
    opcoes?.orcamentoMs ?? Number(process.env.JRM_PREAQUECER_ORCAMENTO_MS || "40000"),
  );
  const sb = getSupabase();
  const { data: linhas } = await sb.from("tokens").select("empresa").neq("status", "ERRO");
  const empresas = [
    ...new Set((linhas || []).map((l: any) => l.empresa as string).filter(Boolean)),
  ];
  const periodos = periodosDoPreAquecimento(meses);
  const fim = Date.now() + orcamentoMs;

  // Dentro do cron a funcao tem 60 s de limite: a busca de baixas de cada
  // empresa para antes disso (e o que sobrou fica para a proxima execucao — o
  // cache no Supabase guarda o que ja foi buscado).
  const prazoOriginal = prazoBaixasMs;
  definirPrazoBaixas(Math.min(prazoOriginal, Math.max(5000, orcamentoMs - 15000)));
  const resumo: Array<{
    empresa: string;
    periodo: string;
    pagas: number;
    recebidas: number;
    pendentes: number;
    sem_baixa: number;
  }> = [];

  try {
    // Cada empresa tem a SUA cota de 9 req/s (o limitador e por empresa), por
    // isso as empresas sao processadas em PARALELO.
    //
    // Fase 1 — mes EM ANDAMENTO (periodos[0]): as baixas sao buscadas de novo
    // na API mesmo que ainda estejam no cache (refresh forcado). E o que o
    // usuario vai ver: sem isso o cron pode rodar antes do TTL de 12 h vencer
    // e nao renovar nada (medido em 07/11/2026).
    const processarPeriodo = async (emp: string, p: { ini: string; fim: string }) => {
      if (Date.now() >= fim) return;
      const [pagas, recebidas] = await Promise.all([
        buscarPagas(emp, p.ini, p.fim),
        buscarRecebidas(emp, p.ini, p.fim),
      ]);
      resumo.push({
        empresa: emp,
        periodo: `${p.ini}..${p.fim}`,
        pagas: pagas.dados.length,
        recebidas: recebidas.dados.length,
        pendentes: (pagas.baixas_pendentes || 0) + (recebidas.baixas_pendentes || 0),
        sem_baixa: (pagas.sem_baixa || 0) + (recebidas.sem_baixa || 0),
      });
    };

    definirForcarRefreshBaixas(true);
    try {
      const mesCorrente = periodos[0];
      if (mesCorrente) {
        await Promise.all(empresas.map((emp) => processarPeriodo(emp, mesCorrente)));
      }
    } finally {
      definirForcarRefreshBaixas(false);
    }

    // Fase 2 — meses ja fechados: o TTL delas e longo (30 dias) e o cache
    // precisa ser apenas preenchido, nao renovado.
    for (const p of periodos.slice(1)) {
      await Promise.all(empresas.map((emp) => processarPeriodo(emp, p)));
    }
  } finally {
    definirPrazoBaixas(prazoOriginal);
    definirForcarRefreshBaixas(false);
  }

  const pendentesTotal = resumo.reduce((s, r) => s + r.pendentes, 0);
  log(
    "info",
    `pre-aquecimento: ${empresas.length} empresa(s), ${resumo.length} periodo(s), ${pendentesTotal} baixa(s) ainda pendente(s)`,
  );

  return { empresas: empresas.length, periodos: periodos.length, orcamentoMs, resumo };
}

// Uma conta financeira retornada pela API da Conta Azul, com o motivo de ela
// potencialmente nao aparecer no painel (saldo zerado ou falha ao buscar saldo).
export type ContaSaldo = { id: string; nome: string; saldo: number; erro: boolean };

export async function buscarSaldos(
  empresa: string,
  tokenInicial: string,
): Promise<{ lista: { id: string; nome: string; saldo: number }[]; ok: boolean; todas: ContaSaldo[] }> {
  const r = await lerOuCriar(
    saldoCache,
    empresa,
    SALDO_TTL_MS,
    () => buscarSaldosInterna(empresa, tokenInicial),
    (x) => x.ok,
  );
  return { lista: r.lista, ok: r.ok, todas: r.todas };
}

// Lista TODAS as contas financeiras da empresa, paginando. A API da Conta Azul
// usa tamanho_pagina=10 POR PADRAO em /v1/conta-financeira — sem este loop, só
// as 10 primeiras contas chegavam ao dashboard e as demais sumiam silenciosamente.
async function listarContasFinanceiras(
  empresa: string,
  tokenInicial: string,
): Promise<{ ok: boolean; contas: any[]; token: string }> {
  let token = tokenInicial;
  const contas: any[] = [];
  let pagina = 1;
  let totais = Number.POSITIVE_INFINITY;
  let jaRenovou = false;
  let algumaPaginaOk = false;

  while (pagina <= 50 && contas.length < totais) {
    const res = await fetchComRetry(
      `https://api-v2.contaazul.com/v1/conta-financeira?pagina=${pagina}&tamanho_pagina=100`,
      { headers: { Authorization: `Bearer ${token}` } },
      5,
      empresa,
    );

    // Token expirado no meio da paginacao: renova uma vez e refaz a pagina.
    if (res.status === 401 && !jaRenovou) {
      const novo = await renovarToken(empresa);
      if (!novo) break;
      token = novo;
      jaRenovou = true;
      continue;
    }

    if (!res.ok) {
      log("warn", `buscarSaldos contas ${empresa} status=${res.status} pg=${pagina}`);
      break;
    }

    const j: any = await res.json();
    const itens: any[] = Array.isArray(j) ? j : j.itens || [];
    algumaPaginaOk = true;
    contas.push(...itens);
    if (typeof j?.itens_totais === "number") totais = j.itens_totais;
    if (!itens.length) break;
    pagina++;
  }

  return { ok: algumaPaginaOk, contas, token };
}

async function buscarSaldosInterna(
  empresa: string,
  tokenInicial: string,
): Promise<{ lista: { id: string; nome: string; saldo: number }[]; ok: boolean; todas: ContaSaldo[] }> {
  const lista: { id: string; nome: string; saldo: number }[] = [];
  const todas: ContaSaldo[] = [];

  const { ok, contas, token } = await listarContasFinanceiras(empresa, tokenInicial);
  if (!ok) {
    log("warn", `buscarSaldos ${empresa} nao foi possivel listar contas financeiras`);
    return { lista, ok: false, todas };
  }

  // Busca o saldo de cada conta financeira.
  //
  // IMPORTANTE: cada chamada passa pelo MESMO limitador por empresa das
  // demais (10 req/s por conta conectada). Antes estas chamadas saiam com
  // `fetch` cru e furavam a fila: a LGP tem 25 contas e a Juvenal 17 — ou
  // seja, ~3,75 req/s extras por empresa, o que estourava a cota da API e
  // fazia as buscas de baixa/detalhe tomarem 429 (e a carga do painel
  // demorar 2 minutos).
  //
  // O trabalho acontece em uma "esteira" de 8 chamadas em voo: cada uma
  // espera sua vez no limitador, o que mantem a taxa em ~9 req/s sem parar
  // (com lotes fixos, a esteira parava a cada lote, esperando a chamada
  // mais lenta).
  async function buscarSaldoDaConta(c: any): Promise<ContaSaldo> {
    const id = String(c.id ?? "");
    // Retry especifico para saldo: tenta ate 3 vezes qualquer erro de rede/status
    let ultimaResp: Response | null = null;
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      try {
        // Fila por tempo: respeita o limite de 10 req/s da API (POR EMPRESA).
        await esperarVagaApi(empresa);
        const r = await fetch(
          `https://api-v2.contaazul.com/v1/conta-financeira/${c.id}/saldo-atual`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        ultimaResp = r;
        if (r.ok) {
          apiDeuCerto(empresa);
          break; // sucesso, para o retry
        }
        // 429/5xx: espera e tenta de novo
        if (r.status === 429 || (r.status >= 500 && r.status < 600)) {
          apiRecebeu429(empresa);
          const espera = 600 * Math.pow(2, tentativa);
          await new Promise((res) => setTimeout(res, espera));
          continue;
        }
        // Outros erros (ex: 400/3039 da Conta Azul): tenta mais uma vez com delay curto
        apiDeuCerto(empresa);
        await new Promise((res) => setTimeout(res, 400));
      } catch {
        await new Promise((res) => setTimeout(res, 400 * (tentativa + 1)));
      }
    }
    const r = ultimaResp;
    if (r && r.ok) {
      const sj: any = await r.json();
      return {
        id,
        nome: String(c.nome ?? "").trim(),
        saldo: (sj.saldo_atual as number) || 0,
        erro: false,
      };
    }
    log(
      "warn",
      `buscarSaldos saldo-atual falhou apos tentativas: ${empresa} / ${c.nome} status=${r?.status ?? "erro rede"}`,
    );
    return { id, nome: String(c.nome ?? "").trim(), saldo: 0, erro: true };
  }

  const emVoo = Math.min(8, Math.max(1, contas.length));
  let proxima = 0;
  await Promise.all(
    Array.from({ length: emVoo }, async () => {
      while (true) {
        const i = proxima++;
        if (i >= contas.length) return;
        const res = await buscarSaldoDaConta(contas[i]);
        todas.push(res);
        if (!res.erro) lista.push({ id: res.id, nome: res.nome, saldo: res.saldo });
      }
    }),
  );

  return { lista, ok: true, todas };
}

function extrairMetodo(j: any): string | null {
  if (!j) return null;

  // CONFORME DOCUMENTAÇÃO CONTA AZUL: verificar itens.forma_pagamento
  // Valor para boleto: BOLETO_BANCARIO
  
  // 1. Campo forma_pagamento direto (string)
  if (typeof j.forma_pagamento === "string" && j.forma_pagamento?.trim()) {
    return j.forma_pagamento.trim();
  }
  
  // 2. Se forma_pagamento é objeto, extrai tipo/nome
  if (j.forma_pagamento && typeof j.forma_pagamento === "object") {
    const tipo = j.forma_pagamento.tipo || j.forma_pagamento.nome;
    if (typeof tipo === "string" && tipo?.trim()) {
      return tipo.trim();
    }
  }

  // 3. Campos alternativos (compatibilidade com outras estruturas)
  const campos = [
    j.metodo_pagamento,
    j.tipo_pagamento,
    j.meio_pagamento,
    j.payment_method,
  ];
  
  for (const campo of campos) {
    if (typeof campo === "string" && campo?.trim()) {
      return campo.trim();
    }
    if (campo && typeof campo === "object") {
      const s = campo.tipo || campo.nome || campo.type;
      if (typeof s === "string" && s?.trim()) {
        return s.trim();
      }
    }
  }

  // 4. Busca em estruturas aninhadas (cobranca, parcelas, baixas)
  const estruturas = [
    j.cobranca,
    j.parcelas?.[0],
    j.baixas?.[0],
    j.cobrancas?.[0],
  ];
  
  for (const est of estruturas) {
    if (est && typeof est === "object") {
      if (typeof est.forma_pagamento === "string" && est.forma_pagamento?.trim()) {
        return est.forma_pagamento.trim();
      }
      // Se for objeto, extrai tipo/nome
      if (est.forma_pagamento && typeof est.forma_pagamento === "object") {
        const s = est.forma_pagamento.tipo || est.forma_pagamento.nome;
        if (typeof s === "string" && s?.trim()) {
          return s.trim();
        }
      }
    }
  }

  // 5. Busca recursiva profunda por forma_pagamento
  function buscaRecursiva(obj: any, prof = 0): string | null {
    if (prof > 8 || !obj || typeof obj !== "object") return null;
    
    // Verifica campo forma_pagamento neste nível
    if (typeof obj.forma_pagamento === "string" && obj.forma_pagamento?.trim()) {
      return obj.forma_pagamento.trim();
    }
    
    // Busca recursivamente em valores
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (v && typeof v === "object") {
        // Em arrays, only primeiro elemento
        if (Array.isArray(v) && v.length > 0) {
          const res = buscaRecursiva(v[0], prof + 1);
          if (res) return res;
        } else if (!Array.isArray(v)) {
          const res = buscaRecursiva(v, prof + 1);
          if (res) return res;
        }
      }
    }
    return null;
  }
  
  const metodo = buscaRecursiva(j);
  if (metodo) return metodo;

  // 6. Fallback final: detecta BOLETO se houver em qualquer string
  function detectaBoleto(obj: any, prof = 0): boolean {
    if (prof > 8 || !obj || typeof obj !== "object") return false;
    
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (typeof v === "string" && v && v.toUpperCase().includes("BOLETO")) {
        return true;
      }
      if (v && typeof v === "object") {
        if (Array.isArray(v)) {
          for (const item of v) {
            if (detectaBoleto(item, prof + 1)) return true;
          }
        } else {
          if (detectaBoleto(v, prof + 1)) return true;
        }
      }
    }
    return false;
  }
  
  if (detectaBoleto(j)) return "BOLETO_BANCARIO";

  return null;
}

// Extrai nome de cliente/fornecedor (varias estruturas possíveis da API)
function extrairTerceiro(j: any): string | null {
  if (!j) return null;
  const candidatos = [
    j.cliente,
    j.cliente_nome,
    j.nome_cliente,
    j.fornecedor,
    j.fornecedor_nome,
    j.nome_fornecedor,
    j.terceiro,
    j.pessoa,
    j.nome_pessoa,
    j.contato,
  ];
  for (const c of candidatos) {
    if (typeof c === "string" && c.trim()) return c.trim();
    if (c && typeof c === "object") {
      const nome = c.nome || c.nome_razao || c.razao_social || c.name;
      if (typeof nome === "string" && nome.trim()) return nome.trim();
    }
  }
  return null;
}

// Extrai descrição/histórico do título
function extrairDescricao(j: any): string | null {
  if (!j) return null;
  const campos = [
    j.descricao,
    j.descricao_titulo,
    j.historico,
    j.historico_movimentacao,
    j.nome,
    j.titulo,
  ];
  for (const c of campos) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

// Extrai a(s) categoria(s) financeira(s) do título.
// Os endpoints "eventos-financeiros/.../buscar" (receber e pagar) devolvem
// `itens.categorias = [{ id, nome }]`. Já o endpoint de parcelas
// ("/v1/financeiro/contas-a-pagar", usado nas PAGAS) traz a categoria dentro do
// rateio do evento: `evento.rateio = [{ id_categoria, nome_categoria }]`.
// Então cobrimos as duas estruturas (e variantes simples) sem quebrar se algo
// mudar: o que não vier, fica null e a coluna sai em branco.
export function extrairCategoria(j: any): string | null {
  if (!j) return null;

  const nomes: string[] = [];
  const add = (v: any) => {
    if (typeof v === "string" && v.trim()) {
      const n = v.trim();
      if (!nomes.includes(n)) nomes.push(n);
    }
  };

  // [{ nome }] | ["A", "B"]
  if (Array.isArray(j.categorias)) {
    for (const c of j.categorias) {
      if (typeof c === "string") add(c);
      else if (c && typeof c === "object") add(c.nome || c.nome_categoria || c.name);
    }
  }

  // categoria: "X" | { nome: "X" }
  add(j.categoria);
  if (j.categoria && typeof j.categoria === "object") {
    add(j.categoria.nome || j.categoria.nome_categoria || j.categoria.name);
  }
  add(j.nome_categoria);
  add(j.categorias_nome);

  // rateio (direto ou dentro do evento)
  const rateios = Array.isArray(j.rateio)
    ? j.rateio
    : Array.isArray(j.evento?.rateio)
      ? j.evento.rateio
      : [];
  for (const r of rateios) {
    if (r && typeof r === "object") add(r.nome_categoria || r.nome);
  }

  return nomes.length ? nomes.join(" / ") : null;
}

// Extrai um numero de um dos campos candidatos (numerico ou string "1.234,56").
// Busca recursivamente em qualquer nivel aninhado do objeto (evento, baixas,
// parcelas, rateio, valor_composicao, composicao_valor etc.).
// Retorna 0 se nada for encontrado.
function extrairNumero(j: any, ...campos: string[]): number {
  if (!j) return 0;

  // Campos raiz
  for (const c of campos) {
    const v = j[c];
    if (typeof v === "number" && !isNaN(v)) return v;
    if (typeof v === "string") {
      const n = Number(v.replace(/[^0-9,-]/g, "").replace(",", "."));
      if (!isNaN(n)) return n;
    }
  }

  // Busca recursiva em objetos aninhados (limite de profundidade para evitar loop)
  const visitado = new Set<any>();
  function buscar(obj: any, profundidade: number): number {
    if (!obj || typeof obj !== "object" || profundidade > 6 || visitado.has(obj))
      return 0;
    visitado.add(obj);

    for (const c of campos) {
      const v = obj[c];
      if (typeof v === "number" && !isNaN(v)) return v;
      if (typeof v === "string") {
        const n = Number(v.replace(/[^0-9,-]/g, "").replace(",", "."));
        if (!isNaN(n)) return n;
      }
    }

    // Se for string, tenta interpretar como JSON (pode ser valor_composicao serializado)
    if (typeof obj === "string") {
      try {
        const parse = JSON.parse(obj);
        const r = buscar(parse, profundidade + 1);
        if (r !== 0) return r;
      } catch {
        // nao e JSON valido, ignora
      }
    }

    for (const k of Object.keys(obj)) {
      const r = buscar(obj[k], profundidade + 1);
      if (r !== 0) return r;
    }
    return 0;
  }

  return buscar(j, 0);
}

// Extrai o id da conta financeira (banco) do titulo. A API usa nomes
// diferentes conforme o endpoint: na lista de titulos vem em
// `conta_financeira_id`; no endpoint de parcelas (contas a pagar/receber
// baixadas) o vinculo com o banco costuma estar dentro de `evento`.
export function extrairContaId(j: any): string | undefined {
  if (!j) return undefined;
  const candidatos = [
    j.conta_financeira_id,
    j.conta_id,
    j.evento?.conta_financeira_id,
    j.evento?.conta_id,
    j.evento?.conta?.id,
    j.baixas?.[0]?.conta_financeira_id,
    j.baixas?.[0]?.conta_id,
    j.parcelas?.[0]?.conta_financeira_id,
    j.parcelas?.[0]?.conta_id,
  ];
  for (const c of candidatos) {
    if (c === undefined || c === null || c === "") continue;
    return String(c);
  }
  return undefined;
}

// Mapa conta_id -> nome do banco, para saber de qual banco veio cada titulo.
export function mapaContaParaBanco(
  contas: { id?: string; nome: string }[],
): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const c of contas ?? []) {
    if (c?.id) mapa.set(String(c.id), c.nome);
  }
  return mapa;
}

// Preenche o nome do BANCO de cada titulo (a partir do conta_id e do mapa de
// contas financeiras). Titulo sem conta ou com conta fora do mapa fica sem
// banco (mostra "—" no relatorio).
export function aplicarBancoAosTitulos(
  itens: ItemLancamento[],
  contaParaBanco: Map<string, string>,
): ItemLancamento[] {
  if (!contaParaBanco || contaParaBanco.size === 0) return itens;
  for (const i of itens ?? []) {
    // Banco que ja veio da baixa (conta usada no pagamento) tem prioridade.
    if (i.banco) continue;
    if (!i.conta_id) {
      i.banco = null;
      continue;
    }
    i.banco = contaParaBanco.get(String(i.conta_id)) ?? null;
  }
  return itens;
}

// Filtra os titulos pelos bancos EXIBIDOS no dashboard.
//
// Regra (o banco REALMENTE usado e o da BAIXA, quando ela existe):
//  - `i.banco` tem PRIORIDADE: e o nome da conta financeira usada no
//    pagamento/recebimento (vem da baixa, via enriquecerComBaixas). Sem
//    baixa, cai no vinculo da listagem (conta_id -> mapa de contas);
//  - titulo sem banco conhecido (sem baixa e sem conta): MANTIDO
//    (nao da para saber de qual banco veio) — conservador, para nunca
//    perder dinheiro da lista sem querer;
//  - titulo de uma conta de OUTRA transportadora (ex.: "ALVARENGA
//    TRANSPORTES" dentro da LGP): MANTIDO, mas ele sai do bloco da empresa
//    dona da conta e passa a ser apresentado da transportadora dona da
//    conta (ver empresaDoTitulo);
//  - titulo de um banco conhecido e que NAO esta na lista permitida: REMOVIDO
//    (Cartao de Credito, Banco do Brasil, Daycoval, P.F., Devolucao,
//    Garantia, Veloe...).
//
// Lista de bancos vazia = nao filtra nada.
export function filtrarPorBancos(
  itens: ItemLancamento[],
  contaParaBanco: Map<string, string>,
  permitidos: string[],
): ItemLancamento[] {
  if (!permitidos || permitidos.length === 0) return itens;
  return (itens ?? []).filter((i) => {
    // A baixa tem prioridade; sem ela, usa a conta da listagem.
    const banco =
      i.banco || (i.conta_id ? contaParaBanco.get(String(i.conta_id)) : undefined);
    // Sem banco conhecido: mantem (conservador).
    if (!banco) return true;
    // Conta de outra transportadora: mantem (vai para o bloco dela).
    if (empresaDaConta(banco)) return true;
    // Banco conhecido: so passa se estiver na lista exibida no painel.
    return permitidos.some((p) => bancoPermitido(banco, p));
  });
}

/**
 * Le do Supabase os METODOS de pagamento ja buscados (tabela
 * public.detalhes_cache).
 *
 * A validade e contada a partir de `atualizado_em` (12 h) — a leitura nao
 * renova o cache: so a busca na API renova.
 */
async function lerDetalhesDoSupabase(
  empresa: string,
  tituloIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!tituloIds.length) return out;
  if (Date.now() < cacheDetalhesIndisponivelAte) return out;

  try {
    const sb = getSupabase();
    const lotes: string[][] = [];
    for (let i = 0; i < tituloIds.length; i += CHUNK_CACHE_BANCO) {
      // A coluna e UUID: ids fora do padrao sao descartados (evita erro de cast).
      const ids = tituloIds
        .slice(i, i + CHUNK_CACHE_BANCO)
        .filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
      if (ids.length) lotes.push(ids);
    }
    const CONC_LOTES = 4;
    for (let i = 0; i < lotes.length; i += CONC_LOTES) {
      const grupo = lotes.slice(i, i + CONC_LOTES);
      const respostas = await Promise.all(
        grupo.map(async (ids) => {
          const { data, error } = await sb
            .from("detalhes_cache")
            .select("titulo_id, metodo, atualizado_em")
            .eq("empresa", empresa)
            .in("titulo_id", ids);
          if (error) {
            cacheDetalhesIndisponivelAte = Date.now() + 30 * 60 * 1000;
            log("warn", `cache de detalhes (Supabase) indisponivel: ${error.message}`);
            return null;
          }
          return data || [];
        }),
      );
      for (const linhas of respostas) {
        if (!linhas) continue;
        for (const row of linhas as any[]) {
          const metodo = typeof row?.metodo === "string" ? row.metodo.trim() : "";
          // So metodos preenchidos sao cacheados (um titulo sem metodo pode ser
          // preenchido depois pela empresa — nao vale guardar o vazio).
          if (!metodo) continue;
          const lidaEm = Date.parse(String(row.atualizado_em || "")) || Date.now();
          // Expirado: a API e consultada de novo.
          if (lidaEm + DETALHE_TTL_BANCO_MS <= Date.now()) continue;
          out.set(String(row.titulo_id), metodo);
        }
      }
    }
  } catch (e) {
    cacheDetalhesIndisponivelAte = Date.now() + 30 * 60 * 1000;
    log("warn", `cache de detalhes (Supabase) falhou: ${(e as Error)?.message}`);
  }
  return out;
}

/**
 * Grava (upsert em lote) os metodos de pagamento novos no cache do Supabase.
 */
async function gravarDetalhesNoSupabase(
  empresa: string,
  itens: { titulo_id: string; metodo: string }[],
): Promise<void> {
  if (!itens.length) return;
  if (Date.now() < cacheDetalhesIndisponivelAte) return;
  try {
    const sb = getSupabase();
    for (let i = 0; i < itens.length; i += CHUNK_CACHE_BANCO) {
      const lote = itens.slice(i, i + CHUNK_CACHE_BANCO).map((x) => ({
        empresa,
        titulo_id: x.titulo_id,
        metodo: x.metodo,
        atualizado_em: new Date().toISOString(),
      }));
      const { error } = await sb
        .from("detalhes_cache")
        .upsert(lote, { onConflict: "empresa,titulo_id" });
      if (error) {
        cacheDetalhesIndisponivelAte = Date.now() + 30 * 60 * 1000;
        log("warn", `cache de detalhes (Supabase) falhou ao gravar: ${error.message}`);
        return;
      }
    }
  } catch (e) {
    cacheDetalhesIndisponivelAte = Date.now() + 30 * 60 * 1000;
    log("warn", `cache de detalhes (Supabase) falhou ao gravar: ${(e as Error)?.message}`);
  }
}

async function buscarDetalheFormaPagamento(
  empresa: string,
  endpoint: string,
  id: string,
  tokenRef: { token: string },
): Promise<{ metodo: string | null; erro: boolean }> {
  const cacheKey = `${empresa}:${id}`;
  // Compartilha requisições concorrentes pelo mesmo título e só mantém no
  // cache quando não houve erro de requisição (evita cacheiar null permanentemente)
  return lerOuCriar(
    detalheCache,
    cacheKey,
    DETALHE_TTL_MS,
    () => buscarDetalheInterna(empresa, endpoint, id, tokenRef),
    (r) => !r.erro,
  );
}

async function buscarDetalheInterna(
  empresa: string,
  endpoint: string,
  id: string,
  tokenRef: { token: string },
): Promise<{ metodo: string | null; erro: boolean }> {
  let metodo: string | null = null;
  let teveErro = false;

  const resParcela = await buscarParcelaDetalhesPorId(empresa, id, tokenRef);
  metodo = resParcela.metodo;
  if (resParcela.erro) {
    teveErro = true;
  }

  if (!metodo && !teveErro && endpoint.includes("contas-a-receber")) {
    log("info", `detalhe ${empresa} id=${id} sem método, tentando via cobrancas...`);
    const resCobrancas = await buscarViaCobrancas(empresa, id, tokenRef);
    metodo = resCobrancas.metodo;
    if (resCobrancas.erro) {
      teveErro = true;
    }
  }

  if (metodo) {
    log("info", `detalhe ${empresa} id=${id} metodo=${metodo}`);
  } else if (teveErro) {
    log("warn", `detalhe ${empresa} id=${id} - erro na requisição, NÃO CACHEAR`);
  } else {
    log("warn", `detalhe ${empresa} id=${id} - metodo NOT FOUND`);
  }

  return { metodo, erro: teveErro };
}

// Tenta buscar metodo via endpoint de cobrancas (para recebimentos)
async function buscarViaCobrancas(
  empresa: string,
  recebimentoId: string,
  tokenRef: { token: string },
): Promise<{ metodo: string | null; erro?: boolean }> {
  try {
    const url = `https://api-v2.contaazul.com/v1/cobranca/buscar?recebimento_id=${recebimentoId}`;
    // Busca secundaria (metodo): poucas tentativas para nao atrasar o dashboard
    let res = await fetchComRetry(url, { headers: { Authorization: `Bearer ${tokenRef.token}` } }, 2, empresa);
    
    if (res.status === 401) {
      const novo = await renovarToken(empresa);
      if (!novo) return { metodo: null, erro: true };
      tokenRef.token = novo;
      res = await fetchComRetry(url, { headers: { Authorization: `Bearer ${tokenRef.token}` } }, 1, empresa);
    }
    
    if (!res.ok) {
      log("warn", `buscarViaCobrancas ${empresa} status=${res.status}`);
      return { metodo: null, erro: true };
    }

    const j: any = await res.json();
    const itens: any[] = j.itens || [];
    if (itens.length > 0) {
      const metodo = extrairMetodo(itens[0]);
      if (metodo) return { metodo };
    }
    return { metodo: null };
  } catch (e) {
    log("warn", `buscarViaCobrancas erro: ${String(e).slice(0, 100)}`);
    return { metodo: null, erro: true };
  }
}

async function buscarParcelaDetalhesPorId(
  empresa: string,
  id: string,
  tokenRef: { token: string },
): Promise<{ metodo: string | null; erro?: boolean }> {
  const urls = [
    `https://api-v2.contaazul.com/v1/financeiro/eventos-financeiros/parcelas/${id}`,
    `https://api-v2.contaazul.com/v1/financeiro/eventos-financeiros/${id}/parcelas`,
  ];

  let teveErro = false;

  for (const url of urls) {
    let tentativasReauth = 0;
    try {
      // Busca secundaria (metodo): poucas tentativas para nao atrasar o dashboard
      let res = await fetchComRetry(url, { headers: { Authorization: `Bearer ${tokenRef.token}` } }, 2, empresa);
      if (res.status === 401 && tentativasReauth < 1) {
        const novo = await renovarToken(empresa);
        if (!novo) return { metodo: null, erro: true };
        tokenRef.token = novo;
        tentativasReauth++;
        res = await fetchComRetry(url, { headers: { Authorization: `Bearer ${tokenRef.token}` } }, 1, empresa);
      }

      if (!res.ok) {
        if (res.status === 404) {
          continue;
        }
        log("warn", `buscarParcelaDetalhesPorId ${empresa} id=${id} url=${url} status=${res.status}`);
        teveErro = true;
        continue;
      }

      const j: any = await res.json();
      const itens: any[] = Array.isArray(j) ? j : [j];
      for (const item of itens) {
        const metodo = extrairMetodo(item);
        if (metodo) {
          log("info", `buscarParcelaDetalhesPorId ${empresa} id=${id} url=${url} metodo=${metodo}`);
          return { metodo };
        }
      }
    } catch (e) {
      log("warn", `buscarParcelaDetalhesPorId erro ${empresa} id=${id} url=${url}: ${String(e).slice(0, 100)}`);
      teveErro = true;
    }
  }

  return { metodo: null, erro: teveErro };
}

async function buscarMetodoPorListaReceber(
  empresa: string,
  dataInicio: string,
  dataFim: string,
  tokenRef: { token: string },
): Promise<{ mapa: Map<string, string | null>; erro: boolean }> {
  const mapa = new Map<string, string | null>();
  let pagina = 1;
  let tentativasReauth = 0;
  let erro = false;

  while (true) {
    const params = new URLSearchParams({
      data_vencimento_de: dataInicio,
      data_vencimento_ate: dataFim,
      status: "EM_ABERTO",
      tamanho_pagina: "100",
      pagina: String(pagina),
    });
    const url = `https://api-v2.contaazul.com/v1/financeiro/contas-a-receber?${params}`;
    // Busca secundaria (classificacao de metodo): poucas tentativas para nao
    // atrasar o dashboard em dias com muitos titulos.
    let res = await fetchComRetry(url, { headers: { Authorization: `Bearer ${tokenRef.token}` } }, 2, empresa);

    if (res.status === 401 && tentativasReauth < 1) {
      const novo = await renovarToken(empresa);
      if (!novo) {
        erro = true;
        break;
      }
      tokenRef.token = novo;
      tentativasReauth++;
      res = await fetchComRetry(url, { headers: { Authorization: `Bearer ${tokenRef.token}` } }, 1, empresa);
    }
    if (!res.ok) {
      log("warn", `buscarMetodoPorListaReceber ${empresa} pg=${pagina} status=${res.status}`);
      erro = true;
      break;
    }

    const j: any = await res.json();
    const itens: any[] = j.itens || [];
    if (!itens.length) break;

    for (const i of itens) {
      if (!i.id) continue;
      const metodo = extrairMetodo(i);
      mapa.set(String(i.id), metodo || null);
      if (metodo) {
        log("info", `buscarMetodoPorListaReceber ${empresa} id=${String(i.id).slice(0, 8)} data=${i.data_vencimento} valor=${i.total} metodo=${metodo}`);
      } else {
        // Log itens sem método para debug
        const temBoleto = JSON.stringify(i).toUpperCase().includes("BOLETO");
        if (temBoleto) {
          log("warn", `buscarMetodoPorListaReceber ${empresa} id=${String(i.id).slice(0, 8)} data=${i.data_vencimento} valor=${i.total} - TEM "BOLETO" mas extrairMetodo retornou null! Inspecionar payload.`);
        }
      }
    }

    if (itens.length < 100) break;
    pagina++;
    tentativasReauth = 0;
  }

  return { mapa, erro };
}

export async function buscarV2(
  empresa: string,
  endpoint: string,
  dataInicio: string,
  dataFim: string,
): Promise<{ dados: ItemLancamento[]; ok: boolean }> {
  const cacheKey = `${empresa}:${endpoint}:${dataInicio}:${dataFim}`;
  const r = await lerOuCriar(
    listCache,
    cacheKey,
    LIST_TTL_MS,
    () => buscarV2Interna(empresa, endpoint, dataInicio, dataFim),
    (x) => x.ok,
  );
  return { dados: r.dados, ok: r.ok };
}

async function buscarV2Interna(
  empresa: string,
  endpoint: string,
  dataInicio: string,
  dataFim: string,
): Promise<{ dados: ItemLancamento[]; ok: boolean }> {
  const tokenInicial = await obterToken(empresa);
  if (!tokenInicial) {
    log("warn", `buscarV2 sem token: ${empresa}`);
    return { dados: [], ok: false };
  }
  const tokenRef = { token: tokenInicial };

  let teveErroGeral = false;
  // Falha em buscas SECUNDARIAS (metodo/forma de pagamento): os titulos ja foram
  // obtidos, entao nao deve acender a bolinha vermelha de sincronizacao.
  let falhaDetalhe = false;
  const brutos: {
    id: string;
    data: string;
    valor: number;
    metodo: string | null;
    conta_id?: string;
    descricao?: string | null;
    terceiro?: string | null;
    categoria?: string | null;
  }[] = [];
  const ehReceber = endpoint.includes("contas-a-receber");

  // Paginas em PARALELO (3 por vez) a partir do `itens_totais` da primeira
  // pagina: a lista de titulos em aberto era buscada uma a uma e demorava.
  const urlDaPagina = (pagina: number) => {
    const params = new URLSearchParams({
      data_vencimento_de: dataInicio,
      data_vencimento_ate: dataFim,
      status: "EM_ABERTO",
      tamanho_pagina: "100",
      pagina: String(pagina),
    });
    return `https://api-v2.contaazul.com${endpoint}?${params}`;
  };

  const listagem = await listarTodasPaginas(empresa, urlDaPagina, tokenRef);
  if (listagem.falhou || listagem.erroDefinitivo) {
    log(
      "warn",
      `buscarV2 ${empresa} paginacao falhou (transitorio=${listagem.falhou} definitivo=${listagem.erroDefinitivo})`,
    );
    teveErroGeral = true;
  }

  for (const i of listagem.itens) {
    const dv = i.data_vencimento ? String(i.data_vencimento).slice(0, 10) : null;
    const aberto = (i.total || 0) - (i.pago || 0);
    if (dv && aberto > 0 && i.id) {
      const metodoInicial = extrairMetodo(i);
      brutos.push({
        id: String(i.id),
        data: dv,
        valor: aberto,
        metodo: metodoInicial,
        conta_id: extrairContaId(i),
        descricao: extrairDescricao(i),
        terceiro: extrairTerceiro(i),
        categoria: extrairCategoria(i),
      });
    }
  }

  if (!ehReceber) {
    const resultado: ItemLancamento[] = brutos.map((b) => ({
      data: b.data,
      valor: b.valor,
      metodo: null,
      conta_id: b.conta_id,
      descricao: b.descricao ?? null,
      terceiro: b.terceiro ?? null,
      categoria: b.categoria ?? null,
    }));
    if (teveErroGeral) {
      log("warn", `buscarV2 finalizou com erros para ${empresa} (pagar). Dados não cacheados.`);
    }
    return { dados: resultado, ok: !teveErroGeral };
  }

  // Para contas a receber, primeiro tenta buscar métodos via lista de contas-a-receber
  const { mapa: metodoPorId, erro: erroMetodosLista } = await buscarMetodoPorListaReceber(empresa, dataInicio, dataFim, tokenRef);
  if (erroMetodosLista) {
    // Falha ao classificar metodo NAO e falha de sincronizacao: os titulos em si
    // ja foram trazidos. Vira apenas log (evita bolinha vermelha falsa).
    falhaDetalhe = true;
  }
  log("info", `buscarV2 ${empresa} encontrou ${metodoPorId.size} itens com metodo via lista (erro=${erroMetodosLista})`);

  // Depois, para items sem método, tenta buscar detalhes individuais
  const CONCORRENCIA = 4;
  const resultado: {
    data: string;
    valor: number;
    metodo: string | null;
    conta_id?: string;
    descricao?: string | null;
    terceiro?: string | null;
    categoria?: string | null;
  }[] = new Array(brutos.length);
  let idx = 0;
  let boletos = 0;
  let comMetodo = 0;

  // Cache persistente dos metodos (Supabase): evita as ~100 chamadas de
  // detalhe a cada cold start da Vercel. A leitura e em LOTE (1 consulta por
  // 200 titulos, 4 lotes em paralelo).
  const metodosDoBanco = await lerDetalhesDoSupabase(
    empresa,
    brutos.map((b) => String(b.id)).filter(Boolean),
  );
  const metodosNovos: { titulo_id: string; metodo: string }[] = [];
  let doCache = 0;

  async function worker() {
    while (true) {
      const meu = idx++;
      if (meu >= brutos.length) return;
      const b = brutos[meu];

      let metodo = b.metodo;

      if (!metodo) {
        metodo = metodoPorId.get(String(b.id)) ?? null;
      }

      if (!metodo) {
        metodo = metodosDoBanco.get(String(b.id)) ?? null;
        if (metodo) doCache++;
      }

      if (!metodo) {
        const resDet = await buscarDetalheFormaPagamento(empresa, endpoint, b.id, tokenRef);
        metodo = resDet.metodo;
        if (resDet.erro) {
          // Erro ao buscar APENAS o metodo de pagamento: o titulo ja esta aqui.
          // Nao marca a consulta como falha (evita erro falso de sincronizacao).
          falhaDetalhe = true;
        }
        // Metodo novo (nao-nulo): guarda no cache persistente para a proxima
        // carga nao precisar chamar a API de novo.
        if (metodo) metodosNovos.push({ titulo_id: String(b.id), metodo });
      } else {
        log("info", `${empresa} item ${String(b.id).slice(0, 8)} data=${b.data} valor=${b.valor} classificado de lista como: ${metodo}`);
      }

      if (metodo) comMetodo++;
      if (metodo && metodo.toUpperCase().includes("BOLETO")) {
        boletos++;
        log("info", `${empresa} BOLETO DETECTADO: item ${String(b.id).slice(0, 8)} data=${b.data} valor=${b.valor}`);
      } else if (!metodo) {
        log("warn", `${empresa} SEM MÉTODO: item ${String(b.id).slice(0, 8)} data=${b.data} valor=${b.valor}`);
      }
      resultado[meu] = {
        data: b.data,
        valor: b.valor,
        metodo,
        conta_id: b.conta_id,
        descricao: b.descricao ?? null,
        terceiro: b.terceiro ?? null,
        categoria: b.categoria ?? null,
      };
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCORRENCIA, brutos.length) }, worker));
  // Grava os metodos novos no cache persistente (1 chamada por 200 titulos).
  if (metodosNovos.length) await gravarDetalhesNoSupabase(empresa, metodosNovos);
  log(
    "info",
    `${empresa} a_receber=${brutos.length} com_metodo=${comMetodo} boletos=${boletos} | cache: ${doCache} do banco, ${metodosNovos.length} novos`,
  );

  if (falhaDetalhe) {
    log(
      "warn",
      `${empresa}: falha ao classificar forma de pagamento de parte dos titulos (dados completos, apenas metodo incompleto) — nao afeta a sincronizacao`,
    );
  }
  if (teveErroGeral) {
    log("warn", `buscarV2 finalizou com erros para ${empresa} (receber). Dados não cacheados.`);
  }
  return { dados: resultado, ok: !teveErroGeral };
}

// ------------------- Contas efetivamente pagas (baixadas) -------------------
// Busca titulos de contas a pagar quitados no periodo, com o filtro
// data_pagamento_de/_ate e status ACQUITTED (documentacao oficial Conta Azul).
// Diferente do buscarV2 (que traz titulos EM_ABERTO pelo vencimento), aqui o que
// interessa e a DATA REAL do pagamento.

// Extrai a data de pagamento/baixa de um titulo (varias estruturas possiveis)
function extrairDataPagamento(i: any): string | null {
  const candidatos = [
    i?.data_pagamento,
    i?.data_baixa,
    i?.baixas?.[0]?.data_pagamento,
    i?.baixas?.[0]?.data,
    i?.parcelas?.[0]?.data_pagamento,
    i?.parcelas?.[0]?.data_baixa,
  ];
  for (const c of candidatos) {
    if (typeof c === "string" && c.trim()) return c.slice(0, 10);
  }
  return null;
}

export async function buscarPagas(
  empresa: string,
  dataInicio: string,
  dataFim: string,
): Promise<ResultadoLista> {
  // Refresh forcado (pre-aquecimento): o cache de lista (2 min) tambem e
  // contornado, senao a listagem ja enriquecida seria devolvida sem buscar as
  // baixas de novo na API.
  if (forcarRefreshBaixas) {
    return await buscarPagasInterna(empresa, dataInicio, dataFim);
  }
  const cacheKey = `pagas:${empresa}:${dataInicio}:${dataFim}`;
  const r = await lerOuCriar(
    listCache,
    cacheKey,
    LIST_TTL_MS,
    () => buscarPagasInterna(empresa, dataInicio, dataFim),
    // So um resultado COMPLETO fica no cache. Resultado parcial seria servido
    // por 2 minutos e faria o card mostrar um total errado.
    // Resultado com baixas faltando tambem nao fica no cache: a proxima carga
    // precisa tentar de novo (as baixas ja buscadas vem do cache do Supabase).
    (x) => x.ok && !x.sem_baixa && !x.baixas_pendentes,
  );
  return {
    dados: r.dados,
    ok: r.ok,
    incompleto: r.incompleto,
    sem_baixa: r.sem_baixa,
    sem_baixa_definitivo: r.sem_baixa_definitivo,
    baixas_pendentes: r.baixas_pendentes,
  };
}

async function buscarPagasInterna(
  empresa: string,
  dataInicio: string,
  dataFim: string,
): Promise<ResultadoLista> {
  const tokenInicial = await obterToken(empresa);
  if (!tokenInicial) {
    log("warn", `buscarPagas sem token: ${empresa}`);
    return { dados: [], ok: false, incompleto: true };
  }
  const tokenRef = { token: tokenInicial };

  // Janela de vencimento: a API exige data_vencimento_de/_ate mesmo quando o
  // filtro real e por data de pagamento (ver JANELA_VENCIMENTO_DIAS).
  const vencInicio = new Date(dataInicio + "T00:00:00Z");
  vencInicio.setUTCDate(vencInicio.getUTCDate() - JANELA_VENCIMENTO_DIAS);
  const vencFim = new Date(dataFim + "T00:00:00Z");
  vencFim.setUTCDate(vencFim.getUTCDate() + 30);
  const venc = {
    data_vencimento_de: vencInicio.toISOString().slice(0, 10),
    data_vencimento_ate: vencFim.toISOString().slice(0, 10),
  };

  // Status oficial para contas baixadas e ACQUITTED (documentacao Conta Azul);
  // PAGO fica como fallback para contas que usem o valor antigo.
  const statusTentativas = ["ACQUITTED", "PAGO"];

  // Marcador de resultado PARCIAL: alguma pagina nao pôde ser lida por erro
  // transitório. Nesse caso o retorno NAO pode ser tratado como final nem
  // cacheado — o dashboard avisa e a tela refaz a busca automaticamente.
  let incompleto = false;
  // Melhor colecao parcial obtida: devolvida como fallback para o card nao
  // sumir (o aviso indica que o total esta incompleto).
  let parcial: ItemLancamento[] = [];

  for (const status of statusTentativas) {
    const brutos: ItemLancamento[] = [];
    let falhaTransitoria = false;

    // Pagina ate a API nao devolver mais itens (sem limite de paginas). As
    // paginas sao buscadas em PARALELO (3 por vez) a partir do
    // `itens_totais` da primeira pagina: no periodo com ~660 titulos pagos
    // isso economiza varios segundos de carregamento.
    // Se uma pagina falhar no meio (rate limit), a paginacao RECOMECA do
    // zero — a versao anterior parava ali e devolvia so os itens ja lidos,
    // que era exatamente o total menor visto no carregamento automatico.
    for (let passe = 1; passe <= MAX_PASSES_PAGINACAO; passe++) {
      brutos.length = 0;
      falhaTransitoria = false;

      const urlDaPagina = (pagina: number) => {
        const params = new URLSearchParams({
          ...venc,
          data_pagamento_de: dataInicio,
          data_pagamento_ate: dataFim,
          status,
          tamanho_pagina: "100",
          pagina: String(pagina),
        });
        return `https://api-v2.contaazul.com/v1/financeiro/contas-a-pagar?${params}`;
      };

      const r = await listarTodasPaginas(empresa, urlDaPagina, tokenRef);

      if (r.falhou) {
        // Erro transitorio persistente: reinicia a paginacao inteira.
        falhaTransitoria = true;
        brutos.push(
          ...(await processarPagasResposta(r.itens, empresa, dataInicio, dataFim, status)),
        );
        log(
          "warn",
          `buscarPagas ${empresa} [status=${status}] paginacao falhou — reiniciando (passe ${passe}/${MAX_PASSES_PAGINACAO})`,
        );
        await sleep(1500 * passe); // espera a API liberar antes de recomecar
        continue;
      }

      if (r.erroDefinitivo) {
        // Erro definitivo (ex.: status nao aceito por esta conta): nao adianta
        // repetir — pula para o proximo status.
        log(
          "warn",
          `buscarPagas ${empresa} (filtro status=${status}) — seguindo para outro status`,
        );
        break;
      }

      brutos.push(
        ...(await processarPagasResposta(r.itens, empresa, dataInicio, dataFim, status)),
      );
      break; // paginacao concluida
    }

    if (falhaTransitoria) {
      incompleto = true;
      if (brutos.length > parcial.length) parcial = brutos;
      continue; // tenta o proximo status; no fim devolve a parcial com ok=false
    }

    if (brutos.length > 0) {
      if (incompleto) {
        // Algum status anterior falhou: nao da para garantir que esta lista
        // cobre todos os titulos. Guarda como parcial e segue.
        if (brutos.length > parcial.length) parcial = brutos;
        continue;
      }
      // Enriquece os titulos com a BAIXA da parcela: data real do pagamento e
      // valor (face ou liquido, conforme VALOR_PAGAS).
      const { dados: enriquecidos, semBaixa, semBaixaDefinitivo, pendentes } =
        await enriquecerComBaixas(
          empresa,
          brutos,
          tokenRef,
          dataInicio,
          dataFim,
          VALOR_PAGAS,
        );
      const total = enriquecidos.reduce((a, b) => a + b.valor, 0);
      log(
        "info",
        `buscarPagas ${empresa} [status=${status}]: ${brutos.length} titulos pagos em ${dataInicio}..${dataFim} (total ${total.toFixed(2)})`,
      );
      return {
        dados: enriquecidos,
        ok: true,
        sem_baixa: semBaixa,
        sem_baixa_definitivo: semBaixaDefinitivo,
        baixas_pendentes: pendentes,
      };
    }
    // Este status respondeu completo e sem titulos: tenta o proximo.
  }

  if (incompleto) {
    log(
      "warn",
      `buscarPagas ${empresa}: paginacao nao concluiu — devolvendo ${parcial.length} titulo(s) parcial(is), resultado NAO cacheado`,
    );
    return { dados: parcial, ok: false, incompleto: true };
  }

  // Todos os status responderam completos e sem titulos: periodo sem contas
  // pagas (resultado vazio valido e cacheavel).
  return { dados: [], ok: true };
}

async function processarPagasResposta(
  itens: any[],
  empresa: string,
  dataInicio: string,
  dataFim: string,
  status: string,
): Promise<ItemLancamento[]> {
  const brutos: ItemLancamento[] = [];
  let comDesconto = 0;
  let comJuros = 0;
  let somaDesconto = 0;
  for (const i of itens) {
    // CONTA AZUL — semantica dos campos da listagem (confirmada nas baixas
    // reais, 16/16 titulos):
    //   pago  = valor_composicao.valor_bruto  (valor CHEIO do titulo)
    //   total = valor_composicao.valor_liquido (bruto - desconto + juros + multa)
    // Exemplo real: "1/3 - Compra de produto 1922" -> pago 1.127,69 (cheio) e
    // total 1.127,66 (liquido, ja com o desconto de R$ 0,03).
    // No card de PAGOS o valor exibido e o CHEIO do titulo (o `pago`); o
    // desconto/juros/multa sao apenas rotulos da composicao do pagamento.
    const bruto = (i.pago as number) || 0;
    const liquido = (i.total as number) || 0;
    // Pagamento parcial (nao_pago > 0): o `pago` ja e o que foi pago.
    const parcial = ((i.nao_pago as number) || 0) > 0.005;

    // Juros / multa / desconto: a listagem normalmente NAO traz (o desconto so
    // existe na baixa), mas o `total` ja e o valor liquido.
    let juros = extrairNumero(i, "juros", "valor_juros", "acrescimos", "juros_multa", "valor_acrescimo");
    let multa = extrairNumero(i, "multa", "valor_multa", "valor_multa_mora");
    let desconto = extrairNumero(i, "desconto", "valor_desconto", "abatimento", "valor_desconto_concedido", "desconto_concedido", "valor_desconto_baixa", "desconto_baixa");

    // Campo de valor efetivo pago, quando a API disponibiliza.
    const valorPagoCampo = extrairNumero(i, "valor_pago", "valor_liquido", "valor_efetivo", "valor_baixa", "valor_pagamento", "valor_pago_liquido", "valor_pago_final", "valor_pago_efetivo");

    // A listagem nao traz o desconto, mas a diferenca entre bruto e liquido e
    // exatamente o desconto (liquido menor) ou os juros/multa (liquido maior).
    // Isso rotula o titulo (e o card) sem nenhuma chamada extra a API.
    const diferenca = bruto - liquido;
    if (!parcial && desconto <= 0 && juros <= 0 && multa <= 0) {
      if (diferenca > 0.005) desconto = diferenca;
      else if (diferenca < -0.005) juros = -diferenca;
    }
    if (desconto > 0) {
      comDesconto++;
      somaDesconto += desconto;
    }
    if (juros > 0) comJuros++;

    // Valor do titulo: o valor CHEIO (face). Em pagamento parcial o `pago` ja
    // e somente o que foi pago, entao o mesmo campo serve para os dois casos.
    let valor: number;
    if (parcial) {
      valor = valorPagoCampo > 0 ? valorPagoCampo : bruto;
    } else if (bruto > 0) {
      valor = bruto;
    } else {
      valor = liquido > 0 ? liquido : valorPagoCampo;
    }
    if (!i.id || valor <= 0) continue;
    const data =
      extrairDataPagamento(i) ||
      (i.data_pagamento ? String(i.data_pagamento).slice(0, 10) : null) ||
      (i.data_vencimento ? String(i.data_vencimento).slice(0, 10) : null);
    if (!data) continue;
    // IDs da baixa/parcela para consulta do valor_composicao (desconto real)
    const baixaId = i.baixas?.[0]?.id ?? i.baixa_id;
    const parcelaId = i.parcelas?.[0]?.id ?? i.parcela_id;
    brutos.push({
      data,
      valor,
      metodo: null,
      id: String(i.id),
      conta_id: extrairContaId(i),
      descricao: extrairDescricao(i),
      terceiro: extrairTerceiro(i),
      categoria: extrairCategoria(i),
      juros: juros || undefined,
      multa: multa || undefined,
      desconto: desconto || undefined,
      valor_pago: valorPagoCampo || undefined,
      ...(baixaId ? { baixa_id: String(baixaId) } : {}),
      ...(parcelaId ? { parcela_id: String(parcelaId) } : {}),
      _pago: bruto,
      _total: liquido,
    });
  }
  if (comDesconto || comJuros) {
    log(
      "info",
      `buscarPagas ${empresa} [status=${status}]: ${comDesconto} titulo(s) com desconto (R$ ${somaDesconto.toFixed(2)}) e ${comJuros} com juros — valor exibido e o valor cheio do titulo`,
    );
  }
  return brutos;
}

/**
 * Enriquece os titulos com a BAIXA da parcela: data real do pagamento e a
 * composicao real do valor (desconto / juros / multa).
 *
 * A listagem (contas-a-pagar / contas-a-receber) traz so o VENCIMENTO do
 * titulo; a data em que o dinheiro saiu/entrou esta na baixa da parcela:
 *   GET /v1/financeiro/eventos-financeiros/parcelas/{parcela_id}/baixa
 *
 * O id devolvido pela listagem E o id da parcela (confirmado na API), entao
 * uma chamada por titulo traz tudo o que precisa: data_pagamento + composicao.
 */
export function extrairDadosBaixa(
  baixas: any[],
  dataInicio: string,
  dataFim: string,
): DadosBaixa | null {
  const validas = (baixas || []).filter((b) => b && typeof b === "object");
  if (!validas.length) return null;

  const dataDe = (b: any): string =>
    typeof b?.data_pagamento === "string" ? b.data_pagamento.slice(0, 10) : "";

  // Baixas lancadas dentro do periodo pedido (o filtro de data_pagamento da
  // listagem ja restringe os titulos ao periodo).
  const noPeriodo = validas.filter((b) => {
    const d = dataDe(b);
    return d && d >= dataInicio && d <= dataFim;
  });

  // A data exibida e a da ultima baixa dentro do periodo (quando existe).
  const datas = (noPeriodo.length ? noPeriodo : validas)
    .map(dataDe)
    .filter(Boolean)
    .sort();
  const dataPagamento = datas.length ? datas[datas.length - 1] : null;

  // A composicao e a do titulo inteiro (todas as baixas da parcela).
  let desconto = 0;
  let juros = 0;
  let multa = 0;
  let valorBruto = 0;
  let valorLiquido = 0;
  let valorPago = 0;
  // Banco/conta financeira usada no pagamento (vem na propria baixa).
  let banco: string | null = null;
  let contaId: string | null = null;
  for (const b of validas) {
    const vc = b?.valor_composicao || b?.composicao_valor || b?.detalhe_valor || {};
    desconto += Number(vc.desconto || 0);
    juros += Number(vc.juros || 0);
    multa += Number(vc.multa || 0);
    valorBruto += Number(vc.valor_bruto || b?.valor_bruto || 0);
    valorLiquido += Number(vc.valor_liquido || 0);
    valorPago += Number(b?.valor_pago || 0);
    const cf = b?.conta_financeira;
    if (cf && !banco) {
      banco = cf.nome || cf.banco || null;
      contaId = cf.id ? String(cf.id) : null;
    }
  }
  if (valorBruto <= 0) valorBruto = valorPago;
  if (valorLiquido <= 0) valorLiquido = valorBruto - desconto + juros + multa;

  return {
    data_pagamento: dataPagamento,
    desconto,
    juros,
    multa,
    valor_bruto: valorBruto,
    valor_liquido: valorLiquido,
    valor_pago: valorPago,
    banco,
    conta_id: contaId,
  };
}

/**
 * Mantem no cache apenas os campos que interessam da baixa (data do
 * pagamento e composicao do valor), para o JSON guardado no banco ficar
 * pequeno.
 */
function compactarBaixa(b: any): any {
  const vc = b?.valor_composicao || b?.composicao_valor || b?.detalhe_valor || {};
  // A baixa traz a conta financeira usada no pagamento (ex.: "Sicoob 3109") —
  // e a fonte do BANCO do titulo no relatorio.
  const cf = b?.conta_financeira || null;
  return {
    v: BAIXA_CACHE_VERSAO,
    data_pagamento: typeof b?.data_pagamento === "string" ? b.data_pagamento : null,
    valor_pago: Number(b?.valor_pago || 0),
    valor_composicao: {
      valor_bruto: Number(vc.valor_bruto || b?.valor_bruto || 0),
      valor_liquido: Number(vc.valor_liquido || 0),
      desconto: Number(vc.desconto || 0),
      juros: Number(vc.juros || 0),
      multa: Number(vc.multa || 0),
    },
    conta_financeira: cf
      ? {
          id: cf.id ? String(cf.id) : null,
          nome: cf.nome ?? null,
          banco: cf.banco ?? null,
        }
      : null,
  };
}

/**
 * Resultado da busca da baixa de uma parcela:
 *   ok    = a API devolveu a(s) baixa(s) do titulo;
 *   vazio = o titulo NAO tem baixa (404 / lista vazia) — definitivo: nao existe
 *           data de pagamento nem banco para buscar de novo;
 *   falha = erro transitorio (429/5xx/rede) — a proxima carga tenta de novo.
 */
type StatusBaixa = "ok" | "vazio" | "falha";

/**
 * Busca (com cache em memoria) as BAIXAS CRUAS de uma parcela.
 */
async function buscarBaixaDaParcela(
  empresa: string,
  parcelaId: string,
  tokenRef: { token: string },
): Promise<{ baixas: any[] | null; status: StatusBaixa }> {
  const chave = `${empresa}:${parcelaId}`;
  const agora = Date.now();
  const cached = baixaCache.get(chave);
  // Refresh forcado (pre-aquecimento): o cache de memoria e ignorado e a
  // baixa e buscada de novo na API.
  if (!forcarRefreshBaixas && cached && cached.exp > agora) {
    // No cache so entra "vazio" (1 min) e "ok" (12 h) — nunca "falha".
    return { baixas: cached.baixas, status: cached.baixas ? "ok" : "vazio" };
  }

  const url = `https://api-v2.contaazul.com/v1/financeiro/eventos-financeiros/parcelas/${parcelaId}/baixa`;

  // Guarda no cache de memoria. Um 404 (titulo sem baixa) vale por 1 min; uma
  // falha de rede/429 NAO e cacheada (e transientia): a proxima carga tenta de
  // novo, para o titulo nao ficar preso com a data de vencimento.
  const guardar = (baixas: any[] | null, ttl: number) => {
    baixaCache.set(chave, { exp: Date.now() + ttl, baixas });
    return { baixas, status: "vazio" as StatusBaixa };
  };

  let res: Response | null = null;
  let ultimoStatus = 0;
  let renoveuToken = false;

  for (let tentativa = 0; tentativa < 4; tentativa++) {
    // Fila por tempo: respeita o limite de 10 req/s da API (POR EMPRESA).
    await esperarVagaApi(empresa);
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${tokenRef.token}` } });
    } catch (e) {
      log("warn", `baixa ${parcelaId}: erro de rede (${String(e).slice(0, 80)})`);
      await sleep(500 * (tentativa + 1));
      continue;
    }
    ultimoStatus = res.status;
    if (res.status === 401 && !renoveuToken) {
      renoveuToken = true;
      const novo = await renovarToken(empresa);
      if (novo) {
        tokenRef.token = novo;
        continue;
      }
    }
    if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
      apiRecebeu429(empresa);
      const espera = 800 * Math.pow(2, tentativa);
      log("warn", `baixa ${parcelaId}: ${res.status} (limite da API, espera ${espera}ms)`);
      await sleep(espera);
      continue;
    }
    break;
  }

  if (!res) {
    // Erro de rede (nenhuma resposta): transitorio — a proxima carga tenta de
    // novo, para o titulo nao ficar preso com a data de vencimento.
    log("warn", `baixa ${parcelaId}: falhou sem resposta — sera refeita na proxima carga`);
    return { baixas: null, status: "falha" };
  }

  if (!res.ok) {
    // Falha transientia (429/5xx/401): nao cacheia, para a proxima carga
    // tentar de novo e o titulo receber a data REAL e o banco.
    if (ultimoStatus === 429 || ultimoStatus >= 500 || ultimoStatus === 401) {
      log("warn", `baixa ${parcelaId}: falhou com ${ultimoStatus} — sera refeita na proxima carga`);
      return { baixas: null, status: "falha" };
    }
    // 404 (ou outro erro definitivo): o titulo nao tem baixa.
    return guardar(null, BAIXA_TTL_MS_VAZIO);
  }

  let j: any;
  try {
    j = await res.json();
  } catch {
    // Resposta ilegivel: trata como falha transitoria (a proxima carga tenta).
    log("warn", `baixa ${parcelaId}: resposta ilegivel — sera refeita na proxima carga`);
    return { baixas: null, status: "falha" };
  }

  apiDeuCerto(empresa);
  const lista: any[] = Array.isArray(j) ? j : j ? [j] : [];
  if (!lista.length) return guardar(null, BAIXA_TTL_MS_VAZIO);
  // TTL conforme a recencia do pagamento (periodo fechado = cache longo).
  const compactadas = lista.map(compactarBaixa);
  baixaCache.set(chave, { exp: Date.now() + ttlDaBaixa(compactadas), baixas: compactadas });
  return { baixas: compactadas, status: "ok" };
}

// ------------------- Cache persistente das baixas (Supabase) -----------------
// A baixa e imutavel: guarda-se o array cru na tabela public.baixas_cache para
// que a proxima carga (em qualquer instancia da Vercel) leia do banco em vez
// de refazer ~1.300 chamadas a API da Conta Azul.

/**
 * Le as baixas ja cacheadas no Supabase para as parcelas informadas.
 *
 * A validade e contada a partir de `atualizado_em` (quando a baixa foi
 * buscada na API) e do TTL que a RECENCIA do pagamento pede: pagamento dos
 * ultimos dias expira em 12 h, pagamento de periodo fechado em 30 dias.
 */
async function lerBaixasDoSupabase(
  empresa: string,
  parcelaIds: string[],
): Promise<Map<string, { baixas: any[]; exp: number }>> {
  const out = new Map<string, { baixas: any[]; exp: number }>();
  if (!parcelaIds.length) return out;
  if (Date.now() < cacheBancoIndisponivelAte) return out;

  try {
    const sb = getSupabase();
    // Os ids sao lidos em LOTE (CHUNK_CACHE_BANCO por consulta) e os lotes
    // correm em PARALELO: em um mes grande (2.600 titulos) a leitura serial
    // gastava ~6 s so para montar a lista do que ja estava em cache.
    const lotes: string[][] = [];
    for (let i = 0; i < parcelaIds.length; i += CHUNK_CACHE_BANCO) {
      // A coluna e UUID: ids fora do padrao sao descartados (evita erro de cast).
      const ids = parcelaIds
        .slice(i, i + CHUNK_CACHE_BANCO)
        .filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
      if (ids.length) lotes.push(ids);
    }
    const CONC_LOTES = 4;
    for (let i = 0; i < lotes.length; i += CONC_LOTES) {
      const grupo = lotes.slice(i, i + CONC_LOTES);
      const respostas = await Promise.all(
        grupo.map(async (ids) => {
          const { data, error } = await sb
            .from("baixas_cache")
            .select("parcela_id, baixa, atualizado_em")
            .eq("empresa", empresa)
            .in("parcela_id", ids);
          if (error) {
            cacheBancoIndisponivelAte = Date.now() + 30 * 60 * 1000;
            log("warn", `cache de baixas (Supabase) indisponivel: ${error.message}`);
            return null;
          }
          return data || [];
        }),
      );
      for (const linhas of respostas) {
        if (!linhas) continue;
        for (const row of linhas as any[]) {
          const b = row?.baixa;
          // Linhas gravadas em outra versao do formato sao ignoradas: a baixa e
          // buscada de novo na API (e regravida no formato novo).
          if (!Array.isArray(b) || !b.length) continue;
          if (b[0]?.v !== BAIXA_CACHE_VERSAO) continue;
          // Refresh forcado (pre-aquecimento do mes corrente): a linha do banco
          // e IGNORADA para a baixa ser buscada de novo na API (e regravada
          // com a nova data).
          if (forcarRefreshBaixas) continue;
          // Expirada: a API e consultada de novo.
          const lidaEm = Date.parse(String(row.atualizado_em || "")) || Date.now();
          const exp = lidaEm + ttlDaBaixa(b);
          if (exp <= Date.now()) continue;
          out.set(String(row.parcela_id), { baixas: b, exp });
        }
      }
    }
  } catch (e) {
    cacheBancoIndisponivelAte = Date.now() + 30 * 60 * 1000;
    log("warn", `cache de baixas (Supabase) falhou: ${(e as Error)?.message}`);
  }
  return out;
}

/**
 * Grava (upsert em lote) as baixas novas no cache do Supabase.
 */
async function gravarBaixasNoSupabase(
  empresa: string,
  itens: { parcela_id: string; baixa: any[] }[],
): Promise<void> {
  if (!itens.length) return;
  if (Date.now() < cacheBancoIndisponivelAte) return;

  try {
    const sb = getSupabase();
    for (let i = 0; i < itens.length; i += CHUNK_CACHE_BANCO) {
      const lote = itens.slice(i, i + CHUNK_CACHE_BANCO).map((x) => ({
        empresa,
        parcela_id: x.parcela_id,
        baixa: x.baixa,
        atualizado_em: new Date().toISOString(),
      }));
      const { error } = await sb
        .from("baixas_cache")
        .upsert(lote, { onConflict: "empresa,parcela_id" });
      if (error) {
        cacheBancoIndisponivelAte = Date.now() + 30 * 60 * 1000;
        log("warn", `cache de baixas (Supabase) falhou ao gravar: ${error.message}`);
        return;
      }
    }
  } catch (e) {
    cacheBancoIndisponivelAte = Date.now() + 30 * 60 * 1000;
    log("warn", `cache de baixas (Supabase) falhou ao gravar: ${(e as Error)?.message}`);
  }
}

/**
 * Enriquece a lista de titulos (pagos ou recebidos) com a BAIXA da parcela:
 * data REAL do pagamento e valor (face ou liquido, conforme o modo).
 *
 * Tres camadas, do mais rapido para o mais lento:
 *   1. cache em memoria (12 h);
 *   2. cache persistente no Supabase (tabela public.baixas_cache) — sobrevive
 *      ao cold start e e compartilhado entre as instancias da Vercel;
 *   3. chamada a API da Conta Azul (limitada a 9 req/s, o limite da API) —
 *      e o que popula o cache.
 *
 * O titulo continua na lista mesmo se a baixa nao responder (falha de rede /
 * rate limit): nesse caso mantem o valor e a data que vieram da listagem
 * (ou seja, o VENCIMENTO) e o banco fica vazio. A quantidade desses titulos
 * volta em `semBaixa` (falha transitoria — a proxima carga tenta de novo) e em
 * `semBaixaDefinitivo` (o titulo nao tem baixa na API), para o painel avisar
 * que a data pode ser a de vencimento.
 */
export async function enriquecerComBaixas(
  empresa: string,
  itens: ItemLancamento[],
  tokenRef: { token: string },
  dataInicio: string,
  dataFim: string,
  modo: "face" | "liquido",
): Promise<{
  dados: ItemLancamento[];
  semBaixa: number;
  semBaixaDefinitivo: number;
  pendentes: number;
}> {
  const comId = itens.filter((i) => i.id);
  if (!comId.length) {
    return { dados: itens, semBaixa: 0, semBaixaDefinitivo: 0, pendentes: 0 };
  }

  const t0 = Date.now();
  let comBaixa = 0;
  let semBaixa = 0;
  let semBaixaDefinitivo = 0;

  // Baixas ja conhecidas: cache de memoria + cache do Supabase.
  const baixasPorParcela = new Map<string, any[]>();
  const idsSemCache: string[] = [];
  for (const item of comId) {
    const parcelaId = String(item.id);
    const chave = `${empresa}:${parcelaId}`;
    const cached = baixaCache.get(chave);
    // Com o refresh forcado (pre-aquecimento do mes corrente) o cache de
    // memoria e ignorado: a baixa e buscada de novo na API.
    if (
      !forcarRefreshBaixas &&
      cached &&
      cached.exp > Date.now() &&
      cached.baixas &&
      cached.baixas.length
    ) {
      baixasPorParcela.set(parcelaId, cached.baixas);
    } else {
      idsSemCache.push(parcelaId);
    }
  }

  const doBanco = await lerBaixasDoSupabase(empresa, idsSemCache);
  const aindaFaltam: string[] = [];
  for (const parcelaId of idsSemCache) {
    const entrada = doBanco.get(parcelaId);
    if (entrada && entrada.baixas.length) {
      baixasPorParcela.set(parcelaId, entrada.baixas);
      // Tambem guarda em memoria (mesma validade do cache do banco) para as
      // proximas consultas.
      baixaCache.set(`${empresa}:${parcelaId}`, {
        exp: entrada.exp,
        baixas: entrada.baixas,
      });
    } else {
      aindaFaltam.push(parcelaId);
    }
  }

  // Chamadas a API para o que nao estava em nenhum cache.
  const novasParaGravar: { parcela_id: string; baixa: any[] }[] = [];
  // Status de cada parcela buscada: "ok" (veio a baixa), "vazio" (o titulo nao
  // tem baixa — definitivo) ou "falha" (erro transitorio — tenta de novo).
  const statusPorParcela = new Map<string, StatusBaixa>();
  let pendentes = 0;
  if (aindaFaltam.length) {
    const prazo = Date.now() + prazoBaixasMs;
    let idx = 0;
    async function worker() {
      while (true) {
        // Orcamento de tempo: quando acaba, o que sobrou fica para a proxima
        // carga (o cache no Supabase ja guardou o que foi buscado).
        if (Date.now() >= prazo) return;
        const meu = idx++;
        if (meu >= aindaFaltam.length) return;
        const parcelaId = aindaFaltam[meu];
        const r = await buscarBaixaDaParcela(empresa, parcelaId, tokenRef);
        statusPorParcela.set(parcelaId, r.status);
        if (!r.baixas || !r.baixas.length) continue;
        baixasPorParcela.set(parcelaId, r.baixas);
        novasParaGravar.push({ parcela_id: parcelaId, baixa: r.baixas });
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(CONCORRENCIA_BAIXAS, aindaFaltam.length) }, () => worker()),
    );
    // Titulos que nao chegaram a ser buscados (orcamento de tempo esgotado).
    pendentes = aindaFaltam.filter((id) => !statusPorParcela.has(id)).length;
    // Grava no cache persistente para as proximas cargas (em lote).
    await gravarBaixasNoSupabase(empresa, novasParaGravar);
  }

  // Aplica as baixas nos titulos.
  for (const item of comId) {
    const parcelaId = String(item.id);
    const baixas = baixasPorParcela.get(parcelaId);
    if (!baixas) {
      // "falha" = erro transitorio (a proxima carga tenta de novo);
      // "vazio" = o titulo nao tem baixa mesmo (nao adianta repetir);
      // sem status = nem chegou a ser buscado (orcamento de tempo).
      if (statusPorParcela.get(parcelaId) === "falha") semBaixa++;
      else if (statusPorParcela.get(parcelaId) === "vazio") semBaixaDefinitivo++;
      continue;
    }
    // A data exibida depende do periodo (a ultima baixa dentro dele).
    const baixa = extrairDadosBaixa(baixas, dataInicio, dataFim);
    if (!baixa) {
      semBaixaDefinitivo++;
      continue;
    }
    comBaixa++;

    // Data: a data REAL do pagamento/recebimento (a listagem so traz o
    // vencimento do titulo).
    if (baixa.data_pagamento) item.data = baixa.data_pagamento;

    // Composicao real do pagamento.
    item.desconto = baixa.desconto > 0 ? baixa.desconto : undefined;
    item.juros = baixa.juros > 0 ? baixa.juros : undefined;
    item.multa = baixa.multa > 0 ? baixa.multa : undefined;
    if (baixa.valor_pago > 0) item.valor_pago = baixa.valor_pago;

    // Banco/conta usada no pagamento (a listagem nao traz esse vinculo).
    if (baixa.banco) item.banco = baixa.banco;

    // Valor do titulo.
    const face = baixa.valor_bruto > 0 ? baixa.valor_bruto : (item._pago ?? 0);
    const liquido =
      baixa.valor_liquido > 0
        ? baixa.valor_liquido
        : face - baixa.desconto + baixa.juros + baixa.multa;
    if (face > 0 || liquido > 0) {
      item.valor = modo === "face" ? (face > 0 ? face : liquido) : liquido;
    }
  }

  log(
    "info",
    `enriquecerComBaixas ${empresa}: ${comBaixa}/${comId.length} titulos com baixa (${semBaixa} sem, ${semBaixaDefinitivo} sem baixa na API, ${pendentes} pendentes) | ` +
      `cache memoria ${comId.length - idsSemCache.length}, cache banco ${doBanco.size}, API ${novasParaGravar.length} | ` +
      `${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
  return { dados: itens, semBaixa, semBaixaDefinitivo, pendentes };
}

// ------------------- Contas efetivamente recebidas (baixadas) -------------------
// Espelho do buscarPagas, mas do lado do RECEBIMENTO: titulos de contas a
// receber quitados (recebidos) no periodo. A API pode atender por dois
// endpoints e o status de baixa pode vir como ACQUITTED ou PAGO, entao
// testamos as combinacoes em ordem e ficamos com a primeira que responder 200.
// O filtro de data e refeito no cliente: alguns endpoints/status ignoram o
// parametro de data da API.

const ENDPOINTS_RECEBIDAS = [
  "/v1/financeiro/contas-a-receber",
  "/v1/financeiro/eventos-financeiros/contas-a-receber/buscar",
];

const STATUS_RECEBIDAS = ["ACQUITTED", "PAGO"];

// Extrai a data de recebimento/baixa de um titulo (varias estruturas possiveis)
function extrairDataRecebimento(i: any): string | null {
  const candidatos = [
    i?.data_recebimento,
    i?.data_pagamento,
    i?.data_baixa,
    i?.data_quitacao,
    i?.baixas?.[0]?.data_recebimento,
    i?.baixas?.[0]?.data_pagamento,
    i?.baixas?.[0]?.data_baixa,
    i?.baixas?.[0]?.data_quitacao,
    i?.baixas?.[0]?.data,
    i?.parcelas?.[0]?.data_recebimento,
    i?.parcelas?.[0]?.data_pagamento,
    i?.parcelas?.[0]?.data_baixa,
  ];
  for (const c of candidatos) {
    if (typeof c === "string" && c.trim()) return c.slice(0, 10);
  }
  return null;
}

// Converte os itens da API em titulos recebidos, mantendo SO os que tem
// data de recebimento dentro do periodo. Funcao pura (testavel sem API).
export function processarRecebidas(
  itens: any[],
  dataInicio: string,
  dataFim: string,
): ItemLancamento[] {
  const brutos: ItemLancamento[] = [];
  for (const i of itens) {
    // CONTA AZUL — mesmo tratamento das pagas: `pago` e o valor CHEIO do
    // titulo e `total` e o LIQUIDO (ja com o desconto). Confirmado nas
    // listagens reais de contas a receber (status ACQUITTED, nao_pago = 0).
    // Exemplo real: "FAT. 1666" -> pago 29.000,00 (cheio) e total 8.339,00
    // (o valor efetivamente recebido, ja com o desconto do cliente).
    const bruto = (i.pago as number) || 0;
    const liquido = (i.total as number) || 0;
    // Recebimento parcial (nao_pago > 0): o `pago` e o que foi recebido.
    const parcial = ((i.nao_pago as number) || 0) > 0.005;

    // Mesmo tratamento de juros/multa/desconto das pagas, aplicado aos recebidos.
    let juros = extrairNumero(i, "juros", "valor_juros", "acrescimos", "juros_multa", "valor_acrescimo");
    let multa = extrairNumero(i, "multa", "valor_multa", "valor_multa_mora");
    let desconto = extrairNumero(i, "desconto", "valor_desconto", "abatimento", "valor_desconto_concedido", "desconto_concedido", "valor_desconto_baixa", "desconto_baixa");
    const valorPagoCampo = extrairNumero(i, "valor_pago", "valor_liquido", "valor_efetivo", "valor_baixa", "valor_pagamento", "valor_pago_liquido", "valor_pago_final");

    // A diferenca entre bruto e liquido e o desconto (liquido menor) ou os
    // juros/multa (liquido maior). A listagem nao traz esses campos, mas a
    // diferenca permite rotular o titulo e o card.
    const diferenca = bruto - liquido;
    if (!parcial && desconto <= 0 && juros <= 0 && multa <= 0) {
      if (diferenca > 0.005) desconto = diferenca;
      else if (diferenca < -0.005) juros = -diferenca;
    }

    // Valor recebido: o LIQUIDO (`total`), que ja tem o desconto aplicado.
    // O `pago` (bruto) era o que mostrava o titulo SEM o desconto.
    let valor: number;
    if (parcial) {
      valor = valorPagoCampo > 0 ? valorPagoCampo : bruto;
    } else if (liquido > 0) {
      valor = liquido;
    } else {
      valor = valorPagoCampo > 0 ? valorPagoCampo : bruto;
    }
    if (!i.id || valor <= 0) continue;
    // Data: a listagem so traz o VENCIMENTO do titulo; a data real do
    // recebimento chega no enriquecimento com a baixa da parcela.
    const dataReal = extrairDataRecebimento(i);
    const data =
      dataReal ||
      // Ultimo recurso: se o titulo nao trouxer a data de recebimento, usamos o
      // vencimento como aproximacao (a baixa corrige depois).
      (i.data_vencimento ? String(i.data_vencimento).slice(0, 10) : null);
    if (!data) continue;
    // So descarta o titulo quando a propria API traz a data REAL de recebimento
    // e ela esta fora do periodo. Descartar pelo VENCIMENTO perdia dinheiro que
    // entrou no periodo (ex.: titulo vencido em 29/07 e recebido em 13/10).
    if (dataReal && (dataReal < dataInicio || dataReal > dataFim)) continue;
    brutos.push({
      data,
      valor,
      metodo: null,
      id: String(i.id),
      conta_id: extrairContaId(i),
      descricao: extrairDescricao(i),
      terceiro: extrairTerceiro(i),
      categoria: extrairCategoria(i),
      juros: juros || undefined,
      multa: multa || undefined,
      desconto: desconto || undefined,
      valor_pago: valorPagoCampo || undefined,
      ...(i.baixas?.[0]?.id ? { baixa_id: String(i.baixas[0].id) } : {}),
      ...(i.parcelas?.[0]?.id ? { parcela_id: String(i.parcelas[0].id) } : {}),
      _pago: bruto,
      _total: liquido,
    });
  }
  return brutos;
}

export async function buscarRecebidas(
  empresa: string,
  dataInicio: string,
  dataFim: string,
): Promise<ResultadoLista> {
  // Refresh forcado (pre-aquecimento): contorna o cache de lista (ver buscarPagas).
  if (forcarRefreshBaixas) {
    return await buscarRecebidasInterna(empresa, dataInicio, dataFim);
  }
  const cacheKey = `recebidas:${empresa}:${dataInicio}:${dataFim}`;
  const r = await lerOuCriar(
    listCache,
    cacheKey,
    LIST_TTL_MS,
    () => buscarRecebidasInterna(empresa, dataInicio, dataFim),
    // So um resultado COMPLETO fica no cache (ver buscarPagas).
    (x) => x.ok && !x.sem_baixa && !x.baixas_pendentes,
  );
  return {
    dados: r.dados,
    ok: r.ok,
    incompleto: r.incompleto,
    sem_baixa: r.sem_baixa,
    sem_baixa_definitivo: r.sem_baixa_definitivo,
    baixas_pendentes: r.baixas_pendentes,
  };
}

async function buscarRecebidasInterna(
  empresa: string,
  dataInicio: string,
  dataFim: string,
): Promise<ResultadoLista> {
  const tokenInicial = await obterToken(empresa);
  if (!tokenInicial) {
    log("warn", `buscarRecebidas sem token: ${empresa}`);
    return { dados: [], ok: false, incompleto: true };
  }
  const tokenRef = { token: tokenInicial };

  // Janela de vencimento: a API exige data_vencimento_de/_ate mesmo quando o
  // filtro real e por data de recebimento (ver JANELA_VENCIMENTO_DIAS).
  const vencInicio = new Date(dataInicio + "T00:00:00Z");
  vencInicio.setUTCDate(vencInicio.getUTCDate() - JANELA_VENCIMENTO_DIAS);
  const vencFim = new Date(dataFim + "T00:00:00Z");
  vencFim.setUTCDate(vencFim.getUTCDate() + 30);
  const venc = {
    data_vencimento_de: vencInicio.toISOString().slice(0, 10),
    data_vencimento_ate: vencFim.toISOString().slice(0, 10),
  };

  // Marcador de resultado PARCIAL (mesma logica de buscarPagasInterna): alguma
  // pagina nao pôde ser lida por erro transitório, entao `dados` pode estar
  // incompleto e NAO pode ser tratado como final nem cacheado.
  let incompleto = false;
  // Melhor colecao parcial obtida, devolvida como fallback.
  let parcial: ItemLancamento[] = [];

  for (const endpoint of ENDPOINTS_RECEBIDAS) {
    for (const status of STATUS_RECEBIDAS) {
      const brutos: ItemLancamento[] = [];
      let falhaTransitoria = false;

      // Paginas em PARALELO (3 por vez) a partir do `itens_totais` da
      // primeira: economiza segundos no periodo com muitos titulos.
      // Se uma pagina falhar no meio (rate limit), a paginacao RECOMECA do
      // zero em vez de devolver os itens ja lidos como se fossem todos.
      for (let passe = 1; passe <= MAX_PASSES_PAGINACAO; passe++) {
        brutos.length = 0;
        falhaTransitoria = false;

        const urlDaPagina = (pagina: number) => {
          const params = new URLSearchParams({
            ...venc,
            data_pagamento_de: dataInicio,
            data_pagamento_ate: dataFim,
            status,
            tamanho_pagina: "100",
            pagina: String(pagina),
          });
          return `https://api-v2.contaazul.com${endpoint}?${params}`;
        };

        const r = await listarTodasPaginas(empresa, urlDaPagina, tokenRef);

        if (r.falhou) {
          // Erro transitorio persistente: reinicia a paginacao inteira.
          falhaTransitoria = true;
          brutos.push(...processarRecebidas(r.itens, dataInicio, dataFim));
          log(
            "warn",
            `buscarRecebidas ${empresa} [${endpoint} status=${status}] paginacao falhou — reiniciando (passe ${passe}/${MAX_PASSES_PAGINACAO})`,
          );
          await sleep(1500 * passe); // espera a API liberar antes de recomecar
          continue;
        }

        if (r.erroDefinitivo) {
          // Erro definitivo (4xx fora de 401/429): nao adianta repetir —
          // pula para a proxima combinacao de endpoint/status.
          log(
            "warn",
            `buscarRecebidas ${empresa} ${endpoint} (filtro status=${status}) — seguindo para outra combinacao`,
          );
          break;
        }

        brutos.push(...processarRecebidas(r.itens, dataInicio, dataFim));
        break; // paginacao concluida
      }

      if (falhaTransitoria) {
        incompleto = true;
        if (brutos.length > parcial.length) parcial = brutos;
        continue;
      }

      if (brutos.length > 0) {
        if (incompleto) {
          // Alguma combinacao anterior falhou: nao da para garantir que esta
          // lista cobre todos os titulos. Guarda como parcial e segue.
          if (brutos.length > parcial.length) parcial = brutos;
          continue;
        }
        // Enriquece os titulos com a BAIXA da parcela: data real do recebimento
        // e valor (face ou liquido, conforme VALOR_RECEBIDAS).
        const { dados: enriquecidos, semBaixa, semBaixaDefinitivo, pendentes } =
          await enriquecerComBaixas(
            empresa,
            brutos,
            tokenRef,
            dataInicio,
            dataFim,
            VALOR_RECEBIDAS,
          );
        const total = enriquecidos.reduce((a, b) => a + b.valor, 0);
        log(
          "info",
          `buscarRecebidas ${empresa} [${endpoint} status=${status}]: ${brutos.length} titulos recebidos em ${dataInicio}..${dataFim} (total ${total.toFixed(2)})`,
        );
        return {
          dados: enriquecidos,
          ok: true,
          sem_baixa: semBaixa,
          sem_baixa_definitivo: semBaixaDefinitivo,
          baixas_pendentes: pendentes,
        };
      }
      // Esta combinacao respondeu completa e sem titulos: tenta a proxima.
    }
  }

  if (incompleto) {
    log(
      "warn",
      `buscarRecebidas ${empresa}: paginacao nao concluiu — devolvendo ${parcial.length} titulo(s) parcial(is), resultado NAO cacheado`,
    );
    return { dados: parcial, ok: false, incompleto: true };
  }

  // Todas as combinacoes responderam completas e sem titulos no periodo:
  // resultado vazio valido (cacheavel — evita refazer a busca a cada carga).
  log("warn", `buscarRecebidas ${empresa}: nenhuma combinacao de endpoint/status trouxe titulos`);
  return { dados: [], ok: true };
}

// Inspeciona o detalhe de N itens — usado pelo painel de debug pra ver o JSON cru.
export async function inspecionarPrimeirosRecebimentos(
  empresa: string,
  dataInicio: string,
  dataFim: string,
  limite = 3,
) {
  const token = await obterToken(empresa);
  if (!token) return { erro: "sem token" };
  const tokenRef = { token };
  const params = new URLSearchParams({
    data_vencimento_de: dataInicio,
    data_vencimento_ate: dataFim,
    status: "EM_ABERTO",
    tamanho_pagina: "20",
    pagina: "1",
  });
  const endpoint = "/v1/financeiro/eventos-financeiros/contas-a-receber/buscar";
  const url = `https://api-v2.contaazul.com${endpoint}?${params}`;
  const res = await fetchComRetry(url, { headers: { Authorization: `Bearer ${tokenRef.token}` } }, 5, empresa);
  if (!res.ok) return { erro: `lista ${res.status}` };
  const j: any = await res.json();
  const itens: any[] = (j.itens || []).slice(0, limite);
  const detalhes = itens.map((i) => ({
    id: String(i.id),
    forma_pagamento: i.forma_pagamento ?? null,
    parcelas: i.parcelas?.map((p: any) => p.forma_pagamento ?? null) ?? null,
    baixas: i.baixas?.map((b: any) => b.forma_pagamento ?? null) ?? null,
    metodo_extraido: extrairMetodo(i),
    bruto: i,
  }));
  return { lista_amostra: j.itens?.[0] || null, detalhes };
}

// ============================================================================
// Consultas de Baixa — Conforme documentação técnica:
//   GET /v1/financeiro/eventos-financeiros/parcelas/baixa/{baixa_id}
//   GET /v1/financeiro/eventos-financeiros/parcelas/{parcela_id}/baixa
// O valor de desconto/juros está em valor_composicao.desconto / valor_composicao.juros.
// ============================================================================

export type ValorComposicao = {
  desconto?: number;
  juros?: number;
  multa?: number;
  valor_bruto?: number;
};

export type BaixaDetalhe = {
  id: string;
  data_pagamento?: string | null;
  valor_composicao: ValorComposicao;
  metodo?: string | null;
  terceiro?: string | null;
  descricao?: string | null;
  valor_pago?: number | null;
};

/**
 * Consulta os detalhes de uma baixa pelo ID da baixa.
 * Endpoint: GET /v1/financeiro/eventos-financeiros/parcelas/baixa/{baixa_id}
 */
export async function buscarBaixaPorId(
  empresa: string,
  baixaId: string,
): Promise<{ dados: BaixaDetalhe | null; ok: boolean }> {
  const tokenInicial = await obterToken(empresa);
  if (!tokenInicial) {
    log("warn", `buscarBaixaPorId sem token: ${empresa}`);
    return { dados: null, ok: false };
  }
  const tokenRef = { token: tokenInicial };

  const url = `https://api-v2.contaazul.com/v1/financeiro/eventos-financeiros/parcelas/baixa/${baixaId}`;
  let res = await fetchComRetry(url, {
    headers: { Authorization: `Bearer ${tokenRef.token}` },
  }, 2, empresa);

  if (res.status === 401) {
    const novo = await renovarToken(empresa);
    if (novo) {
      tokenRef.token = novo;
      res = await fetchComRetry(url, {
        headers: { Authorization: `Bearer ${novo}` },
      }, 1, empresa);
    } else {
      return { dados: null, ok: false };
    }
  }

  if (!res.ok) {
    log("warn", `buscarBaixaPorId ${empresa} baixaId=${baixaId} status=${res.status}`);
    return { dados: null, ok: false };
  }

  const j: any = await res.json();
  const item = j ?? {};
  const vc = item.valor_composicao ?? {};

  return {
    dados: {
      id: String(item.id ?? baixaId),
      data_pagamento: item.data_pagamento ?? null,
      valor_composicao: {
        desconto: typeof vc.desconto === "number" ? vc.desconto : (vc.desconto ? Number(vc.desconto) : undefined),
        juros: typeof vc.juros === "number" ? vc.juros : (vc.juros ? Number(vc.juros) : undefined),
        multa: typeof vc.multa === "number" ? vc.multa : (vc.multa ? Number(vc.multa) : undefined),
        valor_bruto: typeof vc.valor_bruto === "number" ? vc.valor_bruto : (vc.valor_bruto ? Number(vc.valor_bruto) : undefined),
      },
      metodo: extrairMetodo(item) ?? null,
      terceiro: extrairTerceiro(item) ?? null,
      descricao: extrairDescricao(item) ?? null,
      valor_pago: item.valor_pago ?? item.pago ?? null,
    },
    ok: true,
  };
}

/**
 * Consulta os detalhes de uma baixa pelo ID da parcela.
 * Endpoint: GET /v1/financeiro/eventos-financeiros/parcelas/{parcela_id}/baixa
 */
export async function buscarBaixaPorParcela(
  empresa: string,
  parcelaId: string,
): Promise<{ dados: BaixaDetalhe | null; ok: boolean }> {
  const tokenInicial = await obterToken(empresa);
  if (!tokenInicial) {
    log("warn", `buscarBaixaPorParcela sem token: ${empresa}`);
    return { dados: null, ok: false };
  }
  const tokenRef = { token: tokenInicial };

  const url = `https://api-v2.contaazul.com/v1/financeiro/eventos-financeiros/parcelas/${parcelaId}/baixa`;
  let res = await fetchComRetry(url, {
    headers: { Authorization: `Bearer ${tokenRef.token}` },
  }, 2, empresa);

  if (res.status === 401) {
    const novo = await renovarToken(empresa);
    if (novo) {
      tokenRef.token = novo;
      res = await fetchComRetry(url, {
        headers: { Authorization: `Bearer ${novo}` },
      }, 1, empresa);
    } else {
      return { dados: null, ok: false };
    }
  }

  if (!res.ok) {
    log("warn", `buscarBaixaPorParcela ${empresa} parcelaId=${parcelaId} status=${res.status}`);
    return { dados: null, ok: false };
  }

  const j: any = await res.json();
  // O endpoint /parcelas/{parcela_id}/baixa devolve um ARRAY de baixas (o
  // /baixa/{baixa_id} devolve um objeto). Sem desembrulhar o array o
  // `valor_composicao` nunca era encontrado e o desconto ficava sempre vazio.
  const item = Array.isArray(j) ? (j[0] ?? {}) : (j ?? {});
  const vc = item.valor_composicao ?? {};

  return {
    dados: {
      id: String(item.id ?? parcelaId),
      data_pagamento: item.data_pagamento ?? null,
      valor_composicao: {
        desconto: typeof vc.desconto === "number" ? vc.desconto : (vc.desconto ? Number(vc.desconto) : undefined),
        juros: typeof vc.juros === "number" ? vc.juros : (vc.juros ? Number(vc.juros) : undefined),
        multa: typeof vc.multa === "number" ? vc.multa : (vc.multa ? Number(vc.multa) : undefined),
        valor_bruto: typeof vc.valor_bruto === "number" ? vc.valor_bruto : (vc.valor_bruto ? Number(vc.valor_bruto) : undefined),
      },
      metodo: extrairMetodo(item) ?? null,
      terceiro: extrairTerceiro(item) ?? null,
      descricao: extrairDescricao(item) ?? null,
      valor_pago: item.valor_pago ?? item.pago ?? null,
    },
    ok: true,
  };
}

/**
 * Atualiza retroativamente o desconto e/ou juros de uma baixa já realizada.
 * Endpoint: PATCH /v1/financeiro/eventos-financeiros/parcelas/baixa/{baixa_id}
 * Requer a versão atual do registro (campo `versao` no body).
 */
export type AtualizarBaixaInput = {
  baixaId: string;
  desconto?: number;
  juros?: number;
  multa?: number;
  versao: string | number;
};

export async function atualizarBaixa(
  empresa: string,
  input: AtualizarBaixaInput,
): Promise<{ ok: boolean; erro?: string; dados?: any }> {
  const tokenInicial = await obterToken(empresa);
  if (!tokenInicial) {
    log("warn", `atualizarBaixa sem token: ${empresa}`);
    return { ok: false, erro: "sem_token" };
  }

  const url = `https://api-v2.contaazul.com/v1/financeiro/eventos-financeiros/parcelas/baixa/${input.baixaId}`;

  const body: any = { versao: input.versao };
  if (input.desconto !== undefined) body.desconto = input.desconto;
  if (input.juros !== undefined) body.juros = input.juros;
  if (input.multa !== undefined) body.multa = input.multa;

  // Mesma fila de taxa das demais chamadas da empresa.
  await esperarVagaApi(empresa);
  let res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${tokenInicial}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (res.status === 401) {
    const novo = await renovarToken(empresa);
    if (novo) {
      await esperarVagaApi(empresa);
      res = await fetch(url, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${novo}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } else {
      return { ok: false, erro: "token_invalido" };
    }
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    log("warn", `atualizarBaixa ${empresa} baixaId=${input.baixaId} status=${res.status} ${txt.slice(0, 300)}`);
    return { ok: false, erro: `http_${res.status}`, dados: txt };
  }

  try {
    const dados = await res.json();
    log("info", `atualizarBaixa ${empresa} baixaId=${input.baixaId} ok`);
    return { ok: true, dados };
  } catch {
    return { ok: true };
  }
}

/**
 * Lista transferências e extrai os juros da conta de destino.
 * Endpoint: GET /v1/financeiro/transferencias
 * Caminho no JSON: itens[].destino.composicao_valor.juros
 */
export type TransferenciaJuros = {
  id: string;
  data?: string | null;
  destino_nome?: string | null;
  banco_destino?: string | null;
  juros_destino: number;
  valor?: number | null;
};

export async function buscarTransferenciasJuros(
  empresa: string,
  dataInicio?: string,
  dataFim?: string,
): Promise<{ dados: TransferenciaJuros[]; ok: boolean }> {
  const tokenInicial = await obterToken(empresa);
  if (!tokenInicial) {
    log("warn", `buscarTransferenciasJuros sem token: ${empresa}`);
    return { dados: [], ok: false };
  }

  const params = new URLSearchParams();
  if (dataInicio) params.set("data_de", dataInicio);
  if (dataFim) params.set("data_ate", dataFim);

  const url = `https://api-v2.contaazul.com/v1/financeiro/transferencias${params.toString() ? "?" + params.toString() : ""}`;
  let res = await fetchComRetry(url, {
    headers: { Authorization: `Bearer ${tokenInicial}` },
  }, 2, empresa);

  if (res.status === 401) {
    const novo = await renovarToken(empresa);
    if (novo) {
      res = await fetchComRetry(url, {
        headers: { Authorization: `Bearer ${novo}` },
      }, 1, empresa);
    } else {
      return { dados: [], ok: false };
    }
  }

  if (!res.ok) {
    log("warn", `buscarTransferenciasJuros ${empresa} status=${res.status}`);
    return { dados: [], ok: false };
  }

  const j: any = await res.json();
  const itens: any[] = Array.isArray(j) ? j : (j.itens || []);

  const dados: TransferenciaJuros[] = itens.map((t) => {
    const destino = t.destino ?? {};
    const composicao = destino.composicao_valor ?? {};
    const juros = typeof composicao.juros === "number"
      ? composicao.juros
      : (composicao.juros ? Number(composicao.juros) : 0);

    return {
      id: String(t.id ?? ""),
      data: t.data ?? t.data_transferencia ?? null,
      destino_nome: destino.nome ?? destino.titular ?? null,
      banco_destino: destino.banco ?? destino.conta_bancaria ?? null,
      juros_destino: juros,
      valor: t.valor ?? null,
    };
  });

  return { dados, ok: true };
}
