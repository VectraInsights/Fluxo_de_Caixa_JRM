// ------------------- Faturamento (planilha de cargas no Google Sheets) -------------------
// Cada MES tem a sua planilha (um endereco/novo ID por mes). O mapeamento
// mes -> id da planilha fica na tabela Supabase "planilhas_mes" e e cadastrado
// pela sidebar do dashboard (colar a URL da planilha do mes). A planilha tem
// UMA ABA POR DIA, com o nome igual ao numero do dia ("01".."31").
// Buscamos a aba do dia pelo endpoint gviz (export CSV por nome de aba) e somamos
// a coluna F (VALOR), com parser estrito pt-BR (mimetiza o SUM do Sheets: valores
// em formato invalido, como "21,999.10", nao contam).
//
// DIRECIONAMENTO: o faturamento pertence a empresa do REMETENTE (coluna B). Os nomes
// vem no formato "EMPRESA (CIDADE - UF)" — so interessa a empresa (fora parenteses).
// A ORTHOCRIN pertence a ALVARENGA, que NAO existe no dropdown: ela entra apenas
// quando a visao e "todas".

import { getSupabase, log, removerAcentos } from "./contaazul.server";

function urlAba(idPlanilha: string, diaNome: string) {
  return `https://docs.google.com/spreadsheets/d/${idPlanilha}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(diaNome)}`;
}

// Cache por aba/dia (evita refazer fetch a cada render)
// Guarda o total POR REMETENTE (cliente); o total por empresa e derivado na hora,
// assim conseguimos mostrar o detalhamento por cliente dentro de cada dia.
// A chave inclui o id da planilha: se a planilha do mes for trocada, nao serve
// resultado antigo.
const TTL_CACHE_MS = 5 * 60 * 1000;
const cacheDias = new Map<string, { porRemetente: Record<string, number>; em: number }>();

// Cache do mapeamento mes -> id da planilha (evita uma consulta ao Supabase
// por dia consultado; TTL curto para refletir cadastro/atualizacao rapido).
const cachePlanilhasMes = new Map<string, { id: string | null; em: number }>();

// nome normalizado -> nome como aparece na planilha (sem a cidade), para exibir
const nomeExibicao = new Map<string, string>();

export function limparCachePlanilha() {
  cacheDias.clear();
  cachePlanilhasMes.clear();
  nomeExibicao.clear();
}

// Id da planilha do mes ("2026-10") no Supabase. null = mes ainda nao
// cadastrado (faturamento do mes fica zerado, com aviso no dashboard).
async function idPlanilhaDoMes(mes: string): Promise<string | null> {
  const cacheado = cachePlanilhasMes.get(mes);
  if (cacheado && Date.now() - cacheado.em < TTL_CACHE_MS) return cacheado.id;
  let id: string | null = null;
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("planilhas_mes")
      .select("id_planilha")
      .eq("mes", mes)
      .limit(1);
    if (error) {
      log("warn", `planilha do mes ${mes}: ${error.message}`);
    } else if (data && data.length) {
      id = data[0].id_planilha ?? null;
    }
  } catch (e) {
    log("warn", `planilha do mes ${mes}: ${(e as Error).message}`);
  }
  cachePlanilhasMes.set(mes, { id, em: Date.now() });
  return id;
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
  // Grafia errada que aparece na planilha ("DESINGTEX") — mesmo cliente.
  "DESINGTEX": "JUVENAL",
  "MODULO EMBALAGENS": "JUVENAL",
  "ZAR PINTURAS": "JUVENAL",
  // Rio Quimica S.A. (Sao Jose do Rio Preto - SP). A chave vira
  // "RIOQUIMICA.S.A" (sem espacos); as variantes cobrem a mesma planilha
  // escrita com ponto final, so "RIOQUIMICA" ou com outro sufixo.
  "RIOQUIMICA S.A": "JUVENAL",
  "RIOQUIMICA S.A.": "JUVENAL",
  "RIOQUIMICA": "JUVENAL",
  "AMAPA": "JUVENAL",
  "MODERNA": "JUVENAL",
  "ITABOX": "JUVENAL",
  "ECONOMART": "JUVENAL",
  "ESTHAMPA": "JUVENAL",
  "FIBRASA": "JUVENAL",
};

// Chave de regra: nome normalizado SEM espacos. Assim "S.A. GONDOLAS" e
// "S.A.GONDOLAS" (duas grafias do mesmo cliente na planilha) caem na mesma
// regra, em vez de um deles ir parar em "OUTROS".
function chaveDeRegra(nome: string): string {
  return normalizarNome(nome).replace(/\s+/g, "");
}

const REGRAS_POR_CHAVE = new Map<string, Dono>(
  Object.entries(EMPRESA_POR_REMETENTE).map(([nome, dono]) => [chaveDeRegra(nome), dono]),
);

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

// Nome de exibicao do remetente: o valor da planilha sem o "(CIDADE - UF)".
function nomeSemCidade(bruto: string): string {
  return String(bruto)
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Aba do dia -> totais POR REMETENTE (chave normalizada; o dono da empresa e
// derivado depois, quando filtramos por empresa no periodo).
// Na aba de dia: coluna B (indice 1) = REMETENTE, coluna F (indice 5) = VALOR.
// Retorna null quando o MES da data nao tem planilha cadastrada (o chamador
// reporta "mes sem planilha"); retorna vazio quando a planilha existe mas nao
// tem dados naquele dia.
async function buscarAbaDoDia(dataIso: string): Promise<Record<string, number> | null> {
  const mes = dataIso.slice(0, 7);
  const idPlanilha = await idPlanilhaDoMes(mes);
  if (!idPlanilha) return null;

  const chaveCache = `${idPlanilha}:${dataIso}`;
  const cacheado = cacheDias.get(chaveCache);
  if (cacheado && Date.now() - cacheado.em < TTL_CACHE_MS) return cacheado.porRemetente;

  const [, mm, dd] = dataIso.split("-");
  const dataPt = `${dd}.${mm}.${dataIso.slice(0, 4)}`;

  const res = await fetch(urlAba(idPlanilha, dd), { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    throw new Error(`Planilha de faturamento indisponivel (status ${res.status})`);
  }
  const linhas = parseCsv(await res.text());

  // Cabecalho da aba de dia comeca com a data. Se nao, e outra aba => sem faturamento.
  const cabecalho = (linhas[0]?.[0] ?? "").trim();
  if (!cabecalho.startsWith(dataPt)) {
    const vazio: Record<string, number> = {};
    cacheDias.set(chaveCache, { porRemetente: vazio, em: Date.now() });
    return vazio;
  }

  const bruto: Record<string, number> = {};
  for (let i = 1; i < linhas.length; i++) {
    const f = (linhas[i][5] ?? "").trim(); // coluna F = VALOR
    if (!f) continue;
    const v = parseValorPlanilha(f);
    if (v === null) continue; // "Pendente" ou formato invalido (mesmo criterio do SUM)
    const brutoRemetente = (linhas[i][1] ?? "").trim(); // coluna B = REMETENTE
    if (!brutoRemetente) continue;
    const remetente = normalizarNome(brutoRemetente);
    // Guarda o nome de exibicao (sem a cidade) do primeiro jeito que vimos
    if (!nomeExibicao.has(remetente)) nomeExibicao.set(remetente, nomeSemCidade(brutoRemetente));
    bruto[remetente] = (bruto[remetente] ?? 0) + v;
  }
  const porRemetente: Record<string, number> = {};
  for (const [chave, valor] of Object.entries(bruto)) {
    porRemetente[chave] = Math.round(valor * 100) / 100;
  }
  cacheDias.set(chaveCache, { porRemetente, em: Date.now() });
  return porRemetente;
}

// Faturamento do periodo para a empresa selecionada ("todas" = tudo, inclui ALVARENGA).
// porDia traz o detalhamento por CLIENTE (remetente) dentro de cada dia, ja
// filtrado pela empresa selecionada e ordenado por valor crescente.
// meses_sem_planilha lista (YYYY-MM) os meses do periodo que ainda nao tem
// planilha cadastrada — o dashboard exibe aviso em vez de mostrar 0 "as cegas".
export async function buscarFaturamentoPlanilha(
  dataInicio: string,
  dataFim: string,
  empresa: string,
): Promise<{
  total: number;
  porDia: { data: string; total: number; clientes: { nome: string; total: number; empresa?: string }[] }[];
  meses_sem_planilha: string[];
}> {
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
  const totaisPorDia: (Record<string, number> | null)[] = new Array(dias.length);
  let idx = 0;
  async function worker() {
    while (true) {
      const meu = idx++;
      if (meu >= dias.length) return;
      totaisPorDia[meu] = await buscarAbaDoDia(dias[meu]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCORRENCIA, dias.length) }, worker));

  // Detalhamento por dia e por cliente + total do periodo
  const porDia: { data: string; total: number; clientes: { nome: string; total: number; empresa?: string }[] }[] = [];
  const mesesSemPlanilha = new Set<string>();
  let total = 0;
  for (let i = 0; i < dias.length; i++) {
    const porRemetente = totaisPorDia[i];
    const clientes: { nome: string; total: number; empresa?: string }[] = [];
    let dia = 0;
    if (porRemetente === null) {
      // Mes sem planilha cadastrada: registra para o aviso no dashboard.
      mesesSemPlanilha.add(dias[i].slice(0, 7));
    } else {
      for (const [remetente, valor] of Object.entries(porRemetente)) {
        const dono = REGRAS_POR_CHAVE.get(chaveDeRegra(remetente)) ?? "OUTROS";
        if (filtro !== null && dono !== filtro) continue;
        // "empresa" = chave da empresa dona (JUVENAL/ROSANGELA/ALVARENGA/OUTROS).
        // Permite separar o Faturamento por empresa no relatorio de "Todas".
        clientes.push({ nome: nomeExibicao.get(remetente) ?? remetente, total: valor, empresa: dono });
        dia += valor;
      }
    }
    dia = Math.round(dia * 100) / 100;
    total += dia;
    // Mesma regra de ordenacao das listas: valor crescente, depois nome
    clientes.sort((a, b) => a.total - b.total || a.nome.localeCompare(b.nome));
    porDia.push({ data: dias[i], total: dia, clientes });
  }
  return {
    total: Math.round(total * 100) / 100,
    porDia,
    meses_sem_planilha: [...mesesSemPlanilha].sort(),
  };
}

// ------------------- Leitura do nome (titulo) da planilha -------------------
// Dois metodos, em ordem: (1) tag <title> da pagina /edit — retorna EXATAMENTE
// o nome do documento ("10.26 OUTUBRO - Google Planilhas" -> "10.26 OUTUBRO");
// (2) cabecalho Content-Disposition do export CSV — mais leve, mas o nome
// vem no formato "<documento> - <primeira aba>", incluindo a aba no sufixo.
// Ambos exigem planilha compartilhada como "qualquer pessoa com o link".
export async function lerTituloPlanilha(idPlanilha: string): Promise<string | null> {
  try {
    const res = await fetch(`https://docs.google.com/spreadsheets/d/${idPlanilha}/edit`, {
      signal: AbortSignal.timeout(15_000),
      redirect: "follow",
    });
    if (res.ok) {
      const html = await res.text();
      const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      // So aceita titulos de pagina de documento real (sufixo "Google Planilhas/
      // Sheets/Drive"); paginas de login/consenso caem no metodo 2.
      if (m && /\s-\sGoogle\s(Planilhas|Sheets|Drive)\s*$/i.test(m[1])) {
        const nome = m[1].replace(/\s*-\s*Google\s+(Planilhas|Sheets|Drive)\s*$/i, "").trim();
        if (nome) return nome;
      }
    }
  } catch {
    // tenta o proximo metodo
  }
  try {
    const res = await fetch(
      `https://docs.google.com/spreadsheets/d/${idPlanilha}/export?format=csv`,
      { method: "HEAD", signal: AbortSignal.timeout(15_000), redirect: "follow" },
    );
    const disp = res.headers.get("content-disposition") || "";
    const estrela = disp.match(/filename\*=UTF-8''([^;]+)/i);
    const simples = disp.match(/filename="?([^";]+)"?/i);
    const bruto = estrela ? estrela[1] : simples ? simples[1] : null;
    if (bruto) {
      // Pode incluir a primeira aba no sufixo ("<documento> - <aba>.csv");
      // o parser de mes continua funcionando nesse formato.
      const nome = decodeURIComponent(bruto).replace(/\.csv$/i, "").trim();
      if (nome) return nome;
    }
  } catch {
    // sem titulo
  }
  return null;
}

// ------------------- Deducao de mes/ano a partir do nome -------------------
const MESES_POR_NOME: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
  jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6,
  jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
};
const RE_NOME_MES =
  /\b(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\b/;

// Deduz "YYYY-MM" a partir do nome da planilha. Formatos aceitos:
// "10.26 OUTUBRO - ADF" (MM.AA + nome), "Novembro 2026", "faturamento 2026-11",
// "11/2026", "26.11" etc. null = nao conseguiu deduzir (o chamador usa o mes
// visado como fallback, sempre com confirmacao do usuario).
export function mesDoTitulo(titulo: string): string | null {
  if (!titulo) return null;
  const t = removerAcentos(titulo).toLowerCase();

  // 1) Contem nome de mes: pega o mes dele e procura o ano (4 digitos, ou
  //    dois digitos plausiveis — ex.: "10.26" -> 26 = 2026).
  const mNome = t.match(RE_NOME_MES);
  if (mNome) {
    const mes = MESES_POR_NOME[mNome[1]];
    const ano4 = t.match(/\b(20\d{2})\b/);
    if (ano4) return `${ano4[1]}-${String(mes).padStart(2, "0")}`;
    const candidatos = [...t.matchAll(/\b(\d{2})\b/g)]
      .map((m) => Number(m[1]))
      .filter((n) => n >= 15 && n <= 99);
    if (candidatos.length) return `20${candidatos[0]}-${String(mes).padStart(2, "0")}`;
    return null; // tem mes, mas nao achou ano
  }

  // 2) Sem nome de mes: formatos numericos puros.
  const anoMes = t.match(/\b(20\d{2})[-/.](0?[1-9]|1[0-2])\b/); // 2026-11
  if (anoMes) return `${anoMes[1]}-${String(anoMes[2]).padStart(2, "0")}`;
  const mesAno4 = t.match(/\b(0?[1-9]|1[0-2])[-/.](20\d{2})\b/); // 11-2026
  if (mesAno4) return `${mesAno4[2]}-${String(mesAno4[1]).padStart(2, "0")}`;
  const mesAno2 = t.match(/\b(0?[1-9]|1[0-2])[.\-](\d{2})\b/); // 10.26 -> MM.AA
  if (mesAno2) return `20${mesAno2[2]}-${String(mesAno2[1]).padStart(2, "0")}`;
  const ano2Mes = t.match(/\b(\d{2})[.\-](0?[1-9]|1[0-2])\b/); // 26.10 -> AA.MM
  if (ano2Mes) return `20${ano2Mes[1]}-${String(ano2Mes[2]).padStart(2, "0")}`;
  return null;
}
