// ------------------- Bancos exibidos no dashboard -------------------
// Lista de contas financeiras (bancos) que aparecem no painel, por empresa.
// Este arquivo e COMPARTILHADO entre o frontend (que exibe os bancos e seus
// saldos) e o backend (que filtra os titulos para considerar apenas os
// bancos desta lista) — assim os dois nunca saem do sincronismo.
//
// A lista e a MESMA para todas as empresas: sao os 4 bancos do grupo
// (Bradesco, Itau, Sicoob 3049 e Sicoob 3109). Qualquer outra conta
// financeira da Conta Azul (Cartao de Credito, Banco do Brasil, Daycoval,
// P.F., Devolucao, Garantia, Veloe...) NAO entra no relatorio.

// Os 4 bancos do grupo — fonte unica de verdade.
export const BANCOS_DO_GRUPO = ["BRADESCO", "ITAU", "SICOOB 3049", "SICOOB 3109"];

export const BANCOS_POR_EMPRESA: Record<string, string[]> = {
  "LGP Transportes": BANCOS_DO_GRUPO,
  "Rosângela Transportes": BANCOS_DO_GRUPO,
  "JRM Transportes": BANCOS_DO_GRUPO,
};

// Empresas fora da lista acima usam este conjunto.
export const BANCOS_PADRAO = BANCOS_DO_GRUPO;

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

// ------------------- Contas de outra transportadora -------------------
// Algumas contas financeiras da Conta Azul NAO sao bancos do grupo, mas
// pertence a OUTRA transportadora administrada na mesma conta. Exemplo: a
// conta "ALVARENGA TRANSPORTES" dentro da LGP (ICMS Alvarenga, compra do
// fornecedor da Alvarenga, seguro RC-V...).
//
// Os titulos pagos/recebidos por essas contas sao apresentados como uma
// empresa separada no relatorio (PDF/XLSX), como se fossem de outra
// transportadora — e NAO como titulos da empresa dona da conta.
//
// Chave: nome normalizado da conta financeira -> nome da transportadora.
export const EMPRESA_POR_CONTA: Record<string, string> = {
  "ALVARENGA TRANSPORTES": "Alvarenga Transportes",
};

// Empresa (transportadora) dona de uma conta financeira, ou null quando a
// conta e um banco do grupo (ou nao e conhecida).
export function empresaDaConta(nomeConta: string | null | undefined): string | null {
  if (!nomeConta) return null;
  const n = normalizarBanco(nomeConta);
  for (const [conta, empresa] of Object.entries(EMPRESA_POR_CONTA)) {
    if (normalizarBanco(conta) === n) return empresa;
  }
  return null;
}

// Transportadora dona de um TITULO.
//
// A conta financeira usada no pagamento (a baixa, quando existe) tem
// prioridade sobre o vinculo do titulo na listagem: e ela que diz de onde o
// dinheiro saiu/entrou. Quando essa conta pertence a OUTRA transportadora
// (ex.: "ALVARENGA TRANSPORTES" dentro da LGP), o titulo e dela — e sai do
// bloco da empresa dona da conta para formar o bloco dela no relatorio.
//
// `empresaPadrao` e a empresa dona da conta da Conta Azul (ex.: "LGP
// Transportes") e so e usada quando o titulo nao pertence a nenhuma outra
// transportadora.
export function empresaDoTitulo(
  titulo: { banco?: string | null; conta_id?: string },
  contaParaBanco: Map<string, string>,
  empresaPadrao: string,
): string {
  const nome =
    titulo.banco ||
    (titulo.conta_id ? contaParaBanco.get(String(titulo.conta_id)) : undefined) ||
    "";
  return empresaDaConta(nome) || empresaPadrao;
}

// ------------------- Blocos por transportadora -------------------
// As listas de titulos de uma empresa (ja filtradas pelos bancos exibidos no
// painel) sao separadas em BLOCOS por transportadora: os titulos de contas de
// OUTRA transportadora (ex.: "ALVARENGA TRANSPORTES" dentro da LGP) formam o
// bloco delas, como se fossem de outra transportadora no PDF/XLSX.

export type ListasPorEmpresa<T> = Record<
  "receber" | "pagar" | "pagos" | "recebidas",
  T[]
>;

const CHAVES_LISTAS = ["receber", "pagar", "pagos", "recebidas"] as const;

export function separarPorTransportadora<
  T extends { banco?: string | null; conta_id?: string },
>(
  empresaPadrao: string,
  contaParaBanco: Map<string, string>,
  listas: ListasPorEmpresa<T>,
): Map<string, ListasPorEmpresa<T>> {
  const blocos = new Map<string, ListasPorEmpresa<T>>();
  const bloco = (nome: string): ListasPorEmpresa<T> => {
    let b = blocos.get(nome);
    if (!b) {
      b = { receber: [], pagar: [], pagos: [], recebidas: [] };
      blocos.set(nome, b);
    }
    return b;
  };
  // A empresa dona da conta sempre tem um bloco (mesmo sem titulo nenhum).
  bloco(empresaPadrao);
  for (const chave of CHAVES_LISTAS) {
    for (const t of listas[chave] ?? []) {
      const nome = empresaDoTitulo(t, contaParaBanco, empresaPadrao);
      bloco(nome)[chave].push(t);
    }
  }
  return blocos;
}
