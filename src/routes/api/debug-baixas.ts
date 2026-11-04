import { createFileRoute } from "@tanstack/react-router";
import { obterToken, renovarToken } from "../../lib/contaazul.server";

const BASE = "https://api-v2.contaazul.com";

function cortar(texto: string, limite: number): string {
  return texto.length > limite ? texto.slice(0, limite) + "...[truncado]" : texto;
}

// Tenta interpretar o corpo como JSON (a API da Conta Azul sempre devolve JSON).
function tentarJson(texto: string): any {
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
}

// Extrai numeros uteis de qualquer posicao do JSON (inclusive dentro de
// valor_composicao / composicao_valor / arrays de baixas).
function acharNumeros(obj: any, campos: string[], profundidade = 0): number[] {
  const achados: number[] = [];
  if (!obj || typeof obj !== "object" || profundidade > 5) return achados;
  if (Array.isArray(obj)) {
    for (const item of obj) achados.push(...acharNumeros(item, campos, profundidade + 1));
    return achados;
  }
  for (const c of campos) {
    const v = (obj as any)[c];
    if (typeof v === "number" && !isNaN(v)) achados.push(v);
    else if (typeof v === "string") {
      const n = Number(v.replace(/[^0-9,-]/g, "").replace(",", "."));
      if (!isNaN(n) && v.trim() !== "") achados.push(n);
    }
  }
  for (const key of Object.keys(obj)) {
    achados.push(...acharNumeros((obj as any)[key], campos, profundidade + 1));
  }
  return achados;
}

// Rota de debug: mostra o JSON cru da BAIXA de cada titulo pago, para descobrir
// onde o desconto da Conta Azul e gravado (valor_composicao.desconto) e qual o
// valor liquido real. Usada para diagnosticar o valor sem desconto no card
// "Contas Pagas".
export const Route = createFileRoute("/api/debug-baixas")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const empresa = url.searchParams.get("empresa")?.trim() || "";
        const dataInicio = url.searchParams.get("inicio")?.trim() || "";
        const dataFim = url.searchParams.get("fim")?.trim() || "";
        const limite = Math.min(Number(url.searchParams.get("limite") || "20") || 20, 60);
        const paginas = Math.min(Number(url.searchParams.get("paginas") || "3") || 3, 10);
        // ids especificos a sondar (separados por virgula) — tem prioridade
        // sobre a amostra automatica.
        const idsPedidos = (url.searchParams.get("ids") || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

        if (!empresa || !dataInicio || !dataFim) {
          return new Response(
            JSON.stringify({ erro: "use ?empresa=NOME&inicio=YYYY-MM-DD&fim=YYYY-MM-DD" }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }

        let token = await obterToken(empresa);
        if (!token) {
          return new Response(JSON.stringify({ erro: "sem token" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }
        const tokenRef = { token };

        async function chamar(url: string): Promise<{ status: number; texto: string }> {
          for (let tentativa = 0; tentativa < 2; tentativa++) {
            try {
              const res = await fetch(url, {
                headers: { Authorization: `Bearer ${tokenRef.token}` },
              });
              if (res.status === 401 && tentativa === 0) {
                const novo = await renovarToken(empresa);
                if (novo) tokenRef.token = novo;
                continue;
              }
              const texto = await res.text().catch(() => "");
              return { status: res.status, texto };
            } catch (e) {
              if (tentativa === 1) {
                return { status: 0, texto: `erro de rede: ${String(e).slice(0, 120)}` };
              }
            }
          }
          return { status: 0, texto: "sem resposta" };
        }

        // 1) Lista dos titulos pagos no periodo (mesma consulta do dashboard).
        const vencInicio = new Date(dataInicio + "T00:00:00Z");
        vencInicio.setUTCDate(vencInicio.getUTCDate() - 365);
        const vencFim = new Date(dataFim + "T00:00:00Z");
        vencFim.setUTCDate(vencFim.getUTCDate() + 30);

        const titulos: any[] = [];
        for (let pagina = 1; pagina <= paginas; pagina++) {
          const params = new URLSearchParams({
            data_vencimento_de: vencInicio.toISOString().slice(0, 10),
            data_vencimento_ate: vencFim.toISOString().slice(0, 10),
            data_pagamento_de: dataInicio,
            data_pagamento_ate: dataFim,
            status: "ACQUITTED",
            tamanho_pagina: "100",
            pagina: String(pagina),
          });
          const r = await chamar(`${BASE}/v1/financeiro/contas-a-pagar?${params}`);
          if (r.status !== 200) break;
          const j = tentarJson(r.texto);
          const itens: any[] = j?.itens || (Array.isArray(j) ? j : []);
          if (!itens.length) break;
          titulos.push(...itens);
          if (itens.length < 100) break;
        }

        // 2) Prioriza os titulos onde a propria API discorda (pago != total):
        //    sao eles que carregam desconto/juros/multa.
        const divergentes = titulos.filter(
          (t) => Math.abs(Number(t.pago || 0) - Number(t.total || 0)) > 0.005,
        );
        const iguais = titulos.filter(
          (t) => Math.abs(Number(t.pago || 0) - Number(t.total || 0)) <= 0.005,
        );
        const automaticos = [...divergentes, ...iguais].slice(0, limite);
        const jaConhecidos = new Set(automaticos.map((t) => String(t.id)));
        const especificos = idsPedidos
          .filter((id) => !jaConhecidos.has(id))
          .map((id) => titulos.find((t) => String(t.id) === id) || { id });
        const selecionados = [...automaticos, ...especificos];

        // 3) Para cada titulo, busca a BAIXA (e a parcela) para ver a composicao
        //    do valor (desconto / juros / multa / valor_bruto / valor_pago).
        const detalhes: any[] = [];
        for (let i = 0; i < selecionados.length; i += 5) {
          const lote = selecionados.slice(i, i + 5);
          const resultados = await Promise.all(
            lote.map(async (t) => {
              const id = String(t.id);
              const rBaixa = await chamar(
                `${BASE}/v1/financeiro/eventos-financeiros/parcelas/${id}/baixa`,
              );
              const rParcela = await chamar(
                `${BASE}/v1/financeiro/eventos-financeiros/parcelas/${id}`,
              );
              const jBaixa = tentarJson(rBaixa.texto);
              const jParcela = tentarJson(rParcela.texto);
              return {
                id,
                descricao: t.descricao ?? null,
                total: t.total ?? null,
                pago: t.pago ?? null,
                nao_pago: t.nao_pago ?? null,
                data_vencimento: t.data_vencimento ?? null,
                fornecedor: t.fornecedor?.nome ?? null,
                baixa_http: rBaixa.status,
                baixa: jBaixa ?? cortar(rBaixa.texto, 1500),
                baixa_descontos: acharNumeros(jBaixa, [
                  "desconto",
                  "valor_desconto",
                  "juros",
                  "valor_juros",
                  "multa",
                  "valor_multa",
                  "valor_bruto",
                  "valor_pago",
                  "valor_liquido",
                ]),
                parcela_http: rParcela.status,
                parcela: jParcela ?? cortar(rParcela.texto, 1500),
                parcela_descontos: acharNumeros(jParcela, [
                  "desconto",
                  "valor_desconto",
                  "juros",
                  "valor_juros",
                  "multa",
                  "valor_multa",
                  "valor_bruto",
                  "valor_pago",
                  "valor_liquido",
                ]),
              };
            }),
          );
          detalhes.push(...resultados);
        }

        // 4) Tenta endpoints em lote (podem existir rotas que devolvem todas as
        //    baixas do periodo em uma unica chamada).
        const candidatos: any[] = [];
        const emLote = [
          "/v1/financeiro/baixas",
          "/v1/financeiro/eventos-financeiros/baixas",
          "/v1/financeiro/eventos-financeiros/baixas/buscar",
          "/v1/financeiro/contas-a-pagar/baixas",
          "/v1/financeiro/contas-a-pagar/baixas/buscar",
          "/v1/financeiro/eventos-financeiros/contas-a-pagar/baixas/buscar",
          "/v1/financeiro/eventos-financeiros/parcelas/baixas",
          "/v1/financeiro/parcelas/baixas",
          "/v1/financeiro/baixas/buscar",
          "/v1/financeiro/eventos-financeiros/baixas/todas",
        ];
        for (const c of emLote) {
          const params = new URLSearchParams({
            data_pagamento_de: dataInicio,
            data_pagamento_ate: dataFim,
            tamanho_pagina: "5",
            pagina: "1",
          });
          const r = await chamar(`${BASE}${c}?${params}`);
          candidatos.push({
            url: `${BASE}${c}?${params}`,
            http_status: r.status,
            preview: cortar(r.texto, 400),
          });
        }

        // 5) A listagem aceita algum parametro que traga as baixas (ou o
        //    desconto) junto? Se sim, o desconto vem em uma unica chamada.
        const variantes: any[] = [];
        const parametros = [
          "",
          "incluir_baixas=true",
          "incluir=baixas",
          "expand=baixas",
          "com_baixas=true",
          "trazer_baixas=true",
          "incluir_parcelas=true",
          "com_parcelas=true",
          "detalhado=true",
          "detalhes=true",
          "completo=true",
        ];
        const basesListagem = [
          "/v1/financeiro/contas-a-pagar",
          "/v1/financeiro/eventos-financeiros/contas-a-pagar/buscar",
        ];
        const primeiroTitulo = selecionados[0];
        for (const b of basesListagem) {
          for (const extra of parametros) {
            const params = new URLSearchParams({
              data_vencimento_de: vencInicio.toISOString().slice(0, 10),
              data_vencimento_ate: vencFim.toISOString().slice(0, 10),
              data_pagamento_de: dataInicio,
              data_pagamento_ate: dataFim,
              status: "ACQUITTED",
              tamanho_pagina: "3",
              pagina: "1",
            });
            if (extra) {
              for (const [k, v] of new URLSearchParams(extra)) params.set(k, v);
            }
            const r = await chamar(`${BASE}${b}?${params}`);
            const j = tentarJson(r.texto);
            const item = j?.itens?.[0] ?? (Array.isArray(j) ? j[0] : null);
            variantes.push({
              url: `${BASE}${b}?${params}`,
              http_status: r.status,
              chaves: item ? Object.keys(item) : null,
              tem_baixas: !!item?.baixas,
              tem_parcelas: !!item?.parcelas,
              tem_desconto:
                item?.desconto !== undefined ||
                item?.valor_desconto !== undefined ||
                item?.valor_composicao !== undefined,
            });
          }
        }

        // 6) Detalhe de um titulo: /contas-a-pagar/{id} pode trazer as baixas.
        const detalheTitulo: any[] = [];
        for (const t of selecionados.slice(0, 2)) {
          const id = String(t.id);
          for (const caminho of [
            `/v1/financeiro/contas-a-pagar/${id}`,
            `/v1/financeiro/eventos-financeiros/${id}`,
            `/v1/financeiro/eventos-financeiros/${id}/parcelas`,
          ]) {
            const r = await chamar(`${BASE}${caminho}`);
            const j = tentarJson(r.texto);
            const item = Array.isArray(j) ? j[0] : j;
            detalheTitulo.push({
              caminho,
              http_status: r.status,
              chaves: item && typeof item === "object" ? Object.keys(item) : null,
              numeros: acharNumeros(j, [
                "desconto",
                "valor_desconto",
                "juros",
                "valor_juros",
                "multa",
                "valor_multa",
                "valor_bruto",
                "valor_pago",
                "valor_liquido",
                "total",
                "pago",
              ]).slice(0, 40),
              preview: cortar(r.texto, 700),
            });
          }
        }

        return new Response(
          JSON.stringify(
            {
              empresa,
              dataInicio,
              dataFim,
              titulos_lidos: titulos.length,
              divergentes_pago_total: divergentes.length,
              selecionados: selecionados.length,
              detalhes,
              candidatos_em_lote: candidatos,
              variantes_listagem: variantes,
              detalhe_titulo: detalheTitulo,
            },
            null,
            2,
          ),
          { headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});
