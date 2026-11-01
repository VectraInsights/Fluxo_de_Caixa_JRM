-- Migration: registro mes -> planilha de faturamento (Google Sheets)
-- Execute no SQL Editor do Supabase
--
-- Cada MES tem a sua planilha de cargas (um endereco/novo ID por mes).
-- Esta tabela guarda o mapeamento; o cadastro e feito pela sidebar do
-- dashboard (colar a URL da planilha do mes).

CREATE TABLE IF NOT EXISTS planilhas_mes (
  mes TEXT PRIMARY KEY,          -- "2026-10"
  id_planilha TEXT,              -- ID extraido da URL do Google Sheets (null = pendente)
  url TEXT,                      -- URL completa (para referencia/exibicao)
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Espaco pre-preenchido: janeiro/2026 ate dezembro/2030 (60 meses)
INSERT INTO planilhas_mes (mes)
SELECT to_char(d, 'YYYY-MM')
FROM generate_series('2026-01-01'::date, '2030-12-01'::date, interval '1 month') AS d
ON CONFLICT (mes) DO NOTHING;

-- A planilha existente e a de outubro/2026
UPDATE planilhas_mes
SET id_planilha = '173ertIvql5v6l_9v6HJAQkdeL66CA4RSKo5IZrGkFhM',
    url = 'https://docs.google.com/spreadsheets/d/173ertIvql5v6l_9v6HJAQkdeL66CA4RSKo5IZrGkFhM',
    atualizado_em = now()
WHERE mes = '2026-10';

COMMENT ON TABLE planilhas_mes IS 'Registro mes -> planilha de faturamento no Google Sheets (uma planilha nova por mes).';
