-- Migration: adiciona suporte a saude de tokens (lock distribuido, log de eventos, expiracao)
-- Execute no SQL Editor do Supabase

-- Tabela de lock distribuido para evitar renovacao concorrente entre instancias serverless
CREATE TABLE IF NOT EXISTS token_locks (
  empresa TEXT PRIMARY KEY,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_by TEXT NOT NULL
);

-- Tabela de log de eventos de tokens (persistente, nao se perde ao reiniciar servidor)
CREATE TABLE IF NOT EXISTS logs_eventos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa TEXT NOT NULL,
  evento TEXT NOT NULL,
  erro TEXT,
  detalhe TEXT,
  acao_necessaria TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índice para consultas rápidas por empresa e data
CREATE INDEX IF NOT EXISTS idx_logs_eventos_empresa ON logs_eventos(empresa);
CREATE INDEX IF NOT EXISTS idx_logs_eventos_criado_em ON logs_eventos(criado_em);

-- Adiciona coluna expires_at na tabela tokens (caso ainda nao exista)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tokens' AND column_name = 'expires_at'
  ) THEN
    ALTER TABLE tokens ADD COLUMN expires_at TIMESTAMPTZ;
  END IF;
END $$;

-- Comentarios para documentacao
COMMENT ON TABLE token_locks IS 'Lock distribuído para evitar renovação concorrente de refresh_token entre instâncias serverless.';
COMMENT ON TABLE logs_eventos IS 'Log persistente de eventos de tokens (renovações, falhas, revogações).';
