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
        const autorizado =
          !!secreto &&
          (auth === `Bearer ${secreto}` || xSecret === secreto || qSecret === secreto);
        if (!autorizado) {
          return new Response("Unauthorized", { status: 401 });
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
