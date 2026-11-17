// ------------------- Movimentos de capital (aportes e retiradas) -------------------
// Um titulo que tem como TERCEIRO (cliente/fornecedor) uma das
// TRANSPORTADORAS DO GRUPO, ou cuja CATEGORIA (financeira) seja
// "Aporte de Capital" / "Retirada de Capital", e um MOVIMENTO DE CAPITAL:
// dinheiro que entra ou sai ENTRE as empresas do grupo (ou dos socios) —
// nao e receita nem despesa da operacao.
//
// Por isso esses titulos NAO podem somar nos totais de recebidos e pagos:
// eles vao para um CAMPO SEPARADO (informativo), que aparece no painel, no
// PDF e na planilha em seção propria.

// As transportadoras do grupo (movimento interno de uma para outra).
export const TRANSPORTADORAS_DO_GRUPO = [
  "LGP TRANSPORTES",
  "JUVENAL TRANSPORTES",
  "JRM TRANSPORTES",
  "ROSANGELA TRANSPORTES",
];

// Categorias financeiras que caracterizam aporte/retirada de capital.
export const CATEGORIAS_DE_CAPITAL = ["APORTE DE CAPITAL", "RETIRADA DE CAPITAL"];

// Normaliza texto para comparacao: sem acento, maiusculo, espacos colapsados.
export function normalizarTexto(s: string | null | undefined): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * O titulo e um movimento de capital (aporte/retirada) quando:
 *   - o terceiro e uma das transportadoras do grupo (ex.: a LGP recebeu da
 *     Rosangela — dinheiro que ja era do grupo); ou
 *   - a categoria (ou a descricao) e "Aporte de Capital" / "Retirada de
 *     Capital".
 */
export function ehMovimentoDeCapital(titulo: {
  terceiro?: string | null;
  categoria?: string | null;
  descricao?: string | null;
}): boolean {
  const terceiro = normalizarTexto(titulo.terceiro);
  if (terceiro && TRANSPORTADORAS_DO_GRUPO.some((t) => terceiro.includes(t))) {
    return true;
  }
  const categoria = normalizarTexto(titulo.categoria);
  const descricao = normalizarTexto(titulo.descricao);
  for (const c of CATEGORIAS_DE_CAPITAL) {
    if (categoria && (categoria === c || categoria.includes(c))) return true;
    if (descricao && (descricao === c || descricao.includes(c))) return true;
  }
  return false;
}
