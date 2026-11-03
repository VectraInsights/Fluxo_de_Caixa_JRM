// ------------------- Bancos exibidos no dashboard -------------------
// Lista de contas financeiras (bancos) que aparecem no painel, por empresa.
// Este arquivo e COMPARTILHADO entre o frontend (que exibe os bancos e seus
// saldos) e o backend (que filtra os titulos para considerar apenas os
// bancos desta lista) — assim os dois nunca saem do sincronismo.

export const BANCOS_POR_EMPRESA: Record<string, string[]> = {
  "LGP Transportes": ["BRADESCO", "ITAU", "SICOOB 3049", "SICOOB 3109"],
  "Rosângela Transportes": ["BRADESCO", "ITAU", "SICOOB 3049", "SICOOB 3109"],
  "JRM Transportes": ["BRADESCO", "ITAU", "SICOOB 3049", "SICOOB 3109"],
};

// Empresas fora da lista acima usam este conjunto.
export const BANCOS_PADRAO = ["ITAU", "SICOOB", "SICOOB 3109", "BRADESCO"];

// Normaliza nome de banco: sem acento, maiusculo, sem espaco nas pontas.
export function normalizarBanco(nome: string): string {
  return (nome || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
}

// Chaves que terminam em numero (ex.: "SICOOB 3049") podem vir truncadas no
// avatar, entao aceitamos prefixo. As demais (BRADESCO, ITAU) exigem
// correspondencia exata para nao bater em "Bradesco ap." por acaso.
export function bancoPermitido(nome: string, permitido: string): boolean {
  const n = normalizarBanco(nome);
  const p = normalizarBanco(permitido);
  if (n === p) return true;
  if (/\d\s*$/.test(p)) return n.startsWith(p);
  return false;
}

// Lista de bancos exibidos para a empresa. Lista vazia = mostrar todos
// (e, no backend, nao filtrar titulo nenhum).
export function bancosPermitidosDaEmpresa(empresa: string): string[] {
  const chave = normalizarBanco(empresa);
  for (const [nome, lista] of Object.entries(BANCOS_POR_EMPRESA)) {
    if (normalizarBanco(nome) === chave) return lista;
  }
  return BANCOS_PADRAO;
}
