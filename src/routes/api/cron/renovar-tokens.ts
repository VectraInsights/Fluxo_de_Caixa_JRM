import { createFileRoute } from "@tanstack/react-router";
import { executarRenovacaoEmLote, testarSlack } from "@/lib/contaazul.server";

// Cron nativo da Vercel (configurado no vercel.json). No plano Hobby roda 1x
// por dia (limite do plano). A Vercel envia automaticamente o header
// "Authorization: Bearer ${CRON_SECRET}" quando a env var CRON_SECRET esta
// configurada. Tambem aceitamos "X-Cron-Secret" e o parametro ?secret= (para
// teste manual pelo navegador).
//
// ?teste=slack  -> envia mensagem de teste para o Slack e reporta o resultado
//                  (valida SLACK_WEBHOOK_URL ponta a ponta).
export const Route = createFileRoute("/api/cron/renovar-tokens")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const secreto = process.env.CRON_SECRET;
        const auth = request.headers.get("authorization");
        const xSecret = request.headers.get("x-cron-secret");
        const qSecret = url.searchParams.get("secret");

        // Diagnostico: sem CRON_SECRET no ambiente Production, nada autentica.
        // Responde 500 (e nao 401) para distinguir "env var ausente" de
        // "valor errado" durante o teste manual.
        if (!secreto) {
          return Response.json(
            {
              erro:
                "CRON_SECRET nao configurado no ambiente Production da Vercel (adicionar em Settings > Environment Variables com escopo Production e redeploy)",
            },
            { status: 500 },
          );
        }

        const autorizado =
          auth === `Bearer ${secreto}` || xSecret === secreto || qSecret === secreto;
        if (!autorizado) {
          return Response.json(
            {
              erro: "secret invalido",
              // ajuda a comparar sem revelar o valor esperado
              tamanho_esperado: secreto.length,
            },
            { status: 401 },
          );
        }

        if (url.searchParams.get("teste") === "slack") {
          const resultado = await testarSlack();
          return Response.json(resultado);
        }

        const resultado = await executarRenovacaoEmLote();
        return Response.json({ status: "sucesso", ...resultado });
      },
    },
  },
});
