// ------------------- Faturamento (planilha de cargas no Google Sheets) -------------------
// A planilha tem UMA ABA POR DIA, com o nome igual ao numero do dia ("01".."31").
// Buscamos a aba do dia pelo endpoint gviz (export CSV por nome de aba) e somamos
// a coluna F (VALOR), com parser estrito pt-BR (mimetiza o SUM do Sheets: valores
// em formato invalido, como "21,999.10", nao contam).
//
// DIRECIONAMENTO: o faturamento pertence a empresa do REMETENTE (coluna B). Os nomes
// vem no formato "EMPRESA (CIDADE - UF)" — so interessa a empresa (fora parenteses).
// A ORTHOCRIN pertence a ALVARENGA, que NAO existe no dropdown: ela entra apenas
// quando a visao e "todas".

const ID_PLANILHA = "173ertIvql5v6l_9v6HJAQkdeL66CA4RSKo5IZrGkFhM";

function urlAba(diaNome: string) {
  return `https://docs.google.com/spreadsheets/d/${ID_PLANILHA}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(diaNome)}`;
}

// Cache por aba/dia (evita refazer fetch a cada render)
const TTL_CACHE_MS = 5 * 60 * 1000;
const cacheDias = new Map<string, { porEmpresa: Record<string, number>; em: number }>();

export function limparCachePlanilha() {
  cacheDias.clear();
}

// ------------------- Regras de direcionamento (remetente -> empresa) -------------------
// Chaves normalizadas (sem acento, maiuscula, sem "(CIDADE - UF)").
type Dono = "JUVENAL" | "ROSANGELA" | "ALVARENGA";

const EMPRESA_POR_REMETENTE: Record<string, Dono> = {
  "S.A.GONDOLAS": "ROSANGELA",
  "EMATEX": "ROSANGELA",
  "FARMAX": "JUVENAL",
  "EMBARE": "JUVENAL",
  "TECNO2000": "JUVENAL",
  "ORTHOCRIN": "ALVARENGA",
  "ESPUMIL": "JUVENAL",
  "BELACCI": "JUVENAL",
  "COPRA": "JUVENAL",
  "AGRONORTE": "JUVENAL",
  "DESIGNTEX": "JUVENAL",
  "AMAPA": "JUVENAL",
  "MODERNA": "JUVENAL",
  "ITABOX": "JUVENAL",
  "ECONOMART": "JUVENAL",
  "ESTHAMPA": "JUVENAL",
  "FIBRASA": "JUVENAL",
};

// Remove "(CIDADE - UF)", acentos e espacos duplicados; maiusculas.
function normalizarNome(s: string): string {
  return (s || "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

// "Juvenal Transportes" -> "JUVENAL"; "todas"/vazio -> null (sem filtro).
// Empresa sem regra de faturamento -> chave que nao casa com ninguem (total 0).
function filtroDaEmpresa(empresa: string): string | null {
  if (!empresa || empresa === "todas") return null;
  const n = normalizarNome(empresa);
  for (const chave of ["JUVENAL", "ROSANGELA", "ALVARENGA"] as const) {
    if (n.startsWith(chave)) return chave;
  }
  return "__SEM_FATURAMENTO__";
}

// ------------------- Leitura da planilha -------------------

// Parser CSV que respeita aspas e quebras de linha dentro de campo
function parseCsv(texto: string): string[][] {
  const linhas: string[][] = [];
  let campo = "";
  let linha: string[] = [];
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else aspas = false;
      } else campo += c;
    } else if (c === '"') {
      aspas = true;
    } else if (c === ",") {
      linha.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      linha.push(campo);
      campo = "";
      linhas.push(linha);
      linha = [];
    } else {
      campo += c;
    }
  }
  if (campo.length || linha.length) {
    linha.push(campo);
    linhas.push(linha);
  }
  return linhas;
}

// Parser ESTRICTO pt-BR, igual ao que o Sheets soma:
// "R$ 23.000,00" / "23.000" -> numero. "21,999.10" (formato US) -> invalido -> null.
export function parseValorPlanilha(s: string): number | null {
  if (!s) return null;
  let t = String(s).trim();
  if (!t) return null;
  t = t.replace(/R\$/i, "").trim();
  if (!/^[\d.,]+$/.test(t)) return null; // "Pendente" ou texto
  const p = t.lastIndexOf(".");
  const v = t.lastIndexOf(",");
  if (p >= 0 && v >= 0) {
    if (v < p) return null; // virgula antes do ponto = formato invalido em pt-BR
    t = t.replace(/\./g, "").replace(",", "."); // 23.000,00
  } else if (v >= 0) {
    t = t.replace(",", "."); // virgula sempre decimal em pt-BR
  } else if (p >= 0) {
    if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, ""); // 23.000 = milhar
    else if (!/^\d+\.\d{1,2}$/.test(t)) return null;
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// Aba do dia -> totais por empresa (JUVENAL / ROSANGELA / ALVARENGA / OUTROS).
// Na aba de dia: coluna B (indice 1) = REMETENTE, coluna F (indice 5) = VALOR.
// Retorna 0/totais vazios se a aba nao existir (o gviz cai na primeira aba do
// arquivo nesse caso; detectamos pelo cabecalho, que nas abas de dia comeca
// com a data "dd.mm.aaaa").
async function buscarAbaDoDia(dataIso: string): Promise<Record<string, number>> {
  const cacheado = cacheDias.get(dataIso);
  if (cacheado && Date.now() - cacheado.em < TTL_CACHE_MS) return cacheado.porEmpresa;

  const [, mm, dd] = dataIso.split("-");
  const dataPt = `${dd}.${mm}.${dataIso.slice(0, 4)}`;

  const res = await fetch(urlAba(dd), { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    throw new Error(`Planilha de faturamento indisponivel (status ${res.status})`);
  }
  const linhas = parseCsv(await res.text());

  // Cabecalho da aba de dia comeca com a data. Se nao, e outra aba => sem faturamento.
  const cabecalho = (linhas[0]?.[0] ?? "").trim();
  if (!cabecalho.startsWith(dataPt)) {
    const vazio: Record<string, number> = {};
    cacheDias.set(dataIso, { porEmpresa: vazio, em: Date.now() });
    return vazio;
  }

  const bruto: Record<string, number> = {};
  for (let i = 1; i < linhas.length; i++) {
    const f = (linhas[i][5] ?? "").trim(); // coluna F = VALOR
    if (!f) continue;
    const v = parseValorPlanilha(f);
    if (v === null) continue; // "Pendente" ou formato invalido (mesmo criterio do SUM)
    const remetente = normalizarNome(linhas[i][1] ?? ""); // coluna B = REMETENTE
    const dono = EMPRESA_POR_REMETENTE[remetente] ?? "OUTROS";
    bruto[dono] = (bruto[dono] ?? 0) + v;
  }
  const porEmpresa: Record<string, number> = {};
  for (const [chave, valor] of Object.entries(bruto)) {
    porEmpresa[chave] = Math.round(valor * 100) / 100;
  }
  cacheDias.set(dataIso, { porEmpresa, em: Date.now() });
  return porEmpresa;
}

// Faturamento do periodo para a empresa selecionada ("todas" = tudo, inclui ALVARENGA).
export async function buscarFaturamentoPlanilha(
  dataInicio: string,
  dataFim: string,
  empresa: string,
): Promise<{ total: number; porDia: { data: string; total: number }[] }> {
  const filtro = filtroDaEmpresa(empresa);

  const dias: string[] = [];
  const d = new Date(dataInicio + "T00:00:00Z");
  const f = new Date(dataFim + "T00:00:00Z");
  while (d <= f && dias.length < 62) {
    dias.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }

  // Busca as abas com concistencia limitada (no modo "Mês atual" sao ~31 abas)
  const CONCORRENCIA = 5;
  const totaisPorDia: Record<string, number>[] = new Array(dias.length);
  let idx = 0;
  async function worker() {
    while (true) {
      const meu = idx++;
      if (meu >= dias.length) return;
      totaisPorDia[meu] = await buscarAbaDoDia(dias[meu]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCORRENCIA, dias.length) }, worker));

  // Detalhamento por dia (para o relatorio/exportacao) + total do periodo
  const porDia: { data: string; total: number }[] = [];
  let total = 0;
  for (let i = 0; i < dias.length; i++) {
    const porEmpresa = totaisPorDia[i];
    let dia = 0;
    if (porEmpresa) {
      for (const [chave, valor] of Object.entries(porEmpresa)) {
        if (filtro === null || chave === filtro) dia += valor;
      }
    }
    dia = Math.round(dia * 100) / 100;
    total += dia;
    porDia.push({ data: dias[i], total: dia });
  }
  return { total: Math.round(total * 100) / 100, porDia };
}
