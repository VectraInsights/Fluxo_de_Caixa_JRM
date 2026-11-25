-- Cache persistente das LISTAGENS e do PAYLOAD do dashboard
-- Execute no SQL Editor do Supabase (ou via script com a connection string)
--
-- Por que: o cache em memoria (listCache/saldoCache, 2 min) vive so na
-- instancia da Vercel e some a cada cold start. Medido em producao: a 1a
-- carga do dia levava ~21 s (a API da Conta Azul, chamada de dentro de uma
-- funcao nos EUA, responde em 350-530 ms e o limite e de 10 req/s POR
-- EMPRESA); a 2a carga na mesma instancia levava ~1,8 s.
--
-- `listagens_cache` guarda o resultado das listagens (a receber, a pagar,
-- pagas, recebidas e saldos) por EMPRESA e PERIODO. Sobrevive ao cold start
-- e e compartilhado entre as instancias: o cache volta a ser preenchido
-- por uma chamada so, em vez de ~20 (4 empresas x 5 listagens, cada uma com
-- varias paginas).
--
-- `dashboard_cache` guarda o payload FINAL do dashboard (graficos, cards e
-- as 4 listas de titulos) por EMPRESA e PERIODO: enquanto ele estiver valido,
-- a tela abre sem nenhuma chamada a API da Conta Azul.
--
-- A validade e controlada pela coluna `expira_em` (gravada na hora da
-- escrita), e nao por um TTL unico:
--   - leitura normal (usuario abriu o painel): TTL curto (padrao 60 min);
--   - pre-aquecimento pelo cron: TTL longo (padrao 26 h), para o cache do
--     cron valer ate o cron do dia seguinte;
--   - periodo ja fechado (fim anterior a hoje): TTL longo (30 dias).
--
-- O botao "Recarregar" do painel apaga as linhas do periodo antes de
-- refazer a consulta, entao o usuario sempre tem como forc dados novos.

CREATE TABLE IF NOT EXISTS public.listagens_cache (
  chave TEXT PRIMARY KEY,          -- empresa|tipo|data_inicio|data_fim
  empresa TEXT NOT NULL,           -- nome da empresa (ex: LGP Transportes)
  tipo TEXT NOT NULL,              -- v2-receber | v2-pagar | pagas | recebidas | saldos
  data_inicio TEXT NOT NULL DEFAULT '',
  data_fim TEXT NOT NULL DEFAULT '',
  dados JSONB NOT NULL,            -- resultado da listagem (JSON)
  expira_em TIMESTAMPTZ NOT NULL,  -- validade (gravada na escrita)
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listagens_cache_empresa
  ON public.listagens_cache (empresa);
CREATE INDEX IF NOT EXISTS idx_listagens_cache_periodo
  ON public.listagens_cache (data_inicio, data_fim);

CREATE TABLE IF NOT EXISTS public.dashboard_cache (
  chave TEXT PRIMARY KEY,          -- empresa|data_inicio|data_fim
  empresa TEXT NOT NULL,
  data_inicio TEXT NOT NULL,
  data_fim TEXT NOT NULL,
  payload JSONB NOT NULL,          -- DashboardData completo
  expira_em TIMESTAMPTZ NOT NULL,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dashboard_cache_empresa
  ON public.dashboard_cache (empresa);

-- Mesma permissao das tabelas `baixas_cache`/`detalhes_cache` (RLS liberado
-- para o service role e para a anon key, que e o que o app usa).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'listagens_cache' AND policyname = 'Allow all'
  ) THEN
    CREATE POLICY "Allow all" ON public.listagens_cache
      AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'dashboard_cache' AND policyname = 'Allow all'
  ) THEN
    CREATE POLICY "Allow all" ON public.dashboard_cache
      AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
  END IF;
END $$;

COMMENT ON TABLE public.listagens_cache IS
  'Cache persistente das listagens da Conta Azul (a receber, a pagar, pagas, recebidas e saldos).';
COMMENT ON TABLE public.dashboard_cache IS
  'Cache persistente do payload final do dashboard (por empresa e periodo).';
