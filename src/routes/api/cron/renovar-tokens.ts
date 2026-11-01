import { createFileRoute } from "@tanstack/react-router";
import { executarRenovacaoEmLote } from "@/lib/contaazul.server";

// Cron nativo da Vercel (configurado no vercel.json). No plano Hobby roda 1x
// por dia (limite do plano). A Vercel envia automaticamente o header
// "Authorization: Bearer ${CRON_SECRET}" quando a env var CRON_SECRET esta
// configurada. Tambem aceitamos "X-Cron-Secret" para chamadas manuais.
export const Route = createFileRoute("/api/cron/renovar-tokens")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const secreto = process.env.CRON_SECRET;
        const auth = request.headers.get("authorization");
        const xSecret = request.headers.get("x-cron-secret");
        const autorizado =
          !!secreto && (auth === `Bearer ${secreto}` || xSecret === secreto);
        if (!autorizado) {
          return new Response("Unauthorized", { status: 401 });
        }

        const resultado = await executarRenovacaoEmLote();
        return Response.json({ status: "sucesso", ...resultado });
      },
    },
  },
});
