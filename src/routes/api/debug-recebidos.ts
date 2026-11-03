import { createFileRoute } from "@tanstack/react-router";
import { obterToken, renovarToken, buscarSaldos, extrairContaId } from "../../lib/contaazul.server";
import { bancosPermitidosDaEmpresa, bancoPermitido } from "../../lib/bancos";

// Rota de debug: retorna o JSON cru que a API da Conta Azul retorna para
// contas a receber com status de baixa (ACQUITTED/PAGO). Usada apenas para
// diagnosticar por que o card "Contas Recebidas" nao mostra valores.
export const Route = createFileRoute("/api/debug-recebidos")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const empresa = url.searchParams.get("empresa")?.trim() || "";
        const dataInicio = url.searchParams.get("inicio")?.trim() || "";
        const dataFim = url.searchParams.get("fim")?.trim() || "";

        if (!empresa || !dataInicio || !dataFim) {
          return new Response(
            JSON.stringify({ erro: "use ?empresa=NOME&inicio=YYYY-MM-DD&fim=YYYY-MM-DD" }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }

        const token = await obterToken(empresa);
        if (!token) {
          return new Response(JSON.stringify({ erro: "sem token" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        const tokenRef = { token };
        const vencInicio = new Date(dataInicio + "T00:00:00Z");
        vencInicio.setUTCDate(vencInicio.getUTCDate() - 365);
        const vencFim = new Date(dataFim + "T00:00:00Z");
        vencFim.setUTCDate(vencFim.getUTCDate() + 30);

        const venc = {
          data_vencimento_de: vencInicio.toISOString().slice(0, 10),
          data_vencimento_ate: vencFim.toISOString().slice(0, 10),
        };

        const endpoints = [
          {
            nome: "parcelas-ACQUITTED",
            url: "https://api-v2.contaazul.com/v1/financeiro/contas-a-receber",
            params: {
              ...venc,
              data_pagamento_de: dataInicio,
              data_pagamento_ate: dataFim,
              status: "ACQUITTED",
              tamanho_pagina: "10",
              pagina: "1",
            },
          },
          {
            nome: "parcelas-PAGO",
            url: "https://api-v2.contaazul.com/v1/financeiro/contas-a-receber",
            params: {
              ...venc,
              data_pagamento_de: dataInicio,
              data_pagamento_ate: dataFim,
              status: "PAGO",
              tamanho_pagina: "10",
              pagina: "1",
            },
          },
          {
            nome: "eventos-buscar-ACQUITTED",
            url: "https://api-v2.contaazul.com/v1/financeiro/eventos-financeiros/contas-a-receber/buscar",
            params: {
              ...venc,
              data_pagamento_de: dataInicio,
              data_pagamento_ate: dataFim,
              status: "ACQUITTED",
              tamanho_pagina: "10",
              pagina: "1",
            },
          },
          {
            nome: "eventos-buscar-PAGO",
            url: "https://api-v2.contaazul.com/v1/financeiro/eventos-financeiros/contas-a-receber/buscar",
            params: {
              ...venc,
              data_pagamento_de: dataInicio,
              data_pagamento_ate: dataFim,
              status: "PAGO",
              tamanho_pagina: "10",
              pagina: "1",
            },
          },
        ];

        const resultados: any[] = [];
        // Contas financeiras (bancos) da empresa + lista de bancos exibidos:
        // usado para conferir se o titulo traz o vinculo com o banco.
        const sal = await buscarSaldos(empresa, tokenRef.token);
        const contas = sal.todas.map((c) => ({ id: c.id, nome: c.nome }));
        const nomeDaConta = new Map(contas.map((c) => [String(c.id), c.nome]));
        const permitidos = bancosPermitidosDaEmpresa(empresa);

        for (const ep of endpoints) {
          const qs = new URLSearchParams(ep.params).toString();
          const fullUrl = `${ep.url}?${qs}`;
          let res = await fetch(fullUrl, {
            headers: { Authorization: `Bearer ${tokenRef.token}` },
          });
          // Renova o token uma vez e repete a chamada, se a API recusar.
          if (res.status === 401) {
            const novo = await renovarToken(empresa);
            if (novo) {
              tokenRef.token = novo;
              res = await fetch(fullUrl, {
                headers: { Authorization: `Bearer ${novo}` },
              });
            }
          }
          const status = res.status;
          let body: any = null;
          let corpoTexto = "";
          try {
            body = await res.json();
            corpoTexto = JSON.stringify(body).slice(0, 3000);
          } catch {
            corpoTexto = await res.text().catch(() => "");
          }

          const itens = Array.isArray(body?.itens)
            ? body.itens
            : Array.isArray(body)
              ? body
              : [];

          // De qual banco veio cada titulo (o filtro do dashboard usa isso).
          const vinculoBanco = itens.slice(0, 20).map((i: any) => {
            const contaId = extrairContaId(i);
            const banco = contaId ? nomeDaConta.get(String(contaId)) : undefined;
            return {
              id: i?.id ?? null,
              conta_id: contaId ?? null,
              banco: banco ?? null,
              banco_exibido: banco ? permitidos.some((p) => bancoPermitido(banco, p)) : null,
            };
          });

          resultados.push({
            endpoint: ep.nome,
            url: fullUrl,
            http_status: status,
            itens_totais: body?.itens_totais ?? null,
            qtd_itens: itens.length,
            // Campos usados pelo processador (data de recebimento e valor pago).
            primeiro_item: itens[0] ?? null,
            datas_recebimento: itens
              .map((i: any) =>
                i?.data_recebimento ??
                i?.data_pagamento ??
                i?.data_baixa ??
                i?.baixas?.[0]?.data_recebimento ??
                i?.baixas?.[0]?.data_pagamento ??
                null,
              )
              .filter(Boolean)
              .slice(0, 10),
            vinculo_banco: vinculoBanco,
            corpo_preview: corpoTexto,
          });
        }

        return new Response(
          JSON.stringify(
            {
              empresa,
              dataInicio,
              dataFim,
              bancos_exibidos: permitidos,
              contas_financeiras: contas,
              resultados,
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
