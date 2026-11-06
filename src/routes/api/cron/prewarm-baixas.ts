import { createFileRoute } from "@tanstack/react-router";
import { preAquecerBaixas } from "@/lib/contaazul.server";

// Cron nativo da Vercel (configurado no vercel.json). No plano Hobby roda 1x
// por dia (limite do plano) — de madrugada, quando ninguem esta esperando o
// painel.
//
// O que faz: busca as BAIXAS (data real do pagamento + banco + valor liquido)
// do mes corrente e do anterior para todas as empresas e grava no cache do
// Supabase. E o mesmo trabalho que o painel faria ao abrir — so que adiantado.
// Com o cache pronto, a carga do painel e instantanea.
//
// ?meses=2          -> quantos meses cobrir (padrao 2: o atual e o anterior)
// ?orcamento=40000 -> limite de tempo da execucao, em ms
//
// A autenticacao e a mesma do cron de renovacao de tokens: a Vercel envia o
// header "Authorization: Bearer ${CRON_SECRET}"; tambem aceitamos
// "X-Cron-Secret" e o parametro ?secret= (teste manual pelo navegador).
export const Route = createFileRoute("/api/cron/prewarm-baixas")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const segredo = process.env.CRON_SECRET;
        const auth = request.headers.get("authorization");
        const xSecret = request.headers.get("x-cron-secret");
        const qSecret = url.searchParams.get("secret");

        if (!segredo) {
          return Response.json(
            {
              erro:
                "CRON_SECRET nao configurado no ambiente Production da Vercel (adicionar em Settings > Environment Variables com escopo Production e redeploy)",
            },
            { status: 500 },
          );
        }

        const autorizado =
          auth === `Bearer ${segredo}` || xSecret === segredo || qSecret === segredo;
        if (!autorizado) {
          return Response.json(
            { erro: "secret invalido", tamanho_esperado: segredo.length },
            { status: 401 },
          );
        }

        const meses = Number(url.searchParams.get("meses") || "") || undefined;
        const orcamento = Number(url.searchParams.get("orcamento") || "") || undefined;

        const t0 = Date.now();
        try {
          const resultado = await preAquecerBaixas({
            ...(meses ? { meses } : {}),
            ...(orcamento ? { orcamentoMs: orcamento } : {}),
          });
          return Response.json({
            status: "sucesso",
            duracaoMs: Date.now() - t0,
            ...resultado,
          });
        } catch (e) {
          return Response.json(
            { status: "erro", erro: (e as Error)?.message || String(e), duracaoMs: Date.now() - t0 },
            { status: 500 },
          );
        }
      },
    },
  },
});
