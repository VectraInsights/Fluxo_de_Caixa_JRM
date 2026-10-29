// ------------------- Faturamento (planilha de cargas no Google Sheets) -------------------
// Le a planilha de cargas via export CSV publico do Google Sheets e soma a
// coluna F (VALOR). Por enquanto e uma logica simples (aba unica, gid fixo):
// as regras de empresa e periodo serao adicionadas depois.

const URL_PLANILHA =
  "https://docs.google.com/spreadsheets/d/173ertIvql5v6l_9v6HJAQkdeL66CA4RSKo5IZrGkFhM/export?format=csv&gid=740542107";

// Cache em memoria por instancia (evita refazer fetch a cada render)
const TTL_CACHE_MS = 5 * 60 * 1000;
let cache: { valor: { total: number; quantidade: number; data: string | null }; em: number } | null = null;

export function limparCachePlanilha() {
  cache = null;
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

// Converte valores mistos da coluna VALOR em numero:
// "R$ 23.000,00", "21,999.10", "1.234,56" -> numero. "Pendente"/vazio -> null.
export function parseValorPlanilha(s: string): number | null {
  if (!s) return null;
  let t = String(s).trim();
  if (!t || /^pendente$/i.test(t)) return null;
  t = t.replace(/R\$/i, "").trim();
  if (!/^[\d.,]+$/.test(t)) return null;
  const temPonto = t.includes(".");
  const temVirgula = t.includes(",");
  if (temPonto && temVirgula) {
    // o ultimo separador encontrado e o decimal
    if (t.lastIndexOf(",") > t.lastIndexOf(".")) t = t.replace(/\./g, "").replace(",", ".");
    else t = t.replace(/,/g, "");
  } else if (temVirgula) {
    // so virgula: "21,999" (3 digits no fim = milhar) ou "23,50" (decimal)
    t = /,\d{3}$/.test(t) ? t.replace(/,/g, "") : t.replace(",", ".");
  } else if (temPonto) {
    // so ponto: "23.000" (milhar) ou "23.5" (decimal)
    t = /\.\d{3}$/.test(t) ? t.replace(/\./g, "") : t;
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// Extrai a data do cabeçalho da aba (linha 1: "29.10.2026,CARGAS -")
function extrairDataAba(primeiraLinha: string[] | undefined): string | null {
  const bruto = (primeiraLinha?.[0] ?? "").trim();
  const m = bruto.match(/^(\d{2})[./-](\d{2})[./-](\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

export async function buscarFaturamentoPlanilha(): Promise<{
  total: number;
  quantidade: number;
  data: string | null;
}> {
  if (cache && Date.now() - cache.em < TTL_CACHE_MS) return cache.valor;

  const res = await fetch(URL_PLANILHA, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    throw new Error(`Planilha de faturamento indisponivel (status ${res.status})`);
  }
  const texto = await res.text();
  const linhas = parseCsv(texto);

  let total = 0;
  let quantidade = 0;
  // linha 0 = data da aba; linha 1 = cabecalhos (DESCRIÇÃO, ..., VALOR, ...); resto = dados
  for (let i = 2; i < linhas.length; i++) {
    const f = (linhas[i][5] ?? "").trim(); // coluna F = VALOR
    if (!f) continue;
    const v = parseValorPlanilha(f);
    if (v === null) continue; // "Pendente" ou texto nao numerico
    total += v;
    quantidade++;
  }

  const valor = {
    total: Math.round(total * 100) / 100,
    quantidade,
    data: extrairDataAba(linhas[0]),
  };
  cache = { valor, em: Date.now() };
  return valor;
}
