import { createFileRoute } from "@tanstack/react-router";
import { obterToken, renovarToken } from "../../lib/contaazul.server";

// Rota de debug: retorna o JSON cru que a API da Conta Azul retorna para
// contas a pagar com status PAGO. Usada apenas para diagnosticar por que o
// card "Contas Pagas" nao mostra valores.
export const Route = createFileRoute("/api/debug-pagas")({
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
            nome: "parcelas-lista-com-pagamento",
            url: "https://api-v2.contaazul.com/v1/financeiro/contas-a-pagar",
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
            nome: "eventos-buscar-com-pagamento",
            url: "https://api-v2.contaazul.com/v1/financeiro/eventos-financeiros/contas-a-pagar/buscar",
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
            nome: "parcelas-lista-sem-pagamento",
            url: "https://api-v2.contaazul.com/v1/financeiro/contas-a-pagar",
            params: {
              ...venc,
              status: "PAGO",
              tamanho_pagina: "10",
              pagina: "1",
            },
          },
        ];

        const resultados: any[] = [];
        for (const ep of endpoints) {
          const qs = new URLSearchParams(ep.params).toString();
          const fullUrl = `${ep.url}?${qs}`;
          const res = await fetch(fullUrl, {
            headers: { Authorization: `Bearer ${tokenRef.token}` },
          });
          const status = res.status;
          let body: any = null;
          let corpoTexto = "";
          try {
            body = await res.json();
            corpoTexto = JSON.stringify(body).slice(0, 3000);
          } catch {
            corpoTexto = await res.text().catch(() => "");
          }

          resultados.push({
            endpoint: ep.nome,
            url: fullUrl,
            http_status: status,
            itens_totais: body?.itens_totais ?? null,
            qtd_itens: Array.isArray(body?.itens) ? body.itens.length : Array.isArray(body) ? body.length : 0,
            primeiro_item: Array.isArray(body?.itens)
              ? body.itens[0]
              : Array.isArray(body)
                ? body[0]
                : null,
            corpo_preview: corpoTexto,
          });
        }

        return new Response(JSON.stringify({ empresa, dataInicio, dataFim, resultados }, null, 2), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
