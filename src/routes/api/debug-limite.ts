import { createFileRoute } from "@tanstack/react-router";
import { obterToken } from "@/lib/contaazul.server";

// ROTA TEMPORARIA (removida com git revert depois da medicao).
//
// Mede o limite REAL de taxa da API da Conta Azul no ambiente de producao
// (Vercel): dispara chamadas em TAXA FIXA (sem o limitador do app) e conta os
// 429 por empresa.
//
//   /api/debug-limite?empresas=A,B,C&rps=9&ms=8000
//
// Perguntas:
//   1 empresa x 9/s  -> 429? (controle: taxa baixa)
//   4 empresas x 9/s -> 429? (se sim, o limite e agregado/por IP e nao por
//                             empresa; se nao, e por empresa)
export const Route = createFileRoute("/api/debug-limite")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const empresas = (url.searchParams.get("empresas") || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const rps = Number(url.searchParams.get("rps") || "9");
        const duracaoMs = Number(url.searchParams.get("ms") || "8000");
        const alvo = "https://api-v2.contaazul.com/v1/conta-financeira?pagina=1&tamanho_pagina=1";

        if (!empresas.length) {
          return Response.json({ erro: "use ?empresas=A,B,C&rps=9&ms=8000" }, { status: 400 });
        }

        const inicio = Date.now();
        const resultados = await Promise.all(
          empresas.map(async (empresa) => {
            const token = await obterToken(empresa);
            if (!token) return { empresa, erro: "sem token" };
            const intervalo = 1000 / Math.max(0.5, rps);
            const fim = Date.now() + duracaoMs;
            let chamadas = 0;
            let ok = 0;
            let n429 = 0;
            let outros = 0;
            const porSegundo: Record<string, number> = {};
            while (Date.now() < fim) {
              const alvo2 = inicio + chamadas * intervalo;
              const espera = alvo2 - Date.now();
              if (espera > 0) await new Promise((r) => setTimeout(r, espera));
              const s = String(Math.floor((Date.now() - inicio) / 1000));
              porSegundo[s] = (porSegundo[s] || 0) + 1;
              try {
                const res = await fetch(alvo, {
                  headers: { Authorization: `Bearer ${token}` },
                });
                chamadas++;
                if (res.status === 429) n429++;
                else if (res.ok) ok++;
                else outros++;
              } catch {
                chamadas++;
                outros++;
              }
            }
            return {
              empresa,
              chamadas,
              ok,
              n429,
              outros,
              taxaReal: +(chamadas / ((Date.now() - inicio) / 1000)).toFixed(2),
              porSegundo,
            };
          }),
        );

        const totalChamadas = resultados.reduce((s, r) => s + (r.chamadas || 0), 0);
        const total429 = resultados.reduce((s, r) => s + (r.n429 || 0), 0);
        return Response.json({
          rpsPorEmpresa: rps,
          duracaoMs,
          empresas: resultados.length,
          totalChamadas,
          total429,
          pct429: totalChamadas ? +((total429 / totalChamadas) * 100).toFixed(1) : 0,
          resultados,
        });
      },
    },
  },
});
