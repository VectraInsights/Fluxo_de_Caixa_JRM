import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/autorizar")({
  server: {
    handlers: {
      // Redireciona o usuário para o login da Conta Azul para (re)autorizar uma empresa.
      // Usa o parâmetro "state" para carregar o nome da empresa, de forma que a
      // página inicial (raiz) atualize o registro correto no Supabase ao receber o code.
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const empresa = url.searchParams.get("empresa")?.trim() || "";

        const clientId = process.env.CONTA_AZUL_CLIENT_ID;
        if (!clientId) {
          return new Response("CONTA_AZUL_CLIENT_ID não configurado no servidor.", {
            status: 500,
          });
        }

        // A redirect_uri cadastrada no Portal da Conta Azul é a RAIZ da aplicação
        // (https://jrm-dashboard.vercel.app/). Precisa bater exatamente com a que
        // será usada na troca do code por token.
        const redirectUri = `${url.origin}/`;

        const params = new URLSearchParams({
          response_type: "code",
          client_id: clientId,
          redirect_uri: redirectUri,
          state: empresa,
          scope: "openid profile aws.cognito.signin.user.admin",
        });

        // A URL da Conta Azul usa rota via hash (#/oauth/authorize?...).
        return new Response(null, {
          status: 302,
          headers: {
            Location: `https://login.contaazul.com/#/oauth/authorize?${params.toString()}`,
          },
        });
      },
    },
  },
});
