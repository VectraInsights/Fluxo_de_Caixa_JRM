// ------------------- Faturamento (planilha de cargas no Google Sheets) -------------------
// A planilha tem UMA ABA POR DIA, com o nome igual ao numero do dia ("01".."31").
// Buscamos a aba do dia pelo endpoint gviz (export CSV por nome de aba) e somamos
// a coluna F (VALOR), com parser estrito pt-BR (mimetiza o SUM do Sheets: valores
// em formato invalido, como "21,999.10", nao contam). Regras de empresa: futuras.

const ID_PLANILHA = "173ertIvql5v6l_9v6HJAQkdeL66CA4RSKo5IZrGkFhM";

function urlAba(diaNome: string) {
  return `https://docs.google.com/spreadsheets/d/${ID_PLANILHA}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(diaNome)}`;
}

// Cache por aba/dia (evita refazer fetch a cada render)
const TTL_CACHE_MS = 5 * 60 * 1000;
const cacheDias = new Map<string, { total: number; em: number }>();

export function limparCachePlanilha() {
  cacheDias.clear();
}

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

// Soma a coluna F (VALOR) da aba do dia. Retorna 0 se a aba nao existir
// (o gviz cai na primeira aba do arquivo nesse caso; detectamos pelo cabecalho,
// que nas abas de dia comeca com a data "dd.mm.aaaa").
async function somarAbaDoDia(dataIso: string): Promise<number> {
  const cacheado = cacheDias.get(dataIso);
  if (cacheado && Date.now() - cacheado.em < TTL_CACHE_MS) return cacheado.total;

  const [, mm, dd] = dataIso.split("-");
  const dataPt = `${dd}.${mm}.${dataIso.slice(0, 4)}`;

  const res = await fetch(urlAba(dd), { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    throw new Error(`Planilha de faturamento indisponivel (status ${res.status})`);
  }
  const linhas = parseCsv(await res.text());

  // Cabecalho da aba de dia comeca com a data. Se nao, e a aba padrao (aba de
  // outro nome nao existe para esta data) => sem faturamento lancado.
  const cabecalho = (linhas[0]?.[0] ?? "").trim();
  if (!cabecalho.startsWith(dataPt)) {
    cacheDias.set(dataIso, { total: 0, em: Date.now() });
    return 0;
  }

  let total = 0;
  for (let i = 1; i < linhas.length; i++) {
    const f = (linhas[i][5] ?? "").trim(); // coluna F = VALOR
    if (!f) continue;
    const v = parseValorPlanilha(f);
    if (v === null) continue; // "Pendente" ou formato invalido (mesmo criterio do SUM)
    total += v;
  }
  total = Math.round(total * 100) / 100;
  cacheDias.set(dataIso, { total, em: Date.now() });
  return total;
}

// Faturamento do periodo selecionado: soma a aba de cada dia do intervalo.
export async function buscarFaturamentoPlanilha(
  dataInicio: string,
  dataFim: string,
): Promise<{ total: number }> {
  const dias: string[] = [];
  const d = new Date(dataInicio + "T00:00:00Z");
  const f = new Date(dataFim + "T00:00:00Z");
  while (d <= f && dias.length < 62) {
    dias.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }

  const totais = await Promise.all(dias.map((dia) => somarAbaDoDia(dia)));
  const total = Math.round(totais.reduce((a, b) => a + b, 0) * 100) / 100;
  return { total };
}
