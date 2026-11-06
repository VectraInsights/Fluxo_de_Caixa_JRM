-- Cache persistente do METODO de pagamento (forma de pagamento) dos titulos
-- Execute no SQL Editor do Supabase (ou via script com a connection string)
--
-- A forma de pagamento (BOLETO, DINHEIRO, PIX...) de um titulo nao muda depois
-- de lancada. O cache em memoria (5 min, por instancia da Vercel) some a cada
-- cold start: a cada nova instancia o painel refazia ~100 chamadas de "detalhe
-- do titulo" — e essas chamadas saiam em rajada, tomavam 429 e alongavam a
-- carga para ~2 minutos.
--
-- Com esta tabela o metodo sobrevive ao cold start e e compartilhado entre as
-- instancias: a 2a carga do dia nao faz nenhuma chamada de detalhe.
--
-- A validade e de 12 h, contada a partir de `atualizado_em` (a leitura nao
-- renova o cache: so a busca na API renova).

CREATE TABLE IF NOT EXISTS public.detalhes_cache (
  empresa TEXT NOT NULL,           -- nome da empresa (ex: LGP Transportes)
  titulo_id UUID NOT NULL,         -- id do titulo (vem da listagem)
  metodo TEXT NOT NULL,            -- forma de pagamento (BOLETO, DINHEIRO, ...)
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa, titulo_id)
);

CREATE INDEX IF NOT EXISTS idx_detalhes_cache_empresa ON public.detalhes_cache (empresa);

-- Mesma permissao da tabela `baixas_cache` (RLS liberado para o service role e
-- para a anon key, que e o que o app usa).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'detalhes_cache' AND policyname = 'Allow all'
  ) THEN
    CREATE POLICY "Allow all" ON public.detalhes_cache
      AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
  END IF;
END $$;

COMMENT ON TABLE public.detalhes_cache IS
  'Cache persistente do metodo de pagamento (forma de pagamento) dos titulos da Conta Azul.';
