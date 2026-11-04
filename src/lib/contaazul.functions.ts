import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  getSupabase,
  pedirToken,
  log,
  obterToken,
  executarRenovacaoEmLote,
  buscarSaldos,
  buscarV2,
  buscarPagas,
  buscarRecebidas,
  filtrarPorBancos,
  mapaContaParaBanco,
  removerAcentos,
  getLogs,
  limparLogs,
  inspecionarPrimeirosRecebimentos,
  limparCacheDetalhes,
  enviarAlertaSlack,
  gravarLogEvento,
  cronSecret,
  buscarBaixaPorId,
  buscarBaixaPorParcela,
  atualizarBaixa,
  buscarTransferenciasJuros,
  type BaixaDetalhe,
  type TransferenciaJuros,
  type AtualizarBaixaInput,
} from "./contaazul.server";
import { buscarFaturamentoPlanilha, limparCachePlanilha, lerTituloPlanilha, mesDoTitulo } from "./planilha.server";
import { bancosPermitidosDaEmpresa } from "./bancos";

export const listarEmpresas = createServerFn({ method: "GET" }).handler(async () => {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("tokens")
    .select("empresa,status,mensagem_erro,updated_at")
    .order("empresa");
  if (error) throw new Error(error.message);
  return (data || []).map((r: any) => ({
    nome: r.empresa as string,
    status: (r.status || "ATIVO") as string,
    erro: r.mensagem_erro as string | null,
    updated_at: (r.updated_at as string) || null,
  }));
});

export const getServerLogs = createServerFn({ method: "GET" }).handler(async () => {
  return getLogs();
});

export const limparServerLogs = createServerFn({ method: "POST" }).handler(async () => {
  limparLogs();
  return { ok: true };
});

export const limparCache = createServerFn({ method: "POST" }).handler(async () => {
  limparCacheDetalhes();
  limparCachePlanilha();
  return { ok: true };
});

// Faturamento do periodo (planilha de cargas no Google Sheets — aba do dia, coluna VALOR).
// Direcionado pelo REMETENTE: cada carga pertence a empresa dona do remetente.
// "todas" soma tudo (inclui Alvarenga, que nao existe no dropdown).
// meses_sem_planilha indica meses do periodo ainda sem planilha cadastrada
// (cada mes tem a sua planilha; o cadastro e feito pela sidebar).
export const getFaturamento = createServerFn({ method: "GET" })
  .validator((d) =>
    z
      .object({
        empresa: z.string(),
        data_inicio: z.string(),
        data_fim: z.string(),
      })
      .parse(d),
  )
  .handler(
    async ({
      data,
    }): Promise<{
      total: number;
      porDia: { data: string; total: number; clientes: { nome: string; total: number; empresa?: string }[] }[];
      meses_sem_planilha: string[];
    }> => {
      try {
        return await buscarFaturamentoPlanilha(data.data_inicio, data.data_fim, data.empresa);
      } catch (e) {
        log("warn", `faturamento planilha: ${(e as Error).message}`);
        return { total: 0, porDia: [], meses_sem_planilha: [] };
      }
    },
  );

// ------------------- Planilhas de faturamento (mes -> Google Sheets) -------------------
// Lista o registro mes -> planilha (faixa pre-preenchida: jan/2026 a dez/2030).
// Meses sem planilha aparecem como "pendentes".
export const listarPlanilhasMes = createServerFn({ method: "GET" }).handler(async () => {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("planilhas_mes")
    .select("mes,id_planilha,url")
    .order("mes");
  if (error) throw new Error(error.message);
  return (data || []).map((r: any) => ({
    mes: r.mes as string,
    cadastrada: !!r.id_planilha,
    url: (r.url as string) || null,
  }));
});

// Registra (ou atualiza) a planilha de faturamento de um mes.
// Extrai o ID do trecho /spreadsheets/d/ID/ da URL colada (serve a URL de
// edicao ou a de visualizacao).
export const registrarPlanilhaMes = createServerFn({ method: "POST" })
  .validator((d) =>
    z
      .object({
        mes: z.string().regex(/^\d{4}-\d{2}$/, "mes deve estar no formato YYYY-MM"),
        url: z.string(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const m = data.url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{10,})/);
    if (!m) {
      return {
        status: "erro" as const,
        mensagem: "URL invalida: esperado link do Google Sheets (contem /spreadsheets/d/...)",
      };
    }
    const id = m[1];
    const sb = getSupabase();
    const { error } = await sb.from("planilhas_mes").upsert(
      {
        mes: data.mes,
        id_planilha: id,
        url: data.url,
        atualizado_em: new Date().toISOString(),
      },
      { onConflict: "mes" },
    );
    if (error) return { status: "erro" as const, mensagem: error.message };
    limparCachePlanilha();
    log("info", `planilha registrada: ${data.mes} -> ${id}`);
    return { status: "sucesso" as const, mes: data.mes, id_planilha: id };
  });

// Le o NOME da planilha e deduz o mes/ano a partir dele (ex.: "10.26 OUTUBRO -
// ADF" -> 2026-10). Fluxo de cadastro: colar URL -> sistema pergunta o mes ->
// usuario confirma -> registra.
export const detectarMesPlanilha = createServerFn({ method: "POST" })
  .validator((d) => z.object({ url: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const m = data.url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{10,})/);
    if (!m) {
      return {
        status: "erro" as const,
        mensagem: "URL invalida: esperado link do Google Sheets (contem /spreadsheets/d/...)",
      };
    }
    const titulo = await lerTituloPlanilha(m[1]);
    const mes = titulo ? mesDoTitulo(titulo) : null;
    return { status: "sucesso" as const, titulo, mes };
  });

// Troca o code OAuth (que volta para a raiz) por access/refresh token e salva no Supabase.
// O parâmetro "empresa" vem do state e garante que atualizamos o registro correto.
export const finalizarAutorizacao = createServerFn({ method: "POST" })
  .validator((d) =>
    z
      .object({
        code: z.string(),
        empresa: z.string().optional(),
        origin: z.string(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    // Mesma redirect_uri usada na autorização (raiz da aplicação).
    const redirectUri = `${data.origin.replace(/\/+$/, "")}/`;

    const tokenRes = await pedirToken({
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code: data.code,
    });

    if (!tokenRes.ok) {
      const detalhe = await tokenRes.text();
      log(
        "error",
        `troca de code por token falhou (${tokenRes.status}): ${detalhe.slice(0, 300)}`,
      );
      return {
        status: "erro" as const,
        http_status: tokenRes.status,
        detalhe,
      };
    }

    const dados: any = await tokenRes.json();
    const access = dados.access_token as string;
    const refresh = dados.refresh_token as string;
    const agora = new Date().toISOString();
    const expiresIn = dados.expires_in ? dados.expires_in * 1000 : 3600 * 1000;
    const expiresAt = new Date(Date.now() + expiresIn).toISOString();

    // Nome da empresa: usa o que veio no state; senão busca na API da Conta Azul.
    let nome = (data.empresa || "").trim();
    if (!nome) {
      const info = await fetch("https://api-v2.contaazul.com/v1/info", {
        headers: { Authorization: `Bearer ${access}` },
      });
      if (info.ok) {
        const ij: any = await info.json();
        if (ij?.name) nome = String(ij.name).toUpperCase();
      }
    }
    if (!nome) nome = "NOVA_EMPRESA";

    const sb = getSupabase();

    // Atualiza o registro existente pela empresa; se não existir, insere novo.
    const { data: atualizado } = await sb
      .from("tokens")
      .update({
        access_token: access,
        refresh_token: refresh,
        status: "ATIVO",
        mensagem_erro: null,
        expires_at: expiresAt,
        updated_at: agora,
      })
      .eq("empresa", nome)
      .select("id");

    if (!atualizado || atualizado.length === 0) {
      await sb.from("tokens").insert({
        empresa: nome,
        access_token: access,
        refresh_token: refresh,
        status: "ATIVO",
        mensagem_erro: null,
        expires_at: expiresAt,
        updated_at: agora,
      });
    }

    limparCacheDetalhes();

    return { status: "sucesso" as const, empresa: nome };
  });

// Endpoint cron (chamada manual/externa): renova tokens de todas as empresas.
// O cron nativo da Vercel usa a rota GET /api/cron/renovar-tokens; esta server
// function fica como alternativa para chamadas externas (ex.: cron-job.org).
export const renovarTodosTokens = createServerFn({ method: "POST" })
  .validator((d) =>
    z
      .object({
        cron_secret: z.string().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const secreto = cronSecret();
    if (secreto && data.cron_secret !== secreto) {
      return { status: "erro" as const, mensagem: "Cron secret invalido" };
    }

    const resultado = await executarRenovacaoEmLote();
    return { status: "sucesso" as const, ...resultado };
  });

export const inspecionarRecebimentos = createServerFn({ method: "GET" })
  .validator((d) =>
    z
      .object({
        empresa: z.string(),
        data_inicio: z.string(),
        data_fim: z.string(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    return inspecionarPrimeirosRecebimentos(data.empresa, data.data_inicio, data.data_fim, 3);
  });

export type DashboardData = {
  labels: string[];
  receitas: number[];
  despesas: number[];
  receitas_boleto: number[];
  saldo: number[];
  saldos_por_banco: { nome: string; saldo: number }[];
  resumo: {
    banco: number;
    total_rec: number;
    total_desp: number;
    total_rec_boleto: number;
    total_pagas: number;
    total_desconto_pagas: number;
    total_juros_pagas: number;
    total_multa_pagas: number;
    total_recebidas: number;
    total_desconto_recebidas: number;
    total_juros_recebidas: number;
    total_multa_recebidas: number;
    saldo_final: number;
  };
  avisos: string[];
  empresas_com_problema: string[];
  // Títulos detalhados de Pagos e Recebidas por empresa (fonte única da verdade
  // para as listas — evita divergência entre o card do dashboard e a lista,
  // que antes eram buscadas por server functions separadas).
  detalhamento: {
    pagos: { empresa: string; titulos: TituloDetalhe[] }[];
    recebidas: { empresa: string; titulos: TituloDetalhe[] }[];
  };
};

function dateRange(inicio: string, fim: string): string[] {
  const out: string[] = [];
  const d = new Date(inicio + "T00:00:00Z");
  const f = new Date(fim + "T00:00:00Z");
  while (d <= f) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

async function resolverEmpresas(empresa: string): Promise<string[]> {
  const sb = getSupabase();
  if (empresa.toLowerCase() === "todas") {
    const { data: rows } = await sb.from("tokens").select("empresa");
    return (rows || []).map((r: any) => r.empresa as string);
  }
  return [empresa.trim()];
}

export const getDashboard = createServerFn({ method: "GET" })
  .validator((d) =>
    z
      .object({
        empresa: z.string(),
        data_inicio: z.string(),
        data_fim: z.string(),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<DashboardData> => {
    const empresas = await resolverEmpresas(data.empresa);
    const avisos: string[] = [];
    const empresasComProblema = new Set<string>();

    // Empresas em paralelo (tokens e chamadas à API são independentes)
    const resultados = await Promise.all(
      empresas.map(async (emp) => {
        const token = await obterToken(emp);
        if (!token) {
          avisos.push(
            `${emp}: sem token válido — reconecte a empresa na Conta Azul.`,
          );
          empresasComProblema.add(emp);
          return { empresa: emp, bancos: [], rec: [], desp: [], pagas: [], recebidas: [] };
        }
        const [sal, rec, desp, pagas, recebidas] = await Promise.all([
          buscarSaldos(emp, token),
          buscarV2(
            emp,
            "/v1/financeiro/eventos-financeiros/contas-a-receber/buscar",
            data.data_inicio,
            data.data_fim,
          ),
          buscarV2(
            emp,
            "/v1/financeiro/eventos-financeiros/contas-a-pagar/buscar",
            data.data_inicio,
            data.data_fim,
          ),
          buscarPagas(emp, data.data_inicio, data.data_fim),
          buscarRecebidas(emp, data.data_inicio, data.data_fim),
        ]);
        const contasComFalha = sal.todas.filter((c) => c.erro);
        if (!sal.ok) {
          avisos.push(`${emp}: falha ao buscar saldos bancários.`);
          empresasComProblema.add(emp);
        } else if (contasComFalha.length) {
          avisos.push(
            `${emp}: não foi possível ler o saldo de ${contasComFalha
              .map((c) => c.nome || "(conta sem nome)")
              .join(", ")}.`,
          );
        }
        if (!rec.ok) {
          avisos.push(`${emp}: falha ao buscar contas a receber.`);
          empresasComProblema.add(emp);
        }
        if (!desp.ok) {
          avisos.push(`${emp}: falha ao buscar contas a pagar.`);
          empresasComProblema.add(emp);
        }
        // Nota: falha em buscarPagas/buscarRecebidas NAO vira aviso/erro de
        // sincronizacao — e um card complementar; o token ruim ja e detectado
        // por rec/desp.

        // Filtra os titulos pelos BANCOS EXIBIDOS no painel (mesma lista do
        // card de Bancos): titulo de banco que nao aparece la nao entra nas
        // listas nem nos cards.
        const contasMap = mapaContaParaBanco(sal.todas);
        const bancosOk = bancosPermitidosDaEmpresa(emp);
        const recF = filtrarPorBancos(rec.dados, contasMap, bancosOk);
        const despF = filtrarPorBancos(desp.dados, contasMap, bancosOk);
        const pagasF = filtrarPorBancos(pagas.dados, contasMap, bancosOk);
        const recebidasF = filtrarPorBancos(recebidas.dados, contasMap, bancosOk);
        const removidos =
          rec.dados.length - recF.length +
          (desp.dados.length - despF.length) +
          (pagas.dados.length - pagasF.length) +
          (recebidas.dados.length - recebidasF.length);
        if (removidos > 0) {
          log(
            "info",
            `filtro de bancos ${emp}: ${removidos} titulo(s) fora dos bancos exibidos foram removidos`,
          );
        }

        return {
          empresa: emp,
          bancos: sal.lista,
          rec: recF,
          desp: despF,
          pagas: pagasF,
          recebidas: recebidasF,
        };
      }),
    );

    const mapaBancos = new Map<string, { nome: string; saldo: number }>();
    for (const r of resultados) {
      for (const b of r.bancos) {
        const chave = removerAcentos(b.nome).toUpperCase();
        const nomeFormatado = chave.charAt(0) + chave.slice(1).toLowerCase();
        const ex = mapaBancos.get(chave);
        if (ex) ex.saldo += b.saldo;
        else
          mapaBancos.set(chave, {
            nome: nomeFormatado,
            saldo: b.saldo,
          });
      }
    }
    const saldos_por_banco = Array.from(mapaBancos.values()).map((v) => ({
      nome: v.nome,
      saldo: Math.round(v.saldo * 100) / 100,
    }));
    const totalBanco = saldos_por_banco.reduce((a, b) => a + b.saldo, 0);

    const datas = dateRange(data.data_inicio, data.data_fim);
    const recPorDia: Record<string, number> = {};
    const recBoletoPorDia: Record<string, number> = {};
    const despPorDia: Record<string, number> = {};

    for (const r of resultados) {
      for (const i of r.rec) {
        recPorDia[i.data] = (recPorDia[i.data] || 0) + i.valor;
        const metodo = (i.metodo || "").toUpperCase();
        if (metodo.includes("BOLETO")) {
          recBoletoPorDia[i.data] = (recBoletoPorDia[i.data] || 0) + i.valor;
        }
      }
      for (const i of r.desp) despPorDia[i.data] = (despPorDia[i.data] || 0) + i.valor;
    }

    // Total de contas EFETIVAMENTE pagas no periodo (baixa registrada na Conta Azul)
    let totalPagas = 0;
    let totalDescontoPagas = 0;
    let totalJurosPagas = 0;
    let totalMultaPagas = 0;
    for (const r of resultados) {
      for (const i of r.pagas) {
        totalPagas += i.valor;
        totalDescontoPagas += i.desconto || 0;
        totalJurosPagas += i.juros || 0;
        totalMultaPagas += i.multa || 0;
      }
    }

    // Total de contas EFETIVAMENTE recebidas no periodo (baixa registrada)
    let totalRecebidas = 0;
    let totalDescontoRecebidas = 0;
    let totalJurosRecebidas = 0;
    let totalMultaRecebidas = 0;
    for (const r of resultados) {
      for (const i of r.recebidas) {
        totalRecebidas += i.valor;
        totalDescontoRecebidas += i.desconto || 0;
        totalJurosRecebidas += i.juros || 0;
        totalMultaRecebidas += i.multa || 0;
      }
    }

    const receitas: number[] = [];
    const receitas_boleto: number[] = [];
    const despesas: number[] = [];
    const saldo: number[] = [];
    let acumulado = totalBanco;
    const labels: string[] = [];
    for (const d of datas) {
      const r = recPorDia[d] || 0;
      const rb = recBoletoPorDia[d] || 0;
      const p = despPorDia[d] || 0;
      receitas.push(r);
      receitas_boleto.push(Math.round(rb * 100) / 100);
      despesas.push(p);
      acumulado += r - p;
      saldo.push(Math.round(acumulado * 100) / 100);
      const [, m, day] = d.split("-");
      labels.push(`${day}/${m}`);
    }

    const total_rec = receitas.reduce((a, b) => a + b, 0);
    const total_rec_boleto = receitas_boleto.reduce((a, b) => a + b, 0);
    const total_desp = despesas.reduce((a, b) => a + b, 0);

    // Detalhamento de Pagos e Recebidas por empresa — fonte única da verdade
    // para as listas, evitando divergência com o card do dashboard.
    const detalhamento = {
      pagos: [] as { empresa: string; titulos: TituloDetalhe[] }[],
      recebidas: [] as { empresa: string; titulos: TituloDetalhe[] }[],
    };
    for (const r of resultados) {
      detalhamento.pagos.push({
        empresa: r.empresa,
        titulos: r.pagas.map((i) => ({
          data: i.data,
          valor: i.valor,
          metodo: i.metodo ?? null,
          descricao: i.descricao ?? null,
          terceiro: i.terceiro ?? null,
          categoria: i.categoria ?? null,
          juros: i.juros,
          multa: i.multa,
          desconto: i.desconto,
          valor_pago: i.valor_pago,
        })),
      });
      detalhamento.recebidas.push({
        empresa: r.empresa,
        titulos: r.recebidas.map((i) => ({
          data: i.data,
          valor: i.valor,
          metodo: i.metodo ?? null,
          descricao: i.descricao ?? null,
          terceiro: i.terceiro ?? null,
          categoria: i.categoria ?? null,
          juros: i.juros,
          multa: i.multa,
          desconto: i.desconto,
          valor_pago: i.valor_pago,
        })),
      });
    }

    return {
      labels,
      receitas,
      despesas,
      receitas_boleto,
      saldo,
      saldos_por_banco,
      resumo: {
        banco: Math.round(totalBanco * 100) / 100,
        total_rec: Math.round(total_rec * 100) / 100,
        total_desp: Math.round(total_desp * 100) / 100,
        total_rec_boleto: Math.round(total_rec_boleto * 100) / 100,
        total_pagas: Math.round(totalPagas * 100) / 100,
        total_desconto_pagas: Math.round(totalDescontoPagas * 100) / 100,
        total_juros_pagas: Math.round(totalJurosPagas * 100) / 100,
        total_multa_pagas: Math.round(totalMultaPagas * 100) / 100,
        total_recebidas: Math.round(totalRecebidas * 100) / 100,
        total_desconto_recebidas: Math.round(totalDescontoRecebidas * 100) / 100,
        total_juros_recebidas: Math.round(totalJurosRecebidas * 100) / 100,
        total_multa_recebidas: Math.round(totalMultaRecebidas * 100) / 100,
        saldo_final: saldo.length ? saldo[saldo.length - 1] : Math.round(totalBanco * 100) / 100,
      },
      avisos,
      empresas_com_problema: Array.from(empresasComProblema),
      detalhamento,
    };
  });

// ------------------- Breakdown por empresa (a receber / a pagar) -------------------

export type TituloDetalhe = {
  data: string; // YYYY-MM-DD
  valor: number;
  metodo: string | null;
  descricao: string | null;
  terceiro: string | null; // cliente (receber) ou fornecedor (pagar)
  categoria: string | null; // categoria financeira da Conta Azul
  // Valores acessorios do pagamento/baixa (conforme documentacao tecnica):
  // desconto e juros estao em valor_composicao.desconto / valor_composicao.juros
  juros?: number;
  multa?: number;
  desconto?: number;
  valor_pago?: number;
};

export type EmpresaBreakdown = {
  empresa: string;
  receber: { total: number; titulos: TituloDetalhe[] };
  pagar: { total: number; titulos: TituloDetalhe[] };
  pagos: { total: number; titulos: TituloDetalhe[] };
  recebidas: { total: number; titulos: TituloDetalhe[] };
};

export const getEmpresaBreakdown = createServerFn({ method: "GET" })
  .validator((d) =>
    z
      .object({
        empresa: z.string(),
        data_inicio: z.string(),
        data_fim: z.string(),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<EmpresaBreakdown[]> => {
    const empresas = await resolverEmpresas(data.empresa);

    const montar = (itens: any[]): { total: number; titulos: TituloDetalhe[] } => {
      const titulos: TituloDetalhe[] = itens
        .map((i) => ({
          data: i.data,
          valor: i.valor,
          metodo: i.metodo ?? null,
          descricao: i.descricao ?? null,
          terceiro: i.terceiro ?? null,
          categoria: i.categoria ?? null,
          juros: i.juros,
          multa: i.multa,
          desconto: i.desconto,
          valor_pago: i.valor_pago,
        }))
        .sort((a, b) => a.data.localeCompare(b.data));
      const total = titulos.reduce((a, b) => a + b.valor, 0);
      return { total: Math.round(total * 100) / 100, titulos };
    };

    // Empresas em paralelo — compartilha as mesmas requisições com o getDashboard
    return await Promise.all(
      empresas.map(async (emp): Promise<EmpresaBreakdown> => {
        const token = await obterToken(emp);
        if (!token) {
          return {
            empresa: emp,
            receber: { total: 0, titulos: [] },
            pagar: { total: 0, titulos: [] },
            pagos: { total: 0, titulos: [] },
            recebidas: { total: 0, titulos: [] },
          };
        }
        const [sal, rec, desp, pagas, recebidas] = await Promise.all([
          // As contas financeiras (bancos) sao necessarias para saber de qual
          // banco veio cada titulo — o filtro e o MESMO do getDashboard.
          buscarSaldos(emp, token),
          buscarV2(emp, "/v1/financeiro/eventos-financeiros/contas-a-receber/buscar", data.data_inicio, data.data_fim),
          buscarV2(emp, "/v1/financeiro/eventos-financeiros/contas-a-pagar/buscar", data.data_inicio, data.data_fim),
          buscarPagas(emp, data.data_inicio, data.data_fim),
          buscarRecebidas(emp, data.data_inicio, data.data_fim),
        ]);
        // Filtra pelos bancos exibidos no painel (mesma regra do getDashboard).
        const contasMap = mapaContaParaBanco(sal.todas);
        const bancosOk = bancosPermitidosDaEmpresa(emp);
        return {
          empresa: emp,
          receber: montar(filtrarPorBancos(rec.dados, contasMap, bancosOk)),
          pagar: montar(filtrarPorBancos(desp.dados, contasMap, bancosOk)),
          pagos: montar(filtrarPorBancos(pagas.dados, contasMap, bancosOk)),
          recebidas: montar(filtrarPorBancos(recebidas.dados, contasMap, bancosOk)),
        };
      }),
    );
  });

// ============================================================================
// Server functions: consulta de Baixa (conforme documentacao tecnica)
//   GET /v1/financeiro/eventos-financeiros/parcelas/baixa/{baixa_id}
//   GET /v1/financeiro/eventos-financeiros/parcelas/{parcela_id}/baixa
//   PATCH /v1/financeiro/eventos-financeiros/parcelas/baixa/{baixa_id}
//   GET /v1/financeiro/transferencias (juros da conta de destino)
// ============================================================================

export const getBaixaDetalhe = createServerFn({ method: "GET" })
  .validator((d) =>
    z
      .object({
        empresa: z.string(),
        baixa_id: z.string(),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<{ dados: BaixaDetalhe | null; ok: boolean }> => {
    return buscarBaixaPorId(data.empresa, data.baixa_id);
  });

export const getBaixaDetalheParcela = createServerFn({ method: "GET" })
  .validator((d) =>
    z
      .object({
        empresa: z.string(),
        parcela_id: z.string(),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<{ dados: BaixaDetalhe | null; ok: boolean }> => {
    return buscarBaixaPorParcela(data.empresa, data.parcela_id);
  });

export const atualizarBaixaDetalhe = createServerFn({ method: "POST" })
  .validator((d) =>
    z
      .object({
        empresa: z.string(),
        baixa_id: z.string(),
        desconto: z.number().optional(),
        juros: z.number().optional(),
        multa: z.number().optional(),
        versao: z.union([z.string(), z.number()]),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<{ ok: boolean; erro?: string; dados?: any }> => {
    return atualizarBaixa(data.empresa, {
      baixaId: data.baixa_id,
      desconto: data.desconto,
      juros: data.juros,
      multa: data.multa,
      versao: data.versao,
    });
  });

export const getTransferenciasJuros = createServerFn({ method: "GET" })
  .validator((d) =>
    z
      .object({
        empresa: z.string(),
        data_inicio: z.string().optional(),
        data_fim: z.string().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<{ dados: TransferenciaJuros[]; ok: boolean }> => {
    return buscarTransferenciasJuros(data.empresa, data.data_inicio ?? undefined, data.data_fim ?? undefined);
  });
