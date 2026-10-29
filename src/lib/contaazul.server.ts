import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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
type LogEntry = { ts: number; nivel: "info" | "warn" | "error"; msg: string };
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
  data: string;
  valor: number;
  metodo: string | null;
  conta_id?: string;
  descricao?: string | null;
  terceiro?: string | null;
};

type EntradaCache<T> = { promessa: Promise<T>; exp: number };

const detalheCache = new Map<string, EntradaCache<{ metodo: string | null; erro: boolean }>>();
const DETALHE_TTL_MS = 5 * 60 * 1000;

const listCache = new Map<string, EntradaCache<{ dados: ItemLancamento[]; ok: boolean }>>();
const LIST_TTL_MS = 2 * 60 * 1000; // 2 minutos de cache para listas

const saldoCache = new Map<
  string,
  EntradaCache<{ lista: { nome: string; saldo: number }[]; ok: boolean; todas: ContaSaldo[] }>
>();
const SALDO_TTL_MS = 2 * 60 * 1000; // 2 minutos de cache para saldos

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
async function fetchComRetry(
  url: string,
  init: RequestInit,
  tentativas = 5,
): Promise<Response> {
  let ultErro: any = null;
  for (let i = 0; i < tentativas; i++) {
    try {
      const r = await fetch(url, init);
      // 429 / 5xx: retry com backoff
      if (r.status === 429 || (r.status >= 500 && r.status < 600)) {
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

// Deduplica refreshes concorrentes por empresa (evita invalidar refresh_token rotacionado)
const refreshEmAndamento = new Map<string, Promise<string | null>>();

async function executarRefresh(empresa: string): Promise<string | null> {
  const sb = getSupabase();
  const { data } = await sb
    .from("tokens")
    .select("refresh_token,access_token,updated_at")
    .eq("empresa", empresa)
    .limit(1);
  if (!data || !data.length) return null;
  const refresh = data[0].refresh_token;

  if (data[0].updated_at) {
    const idadeMs = Date.now() - new Date(data[0].updated_at).getTime();
    if (idadeMs < 30_000 && data[0].access_token) return data[0].access_token;
  }

  log("info", `renovando token: ${empresa}`);
  const res = await pedirToken({
    grant_type: "refresh_token",
    refresh_token: refresh,
  });

  if (res.ok) {
    const j: any = await res.json();
    await sb
      .from("tokens")
      .update({
        access_token: j.access_token,
        refresh_token: j.refresh_token,
        status: "ATIVO",
        mensagem_erro: null,
        updated_at: new Date().toISOString(),
      })
      .eq("empresa", empresa);
    log("info", `token renovado: ${empresa}`);
    return j.access_token;
  }

  const txt = await res.text();
  const corpoLower = txt.toLowerCase();
  const ehInvalidGrant =
    res.status === 400 && (corpoLower.includes("invalid_grant") || corpoLower.includes("invalid_token"));
  if (ehInvalidGrant) {
    await sb
      .from("tokens")
      .update({
        status: "ERRO",
        mensagem_erro: `Token revogado: ${res.status} ${txt.slice(0, 200)}`,
        updated_at: new Date().toISOString(),
      })
      .eq("empresa", empresa);
    log("error", `token revogado: ${empresa} -> ${txt.slice(0, 200)}`);
  } else {
    log("warn", `refresh falhou (transitório): ${empresa} ${res.status}`);
  }
  return null;
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
    .select("access_token,status")
    .eq("empresa", empresa)
    .limit(1);
  if (data && data.length) {
    if (data[0].status === "ERRO") return renovarToken(empresa);
    if (data[0].access_token) return data[0].access_token;
  }
  return renovarToken(empresa);
}

const BANCOS_PERMITIDOS = [
  "ITAU",
  "BRADESCO",
  "SICOOB",
  "SICOOB 3109",
  "SICREDI",
  "SANTANDER",
  "BANCO DO BRASIL",
  "NUBANK",
  "INTER",
];

// Uma conta financeira retornada pela API da Conta Azul, com o motivo de ela
// potencialmente nao aparecer no painel (saldo zerado ou falha ao buscar saldo).
export type ContaSaldo = { nome: string; saldo: number; erro: boolean };

export async function buscarSaldos(
  empresa: string,
  tokenInicial: string,
): Promise<{ lista: { nome: string; saldo: number }[]; ok: boolean; todas: ContaSaldo[] }> {
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
): Promise<{ lista: { nome: string; saldo: number }[]; ok: boolean; todas: ContaSaldo[] }> {
  const lista: { nome: string; saldo: number }[] = [];
  const todas: ContaSaldo[] = [];

  const { ok, contas, token } = await listarContasFinanceiras(empresa, tokenInicial);
  if (!ok) {
    log("warn", `buscarSaldos ${empresa} nao foi possivel listar contas financeiras`);
    return { lista, ok: false, todas };
  }

  const resps = await Promise.all(
    contas.map(async (c) => {
      const r = await fetchComRetry(
        `https://api-v2.contaazul.com/v1/conta-financeira/${c.id}/saldo-atual`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (r.ok) {
        const sj: any = await r.json();
        return {
          nome: String(c.nome ?? "").trim(),
          saldo: (sj.saldo_atual as number) || 0,
          erro: false as const,
        };
      }
      log("warn", `buscarSaldos saldo-atual falhou: ${empresa} / ${c.nome} status=${r.status}`);
      return { nome: String(c.nome ?? "").trim(), saldo: 0, erro: true as const };
    }),
  );

  for (const r of resps) {
    todas.push(r);
    if (!r.erro) lista.push({ nome: r.nome, saldo: r.saldo });
  }

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
    let res = await fetchComRetry(url, { headers: { Authorization: `Bearer ${tokenRef.token}` } });
    
    if (res.status === 401) {
      const novo = await renovarToken(empresa);
      if (!novo) return { metodo: null, erro: true };
      tokenRef.token = novo;
      res = await fetchComRetry(url, { headers: { Authorization: `Bearer ${tokenRef.token}` } });
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
      let res = await fetchComRetry(url, { headers: { Authorization: `Bearer ${tokenRef.token}` } });
      if (res.status === 401 && tentativasReauth < 1) {
        const novo = await renovarToken(empresa);
        if (!novo) return { metodo: null, erro: true };
        tokenRef.token = novo;
        tentativasReauth++;
        res = await fetchComRetry(url, { headers: { Authorization: `Bearer ${tokenRef.token}` } });
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
    let res = await fetchComRetry(url, { headers: { Authorization: `Bearer ${tokenRef.token}` } });

    if (res.status === 401 && tentativasReauth < 1) {
      const novo = await renovarToken(empresa);
      if (!novo) {
        erro = true;
        break;
      }
      tokenRef.token = novo;
      tentativasReauth++;
      res = await fetchComRetry(url, { headers: { Authorization: `Bearer ${tokenRef.token}` } });
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
  const brutos: {
    id: string;
    data: string;
    valor: number;
    metodo: string | null;
    conta_id?: string;
    descricao?: string | null;
    terceiro?: string | null;
  }[] = [];
  let pagina = 1;
  let tentativasReauth = 0;
  const ehReceber = endpoint.includes("contas-a-receber");

  while (true) {
    const params = new URLSearchParams({
      data_vencimento_de: dataInicio,
      data_vencimento_ate: dataFim,
      status: "EM_ABERTO",
      tamanho_pagina: "100",
      pagina: String(pagina),
    });
    const url = `https://api-v2.contaazul.com${endpoint}?${params}`;
    const res = await fetchComRetry(url, { headers: { Authorization: `Bearer ${tokenRef.token}` } });

    if (res.status === 401 && tentativasReauth < 1) {
      const novo = await renovarToken(empresa);
      if (!novo) {
        teveErroGeral = true;
        break;
      }
      tokenRef.token = novo;
      tentativasReauth++;
      continue;
    }
    if (!res.ok) {
      log("warn", `buscarV2 ${empresa} pg=${pagina} status=${res.status}`);
      teveErroGeral = true;
      break;
    }

    const j: any = await res.json();
    const itens: any[] = j.itens || [];
    if (!itens.length) break;

    for (const i of itens) {
      const dv = i.data_vencimento ? String(i.data_vencimento).slice(0, 10) : null;
      const aberto = (i.total || 0) - (i.pago || 0);
      if (dv && aberto > 0 && i.id) {
        const metodoInicial = extrairMetodo(i);
        brutos.push({ 
          id: String(i.id), 
          data: dv, 
          valor: aberto,
          metodo: metodoInicial,
          conta_id: i.conta_financeira_id || i.conta_id || undefined,
          descricao: extrairDescricao(i),
          terceiro: extrairTerceiro(i),
        });
      }
    }
    if (itens.length < 100) break;
    pagina++;
    tentativasReauth = 0;
  }

  if (!ehReceber) {
    const resultado: ItemLancamento[] = brutos.map((b) => ({
      data: b.data,
      valor: b.valor,
      metodo: null,
      conta_id: b.conta_id,
      descricao: b.descricao ?? null,
      terceiro: b.terceiro ?? null,
    }));
    if (teveErroGeral) {
      log("warn", `buscarV2 finalizou com erros para ${empresa} (pagar). Dados não cacheados.`);
    }
    return { dados: resultado, ok: !teveErroGeral };
  }

  // Para contas a receber, primeiro tenta buscar métodos via lista de contas-a-receber
  const { mapa: metodoPorId, erro: erroMetodosLista } = await buscarMetodoPorListaReceber(empresa, dataInicio, dataFim, tokenRef);
  if (erroMetodosLista) {
    teveErroGeral = true;
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
  }[] = new Array(brutos.length);
  let idx = 0;
  let boletos = 0;
  let comMetodo = 0;

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
        const resDet = await buscarDetalheFormaPagamento(empresa, endpoint, b.id, tokenRef);
        metodo = resDet.metodo;
        if (resDet.erro) {
          teveErroGeral = true;
        }
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
      };
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCORRENCIA, brutos.length) }, worker));
  log(
    "info",
    `${empresa} a_receber=${brutos.length} com_metodo=${comMetodo} boletos=${boletos}`,
  );

  if (teveErroGeral) {
    log("warn", `buscarV2 finalizou com erros para ${empresa} (receber). Dados não cacheados.`);
  }
  return { dados: resultado, ok: !teveErroGeral };
}

// ------------------- Contas efetivamente pagas (baixadas) -------------------
// Busca titulos de contas a pagar com status PAGO baixados no periodo, usando o
// filtro data_pagamento_de/_ate da API. Diferente do buscarV2 (que traz titulos
// EM_ABERTO pelo vencimento), aqui o que interessa e a DATA REAL do pagamento.

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
): Promise<{ dados: ItemLancamento[]; ok: boolean }> {
  const cacheKey = `pagas:${empresa}:${dataInicio}:${dataFim}`;
  const r = await lerOuCriar(
    listCache,
    cacheKey,
    LIST_TTL_MS,
    () => buscarPagasInterna(empresa, dataInicio, dataFim),
    (x) => x.ok,
  );
  return { dados: r.dados, ok: r.ok };
}

// Pagina um endpoint de listagem de contas a pagar ate esgotar as paginas.
async function paginarPagas(
  urlBase: string,
  params: URLSearchParams,
  tokenRef: { token: string },
  empresa: string,
): Promise<{ itens: any[]; ok: boolean }> {
  const itens: any[] = [];
  let pagina = 1;
  let tentativasReauth = 0;

  while (pagina <= 50) {
    const url = `${urlBase}?${params.toString()}&pagina=${pagina}&tamanho_pagina=100`;
    const res = await fetchComRetry(url, { headers: { Authorization: `Bearer ${tokenRef.token}` } });

    if (res.status === 401 && tentativasReauth < 1) {
      const novo = await renovarToken(empresa);
      if (!novo) return { itens, ok: false };
      tokenRef.token = novo;
      tentativasReauth++;
      continue;
    }
    if (!res.ok) {
      log("warn", `buscarPagas ${empresa} pg=${pagina} status=${res.status} url=${urlBase}`);
      return { itens, ok: false };
    }

    const j: any = await res.json();
    const lista: any[] = j.itens || (Array.isArray(j) ? j : []);
    if (!lista.length) break;
    itens.push(...lista);
    if (lista.length < 100) break;
    pagina++;
    tentativasReauth = 0;
  }
  return { itens, ok: true };
}

async function buscarPagasInterna(
  empresa: string,
  dataInicio: string,
  dataFim: string,
): Promise<{ dados: ItemLancamento[]; ok: boolean }> {
  const tokenInicial = await obterToken(empresa);
  if (!tokenInicial) {
    log("warn", `buscarPagas sem token: ${empresa}`);
    return { dados: [], ok: false };
  }
  const tokenRef = { token: tokenInicial };

  // Janela de vencimento generosa: a API exige data_vencimento_de/_ate mesmo
  // quando o filtro real e por data de pagamento (titulo vencido pode ser pago
  // no periodo; pagamento antecipado de titulo futuro tambem entra).
  const vencInicio = new Date(dataInicio + "T00:00:00Z");
  vencInicio.setUTCDate(vencInicio.getUTCDate() - 365);
  const vencFim = new Date(dataFim + "T00:00:00Z");
  vencFim.setUTCDate(vencFim.getUTCDate() + 30);
  const venc = {
    data_vencimento_de: vencInicio.toISOString().slice(0, 10),
    data_vencimento_ate: vencFim.toISOString().slice(0, 10),
  };

  // Cadeia de tentativas: (1) endpoint documentado /v1/financeiro/contas-a-pagar
  // com filtro de pagamento + status PAGO; (2) o mesmo no /buscar de eventos;
  // (3) sem filtro de pagamento/status (filtragem no cliente). Alguma delas
  // funciona mesmo quando a API rejeita combinacoes de parametros.
  const tentativas: { url: string; params: Record<string, string> }[] = [
    {
      url: "https://api-v2.contaazul.com/v1/financeiro/contas-a-pagar",
      params: { ...venc, data_pagamento_de: dataInicio, data_pagamento_ate: dataFim, status: "PAGO" },
    },
    {
      url: "https://api-v2.contaazul.com/v1/financeiro/eventos-financeiros/contas-a-pagar/buscar",
      params: { ...venc, data_pagamento_de: dataInicio, data_pagamento_ate: dataFim, status: "PAGO" },
    },
    {
      url: "https://api-v2.contaazul.com/v1/financeiro/contas-a-pagar",
      params: { ...venc },
    },
  ];

  let itensBrutos: any[] = [];
  let filtroServidor = false;
  let achou = false;
  for (const t of tentativas) {
    const r = await paginarPagas(t.url, new URLSearchParams(t.params), tokenRef, empresa);
    if (r.ok) {
      itensBrutos = r.itens;
      filtroServidor = "data_pagamento_de" in t.params;
      achou = true;
      log(
        "info",
        `buscarPagas ${empresa}: endpoint ok (${t.url.replace("https://api-v2.contaazul.com", "")}, ${r.itens.length} itens, filtro_servidor=${filtroServidor})`,
      );
      break;
    }
  }
  if (!achou) {
    log("warn", `buscarPagas ${empresa}: todos os endpoints falharam`);
    return { dados: [], ok: false };
  }

  // Consolidacao: valor efetivamente pago + data real de pagamento
  const brutos: ItemLancamento[] = [];
  let semData = 0;
  for (const i of itensBrutos) {
    const pago = (i.pago as number) || 0;
    const total = (i.total as number) || 0;
    // Sem filtro de status no servidor, so entra o que tem valor pago > 0
    if (!filtroServidor && pago <= 0) continue;
    const valor = pago > 0 ? pago : total;
    if (!i.id || valor <= 0) continue;
    const dataPagamento = extrairDataPagamento(i);
    // Sem filtro de pagamento no servidor, exige data de pagamento dentro do
    // periodo (se o titulo nao expoe a data, fica de fora para nao inflar).
    if (!filtroServidor) {
      if (!dataPagamento) {
        semData++;
        continue;
      }
      if (dataPagamento < dataInicio || dataPagamento > dataFim) continue;
    }
    const data =
      dataPagamento ||
      (i.data_vencimento ? String(i.data_vencimento).slice(0, 10) : null);
    if (!data) continue;
    brutos.push({
      data,
      valor,
      metodo: null,
      conta_id: i.conta_financeira_id || i.conta_id || undefined,
      descricao: extrairDescricao(i),
      terceiro: extrairTerceiro(i),
    });
  }

  const total = brutos.reduce((a, b) => a + b.valor, 0);
  log(
    "info",
    `buscarPagas ${empresa}: ${brutos.length} titulos pagos em ${dataInicio}..${dataFim} (total ${total.toFixed(2)}, sem_data=${semData})`,
  );
  return { dados: brutos, ok: true };
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
  const res = await fetchComRetry(url, { headers: { Authorization: `Bearer ${tokenRef.token}` } });
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
