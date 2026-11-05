-- Cache persistente das BAIXAS das parcelas (data real do pagamento)
-- Execute no SQL Editor do Supabase (ou via script com a connection string)
--
-- A baixa de uma parcela e IMUTAVEL depois de lancada: por isso vale a pena
-- guardar em cache no banco. O cache em memoria (por instancia da Vercel) some
-- a cada cold start e nao e compartilhado entre as instancias; com esta tabela
-- a 2a carga do dia busca no banco em vez de refazer ~1.300 chamadas a API.
--
-- `baixa` guarda o array CRU das baixas (data_pagamento + valor_composicao),
-- e nao o resultado ja filtrado pelo periodo: assim o mesmo cache serve para
-- qualquer intervalo consultado.

CREATE TABLE IF NOT EXISTS public.baixas_cache (
  empresa TEXT NOT NULL,           -- nome da empresa (ex: LGP Transportes)
  parcela_id UUID NOT NULL,        -- id da parcela (vem da listagem)
  baixa JSONB NOT NULL,             -- array de baixas cruas
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa, parcela_id)
);

CREATE INDEX IF NOT EXISTS idx_baixas_cache_empresa ON public.baixas_cache (empresa);

-- Mesma permissao da tabela `tokens` (RLS liberado para o service role e
-- para o anon key, que e o que o app usa).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'baixas_cache' AND policyname = 'Allow all'
  ) THEN
    CREATE POLICY "Allow all" ON public.baixas_cache
      AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
  END IF;
END $$;

COMMENT ON TABLE public.baixas_cache IS
  'Cache persistente das baixas da Conta Azul (data real do pagamento e composicao do valor).';
