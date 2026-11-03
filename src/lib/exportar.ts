// Exportacao das listas de titulos (A Receber, A Pagar, Pagos, Recebidos) para
// PDF e XLSX. Tudo roda no navegador: as libs sao carregadas sob demanda
// (import dinamico), para nao pesar no bundle inicial nem quebrar o SSR.

import type { TituloDetalhe } from "./contaazul.functions";

export type LinhaExport = TituloDetalhe & { empresa?: string };

export type FaturamentoExport = {
  total: number;
  porDia: {
    data: string;
    total: number;
    // Detalhe por cliente (remetente) dentro do dia; opcional para
    // compatibilidade com dados antigos (dia sem detalhe sai sem linhas).
    // "empresa" = chave da empresa dona da carga (JUVENAL/ROSANGELA/
    // ALVARENGA/OUTROS) — usada para separar o relatorio por empresa.
    clientes?: { nome: string; total: number; empresa?: string }[];
  }[];
};

export type RelatorioListas = {
  empresa: string;
  dataInicio: string;
  dataFim: string;
  receber: LinhaExport[];
  pagar: LinhaExport[];
  pagos: LinhaExport[];
  recebidas: LinhaExport[];
  faturamento: FaturamentoExport;
};

const ROTULOS: {
  chave: "receber" | "pagar" | "pagos" | "recebidas";
  titulo: string;
  cor: [number, number, number];
  // Rotulo da coluna de terceiro: quem paga/recebe em "A Receber" e quem
  // recebe/paga nas demais listas.
  rotuloTerceiro: string;
}[] = [
  { chave: "receber", titulo: "A Receber", cor: [22, 163, 74], rotuloTerceiro: "Cliente" },
  { chave: "pagar", titulo: "A Pagar", cor: [220, 38, 38], rotuloTerceiro: "Fornecedor" },
  { chave: "pagos", titulo: "Pagos", cor: [220, 38, 38], rotuloTerceiro: "Fornecedor" },
  { chave: "recebidas", titulo: "Recebidos", cor: [22, 163, 74], rotuloTerceiro: "Cliente" },
];

// No PDF impresso entram apenas "Faturamento", "Recebidos" e "Pagos" (sem A
// Receber, sem A Pagar e sem o card de Resultado), nessa ordem. O XLSX exporta
// todas as listas (inclusive A Receber e A Pagar) e mantem o Resultado no Resumo.
const ROTULOS_PDF = (["recebidas", "pagos"] as const)
  .map((chave) => ROTULOS.find((item) => item.chave === chave))
  .filter((item): item is (typeof ROTULOS)[number] => !!item);

// Resultado do periodo: A Receber - A Pagar. Considera APENAS as listas de
// titulos em aberto (Faturamento e Pagos ficam de fora do calculo).
function calcularResultado(rel: RelatorioListas): number {
  const receber = (rel.receber ?? []).reduce((s, t) => s + (Number(t.valor) || 0), 0);
  const pagar = (rel.pagar ?? []).reduce((s, t) => s + (Number(t.valor) || 0), 0);
  return receber - pagar;
}

function formatarDataBR(iso: string): string {
  if (!iso) return "";
  const p = iso.slice(0, 10).split("-");
  if (p.length !== 3) return iso;
  return `${p[2]}/${p[1]}/${p[0]}`;
}

function formatarValor(v: number): string {
  return (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function tituloDaLinha(t: LinhaExport): string {
  return t.descricao || t.terceiro || "";
}

function subtituloDaLinha(t: LinhaExport): string {
  return t.descricao && t.terceiro ? t.terceiro : "";
}

// Ordenacao usada na tela (cronologica):
// 1) data (crescente / cronologica)
// 2) valor (crescente)
// 3) descricao (alfabetica) e empresa (alfabetica) — desempate deterministico
export function ordenarTitulos(lista: LinhaExport[]): LinhaExport[] {
  return [...(lista || [])].sort((a, b) => {
    const da = a.data || "";
    const db = b.data || "";
    if (da !== db) return da.localeCompare(db);

    const va = Math.abs(Number(a.valor) || 0);
    const vb = Math.abs(Number(b.valor) || 0);
    if (va !== vb) return va - vb;

    const desc = tituloDaLinha(a).localeCompare(tituloDaLinha(b), "pt-BR");
    if (desc !== 0) return desc;

    return (a.empresa || "").localeCompare(b.empresa || "", "pt-BR");
  });
}

// Normaliza nome para comparacao alfabetica (sem acento, minusculas).
function chaveNome(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

// Ordenacao dos RELATORIOS (PDF/XLSX): primeiro por Cliente/Fornecedor em ordem
// alfabetica; dentro do mesmo terceiro, data crescente e depois valor crescente.
// Titulos sem terceiro vao para o fim. A tela NAO usa esta funcao (mantem a
// cronologica ordenarTitulos).
export function ordenarTitulosRelatorio(lista: LinhaExport[]): LinhaExport[] {
  return [...(lista || [])].sort((a, b) => {
    const ta = chaveNome(a.terceiro || "");
    const tb = chaveNome(b.terceiro || "");
    if (ta !== tb) {
      if (!ta) return 1; // sem terceiro, por ultimo
      if (!tb) return -1;
      return ta.localeCompare(tb, "pt-BR");
    }

    const da = a.data || "";
    const db = b.data || "";
    if (da !== db) return da.localeCompare(db);

    const va = Math.abs(Number(a.valor) || 0);
    const vb = Math.abs(Number(b.valor) || 0);
    if (va !== vb) return va - vb;

    const desc = tituloDaLinha(a).localeCompare(tituloDaLinha(b), "pt-BR");
    if (desc !== 0) return desc;

    return (a.empresa || "").localeCompare(b.empresa || "", "pt-BR");
  });
}

function nomeDoArquivo(rel: RelatorioListas): string {
  const empresa = rel.empresa === "todas" ? "todas" : rel.empresa.replace(/[^\w\-]+/g, "_");
  return `fluxo-caixa_${empresa}_${rel.dataInicio}_${rel.dataFim}`;
}

// ------------------------------- XLSX -------------------------------

// Paleta do relatório (mesma ideia do PDF: cabeçalho escuro, zebrado
// discreto no corpo e a cor da relação nos destaques)
const XLSX_CORES = {
  titulo: "FF0F172A",
  subtitulo: "FF64748B",
  cabecalho: "FF1E293B",
  branco: "FFFFFFFF",
  zebra: "FFF8FAFC",
  borda: "FFE2E8F0",
  total: "FFE2E8F0",
  totalDia: "FFF1F5F9",
  verde: "FF16A34A",
  vermelho: "FFDC2626",
};

const XLSX_MOEDA = '"R$" #,##0.00;[Red]-"R$" #,##0.00';
const XLSX_INTEIRO = "#,##0";

type CelulaXlsx = string | number;

type LinhaXlsx = {
  valores: CelulaXlsx[];
  // "acento": a 1ª célula ganha o fundo na cor da relação (visual dos cards do PDF)
  // "total-dia": linha de total do dia (fundo claro + negrito)
  tipo?: "normal" | "total-dia" | "acento";
  cor?: string;
};

type TabelaXlsx = {
  titulo: string;
  subtitulo: string;
  corTitulo?: string;
  cabecalho: string[];
  linhas: LinhaXlsx[];
  total?: CelulaXlsx[];
  larguras: number[];
  alinhamentos: ("left" | "center" | "right")[];
  colunasQuebra?: number[];
  colunaMoeda?: number;
  colunaInteiro?: number;
  autofiltro?: boolean;
};

function xlsxHex(cor: [number, number, number]): string {
  return "FF" + cor.map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0")).join("").toUpperCase();
}

function xlsxBorda(cor = XLSX_CORES.borda, estilo: "thin" | "medium" | "double" = "thin") {
  const lado = { style: estilo, color: { rgb: cor } };
  return { top: lado, bottom: lado, left: lado, right: lado };
}

function xlsxEstiloCabecalho() {
  return {
    font: { name: "Calibri", sz: 11, bold: true, color: { rgb: XLSX_CORES.branco } },
    fill: { fgColor: { rgb: XLSX_CORES.cabecalho } },
    alignment: { horizontal: "center", vertical: "center", wrapText: true },
    border: xlsxBorda(),
  };
}

function xlsxEstiloCorpo(alinhamento: "left" | "center" | "right", zebra: boolean, quebrar = false) {
  return {
    font: { name: "Calibri", sz: 10 },
    alignment: { horizontal: alinhamento, vertical: "center", wrapText: quebrar },
    border: xlsxBorda(),
    ...(zebra ? { fill: { fgColor: { rgb: XLSX_CORES.zebra } } } : {}),
  };
}

// Monta uma aba formatada: título + subtítulo + cabeçalho + corpo + total.
function montarTabelaXlsx(XLSX: any, t: TabelaXlsx) {
  const nCol = t.cabecalho.length;
  const aoa: CelulaXlsx[][] = [];
  aoa.push([t.titulo, ...Array(nCol - 1).fill("")]);
  aoa.push([t.subtitulo, ...Array(nCol - 1).fill("")]);
  aoa.push(Array(nCol).fill(""));
  aoa.push([...t.cabecalho]);
  for (const l of t.linhas) aoa.push([...l.valores]);
  const fimCorpo = aoa.length; // 1-based: última linha do corpo
  if (t.total) aoa.push([...t.total]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  const definir = (r: number, c: number, estilo: any) => {
    const endereco = XLSX.utils.encode_cell({ r, c });
    const celula = ws[endereco] ?? (ws[endereco] = { t: "s", v: "" });
    celula.s = estilo;
  };

  // Título (linha 1) e subtítulo (linha 2)
  for (let c = 0; c < nCol; c++) {
    definir(0, c, {
      font: { name: "Calibri", sz: 15, bold: true, color: { rgb: t.corTitulo ?? XLSX_CORES.titulo } },
      alignment: { horizontal: "left", vertical: "center" },
    });
    definir(1, c, {
      font: { name: "Calibri", sz: 10, italic: true, color: { rgb: XLSX_CORES.subtitulo } },
      alignment: { horizontal: "left", vertical: "center" },
    });
  }

  // Cabeçalho da tabela (linha 4)
  for (let c = 0; c < nCol; c++) definir(3, c, xlsxEstiloCabecalho());

  // Corpo
  t.linhas.forEach((linha, i) => {
    const r = 4 + i;
    const zebra = i % 2 === 1;
    for (let c = 0; c < nCol; c++) {
      const alinhamento = t.alinhamentos[c] ?? "left";
      const quebra = (t.colunasQuebra ?? []).includes(c);
      let estilo: any;
      if (linha.tipo === "acento") {
        estilo =
          c === 0
            ? {
                font: { name: "Calibri", sz: 11, bold: true, color: { rgb: XLSX_CORES.branco } },
                fill: { fgColor: { rgb: linha.cor ?? XLSX_CORES.cabecalho } },
                alignment: { horizontal: "left", vertical: "center" },
                border: xlsxBorda(),
              }
            : {
                font: { name: "Calibri", sz: 10, bold: true },
                fill: { fgColor: { rgb: XLSX_CORES.zebra } },
                alignment: { horizontal: alinhamento, vertical: "center" },
                border: xlsxBorda(),
              };
      } else if (linha.tipo === "total-dia") {
        estilo = {
          font: { name: "Calibri", sz: 10, bold: true, color: { rgb: XLSX_CORES.titulo } },
          fill: { fgColor: { rgb: XLSX_CORES.totalDia } },
          alignment: { horizontal: alinhamento, vertical: "center" },
          border: xlsxBorda(),
        };
      } else {
        estilo = xlsxEstiloCorpo(alinhamento, zebra, quebra);
      }
      if (t.colunaMoeda === c) {
        estilo = { ...estilo, numFmt: XLSX_MOEDA, alignment: { horizontal: "right", vertical: "center" } };
      }
      if (t.colunaInteiro === c) {
        estilo = { ...estilo, numFmt: XLSX_INTEIRO, alignment: { horizontal: "center", vertical: "center" } };
      }
      definir(r, c, estilo);
    }
  });

  // Linha de total
  if (t.total) {
    const r = 4 + t.linhas.length;
    for (let c = 0; c < nCol; c++) {
      const estilo: any = {
        font: { name: "Calibri", sz: 11, bold: true, color: { rgb: XLSX_CORES.titulo } },
        fill: { fgColor: { rgb: XLSX_CORES.total } },
        alignment: { horizontal: c === 0 ? "left" : "right", vertical: "center" },
        border: { ...xlsxBorda(), top: { style: "double", color: { rgb: XLSX_CORES.cabecalho } } },
      };
      if (t.colunaMoeda === c) estilo.numFmt = XLSX_MOEDA;
      if (t.colunaInteiro === c) estilo.numFmt = XLSX_INTEIRO;
      definir(r, c, estilo);
    }
  }

  // Larguras, alturas, merges e autofiltro
  ws["!cols"] = t.larguras.map((wch) => ({ wch }));
  ws["!rows"] = [{ hpt: 24 }, { hpt: 16 }, { hpt: 6 }, { hpt: 30 }];
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: nCol - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: nCol - 1 } },
  ];
  if (t.autofiltro && t.linhas.length > 0) {
    ws["!autofilter"] = { ref: `A4:${XLSX.utils.encode_col(nCol - 1)}${fimCorpo}` };
  }

  return ws;
}

// Ajustes que o SheetJS não grava sozinho: painel congelado, linhas de grade
// escondidas e cor da aba. Feito remontando o zip do .xlsx.
async function finalizarXlsx(
  buf: ArrayBuffer,
  abas: { nome: string; linhasCongeladas: number; cor?: string }[],
): Promise<Uint8Array<ArrayBuffer>> {
  const fflate: any = await import("fflate");
  const arquivos: Record<string, Uint8Array> = fflate.unzipSync(new Uint8Array(buf));

  // Mapa: nome da aba -> caminho do XML da worksheet
  const mapa = new Map<string, string>();
  try {
    const wbXml = fflate.strFromU8(arquivos["xl/workbook.xml"]);
    const relsXml = fflate.strFromU8(arquivos["xl/_rels/workbook.xml.rels"]);
    const rels = new Map<string, string>();
    for (const m of relsXml.matchAll(/<Relationship\b[^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"/g)) {
      rels.set(m[1], m[2]);
    }
    for (const m of wbXml.matchAll(/<sheet\b[^>]*?name="([^"]+)"[^>]*?r:id="([^"]+)"[^>]*?\/?>/g)) {
      const alvo = rels.get(m[2]);
      if (!alvo) continue;
      const caminho = alvo.startsWith("/") ? alvo.slice(1) : `xl/${alvo.replace(/^\.\//, "")}`;
      mapa.set(m[1], caminho);
    }
  } catch {
    // sem mapa: cai para a ordem posicional das abas
  }

  abas.forEach((aba, indice) => {
    const caminho = mapa.get(aba.nome) ?? `xl/worksheets/sheet${indice + 1}.xml`;
    const original = arquivos[caminho];
    if (!original) return;
    let xml = fflate.strFromU8(original);

    const congelar = aba.linhasCongeladas;
    const linhaTopo = congelar + 1;
    const painel =
      `<pane ySplit="${congelar}" topLeftCell="A${linhaTopo}" activePane="bottomLeft" state="frozen"/>` +
      `<selection pane="bottomLeft" activeCell="A${linhaTopo}" sqref="A${linhaTopo}"/>`;

    if (/<sheetView\b[^>]*?\/>/.test(xml)) {
      xml = xml.replace(/<sheetView\b([^>]*?)\/>/, `<sheetView$1 showGridLines="0">${painel}</sheetView>`);
    } else {
      xml = xml.replace(/(<sheetView\b[^>]*>)/, `$1${painel}`);
    }

    if (aba.cor && !/<sheetPr[\s>]/.test(xml)) {
      xml = xml.replace(/(<worksheet\b[^>]*>)/, `$1<sheetPr><tabColor rgb="${aba.cor}"/></sheetPr>`);
    }

    arquivos[caminho] = fflate.strToU8(xml);
  });

  // Rezip com [Content_Types].xml na primeira posição (exigência de alguns leitores OPC)
  const saida: Record<string, Uint8Array> = {};
  const ct = arquivos["[Content_Types].xml"];
  if (ct) saida["[Content_Types].xml"] = ct;
  for (const [nome, dados] of Object.entries(arquivos)) {
    if (nome !== "[Content_Types].xml") saida[nome] = dados;
  }
  const zip = fflate.zipSync(saida, { level: 6 }) as Uint8Array;
  // Copia para um buffer próprio (o Blob do navegador exige ArrayBuffer, não SharedArrayBuffer)
  const copia = new Uint8Array(zip.length);
  copia.set(zip);
  return copia;
}

// Gera o .xlsx (estilizado) e devolve os bytes.
export async function construirXlsx(rel: RelatorioListas): Promise<Uint8Array<ArrayBuffer>> {
  const mod: any = await import("xlsx-js-style");
  const XLSX: any = mod.default ?? mod;
  const wb = XLSX.utils.book_new();

  const fat = rel.faturamento ?? { total: 0, porDia: [] };
  const periodo = `Período: ${formatarDataBR(rel.dataInicio)} a ${formatarDataBR(rel.dataFim)}    |    Empresa: ${
    rel.empresa === "todas" ? "Todas as Empresas" : rel.empresa
  }`;

  // ---------------- Aba Resumo (visual dos cards do PDF) ----------------
  // Mesmas 4 relacoes dos cards do PDF + o "Resultado" (A Receber - A Pagar).
  const resultado = calcularResultado(rel);
  const resumoLinhas: LinhaXlsx[] = [
    {
      valores: ["Faturamento", fat.total, fat.porDia.filter((d) => d.total !== 0).length],
      tipo: "acento",
      cor: XLSX_CORES.verde,
    },
  ];
  for (const item of ROTULOS) {
    const lista = ordenarTitulosRelatorio(rel[item.chave]);
    const total = lista.reduce((s, t) => s + (Number(t.valor) || 0), 0);
    resumoLinhas.push({
      valores: [item.titulo, total, lista.length],
      tipo: "acento",
      cor: xlsxHex(item.cor),
    });
  }
  resumoLinhas.push({
    valores: ["Resultado (A receber - A pagar)", resultado, ""],
    tipo: "acento",
    cor: resultado >= 0 ? XLSX_CORES.verde : XLSX_CORES.vermelho,
  });

  const wsResumo = montarTabelaXlsx(XLSX, {
    titulo: "Fluxo de Caixa — Resumo",
    subtitulo: periodo,
    cabecalho: ["Relação", "Total (R$)", "Qtd. títulos"],
    linhas: resumoLinhas,
    larguras: [32, 20, 14],
    alinhamentos: ["left", "right", "center"],
    colunaMoeda: 1,
    colunaInteiro: 2,
  });

  // Nota do calculo do Resultado + rodape com a data/hora de geracao
  const linhaNota = 4 + resumoLinhas.length + 1;
  const linhaGerado = linhaNota + 2;
  const enderecoNota = XLSX.utils.encode_cell({ r: linhaNota - 1, c: 0 });
  wsResumo[enderecoNota] = {
    v: "Resultado = A Receber − A Pagar (Faturamento e Pagos não entram no cálculo)",
    t: "s",
    s: { font: { name: "Calibri", sz: 9, italic: true, color: { rgb: XLSX_CORES.subtitulo } } },
  };
  wsResumo["!merges"].push({ s: { r: linhaNota - 1, c: 0 }, e: { r: linhaNota - 1, c: 2 } });

  const enderecoGerado = XLSX.utils.encode_cell({ r: linhaGerado - 1, c: 0 });
  wsResumo[enderecoGerado] = {
    v: `Gerado em ${new Date().toLocaleString("pt-BR")}`,
    t: "s",
    s: { font: { name: "Calibri", sz: 9, italic: true, color: { rgb: XLSX_CORES.subtitulo } } },
  };
  wsResumo["!merges"].push({ s: { r: linhaGerado - 1, c: 0 }, e: { r: linhaGerado - 1, c: 2 } });
  wsResumo["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: linhaGerado - 1, c: 2 } });
  XLSX.utils.book_append_sheet(wb, wsResumo, "Resumo");

  // ---------------- Aba Faturamento ----------------
  const linhasFat: LinhaXlsx[] = [];
  for (const d of fat.porDia) {
    const clientes = d.clientes ?? [];
    if (clientes.length === 0) {
      linhasFat.push({ valores: [formatarDataBR(d.data), "", Number(d.total) || 0] });
      continue;
    }
    for (const c of clientes) {
      linhasFat.push({ valores: [formatarDataBR(d.data), c.nome, Number(c.total) || 0] });
    }
    linhasFat.push({
      valores: [formatarDataBR(d.data), "Total do dia", Number(d.total) || 0],
      tipo: "total-dia",
    });
  }

  const wsFat = montarTabelaXlsx(XLSX, {
    titulo: "Faturamento",
    subtitulo: periodo,
    corTitulo: XLSX_CORES.verde,
    cabecalho: ["Data", "Cliente", "Faturamento (R$)"],
    linhas: linhasFat,
    total: ["", "TOTAL", fat.total],
    larguras: [14, 42, 20],
    alinhamentos: ["center", "left", "right"],
    colunaMoeda: 2,
    autofiltro: true,
  });
  XLSX.utils.book_append_sheet(wb, wsFat, "Faturamento");

  // ---------------- Abas das listas ----------------
  const abas: { nome: string; linhasCongeladas: number; cor?: string }[] = [
    { nome: "Resumo", linhasCongeladas: 4, cor: XLSX_CORES.cabecalho },
    { nome: "Faturamento", linhasCongeladas: 4, cor: XLSX_CORES.verde },
  ];

  for (const item of ROTULOS) {
    const lista = ordenarTitulosRelatorio(rel[item.chave]);
    const total = lista.reduce((s, t) => s + (Number(t.valor) || 0), 0);
    const linhas: LinhaXlsx[] = lista.map((t) => ({
      valores: [
        formatarDataBR(t.data),
        tituloDaLinha(t),
        subtituloDaLinha(t),
        t.categoria || "",
        t.empresa || "",
        t.metodo || "",
        Number(t.valor) || 0,
      ],
    }));

    const ws = montarTabelaXlsx(XLSX, {
      titulo: item.titulo,
      subtitulo: periodo,
      corTitulo: xlsxHex(item.cor),
      cabecalho: ["Data", "Descrição", item.rotuloTerceiro, "Categoria", "Empresa", "Método", "Valor (R$)"],
      linhas,
      total: ["", "TOTAL", "", "", "", "", total],
      larguras: [12, 46, 30, 26, 22, 16, 18],
      alinhamentos: ["center", "left", "left", "left", "left", "center", "right"],
      colunasQuebra: [1, 3],
      colunaMoeda: 6,
      autofiltro: true,
    });
    XLSX.utils.book_append_sheet(wb, ws, item.titulo);
    abas.push({ nome: item.titulo, linhasCongeladas: 4, cor: xlsxHex(item.cor) });
  }

  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return finalizarXlsx(buf, abas);
}

export async function exportarXlsx(rel: RelatorioListas) {
  const bytes = await construirXlsx(rel);
  const nome = `${nomeDoArquivo(rel)}.xlsx`;

  if (typeof document !== "undefined") {
    const blob = new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = nome;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return;
  }

  // Fora do navegador (ex.: testes locais): grava o arquivo no disco
  const fs: any = await import(/* @vite-ignore */ "node:fs");
  const escrever = fs.writeFileSync ?? fs.default?.writeFileSync;
  escrever(nome, bytes);
}

// ------------------------------- PDF -------------------------------

// ------------------- Separacao por empresa (visao "Todas") -------------------
// O Faturamento vem da planilha e ja carrega a chave da empresa dona da
// carga ("dono": JUVENAL / ROSANGELA / ALVARENGA / OUTROS). As listas de
// titulos vem com o nome da empresa CADASTRADA (ex.: "Juvenal Transportes").
// As duas pontas sao reconciliadas pela mesma regra de prefixo usada no
// filtro da planilha (filtroDaEmpresa em planilha.server.ts).

const CHAVES_EMPRESA_FATURAMENTO = ["JUVENAL", "ROSANGELA", "ALVARENGA"] as const;

// Nome amigavel das chaves que nao tem empresa cadastrada (so aparecem no Faturamento).
const ROTULO_EMPRESA: Record<string, string> = {
  JUVENAL: "Juvenal",
  ROSANGELA: "Rosângela",
  ALVARENGA: "Alvarenga",
  OUTROS: "Outros",
};

// Chave de agrupamento de uma empresa (sem acento, sem caixa, sem espacos duplos).
function chaveEmpresa(nome: string): string {
  const n = (nome || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
  for (const chave of CHAVES_EMPRESA_FATURAMENTO) {
    if (n.startsWith(chave)) return chave;
  }
  return n || "OUTROS";
}

type GrupoEmpresa = {
  chave: string;
  nome: string;
  faturamento: FaturamentoExport;
  recebidas: LinhaExport[];
  pagos: LinhaExport[];
};

// Separa o relatorio por empresa: cada grupo leva o Faturamento da empresa
// (agrupado pela chave do "dono") e as listas de titulos (pelo campo `empresa`).
function agruparPorEmpresa(rel: RelatorioListas): GrupoEmpresa[] {
  const fat = rel.faturamento ?? { total: 0, porDia: [] };
  const grupos = new Map<string, GrupoEmpresa>();

  const grupo = (chave: string): GrupoEmpresa => {
    let g = grupos.get(chave);
    if (!g) {
      g = {
        chave,
        nome: ROTULO_EMPRESA[chave] || chave,
        faturamento: { total: 0, porDia: [] },
        recebidas: [],
        pagos: [],
      };
      grupos.set(chave, g);
    }
    return g;
  };

  // 1) Faturamento: cada dia pode ter clientes de empresas diferentes —
  //    o dia e replicado em cada empresa com o total so dela.
  for (const d of fat.porDia) {
    const porEmpresa = new Map<string, { nome: string; total: number }[]>();
    for (const c of d.clientes ?? []) {
      const chave = chaveEmpresa(c.empresa || "OUTROS");
      const lista = porEmpresa.get(chave) ?? [];
      lista.push({ nome: c.nome, total: c.total });
      porEmpresa.set(chave, lista);
    }
    for (const [chave, clientes] of porEmpresa) {
      const g = grupo(chave);
      const totalDia = clientes.reduce((s, c) => s + (Number(c.total) || 0), 0);
      g.faturamento.porDia.push({ data: d.data, total: totalDia, clientes });
      g.faturamento.total += totalDia;
    }
  }

  // 2) Listas de titulos: cada linha ja vem com a empresa.
  for (const t of rel.recebidas ?? []) grupo(chaveEmpresa(t.empresa || "")).recebidas.push(t);
  for (const t of rel.pagos ?? []) grupo(chaveEmpresa(t.empresa || "")).pagos.push(t);

  // 3) Nome de exibicao: o nome cadastrado quando existir (ex.: "Juvenal
  //    Transportes"), senao o nome amigavel da chave (ex.: "Alvarenga").
  for (const g of grupos.values()) {
    const nomeReal = [...g.recebidas, ...g.pagos].find((t) => t.empresa)?.empresa;
    if (nomeReal) g.nome = nomeReal;
  }

  const lista = [...grupos.values()];
  for (const g of lista) {
    g.faturamento.total = Math.round(g.faturamento.total * 100) / 100;
  }
  // Ordem alfabetica das empresas no relatorio.
  lista.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  return lista;
}

export async function exportarPdf(rel: RelatorioListas) {
  const { jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const largura = doc.internal.pageSize.getWidth();
  const altura = doc.internal.pageSize.getHeight();
  const margem = 14;

  // Cabecalho
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Fluxo de Caixa", margem, 16);

  // Periodo / empresa
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(
    `Período: ${formatarDataBR(rel.dataInicio)} a ${formatarDataBR(rel.dataFim)}    |    Empresa: ${
      rel.empresa === "todas" ? "Todas as Empresas" : rel.empresa
    }`,
    margem,
    23,
  );
  doc.setTextColor(0);

  // ---- Cards de totais no topo (so as secoes que entram no PDF) ----
  const fat = rel.faturamento ?? { total: 0, porDia: [] };
  const cards: { rotulo: string; valor: number; cor: [number, number, number] }[] = [
    { rotulo: "Faturamento", valor: fat.total, cor: [22, 163, 74] },
    ...ROTULOS_PDF.map((item) => ({
      rotulo: item.titulo,
      valor: ordenarTitulos(rel[item.chave]).reduce((s, t) => s + (Number(t.valor) || 0), 0),
      cor: item.cor,
    })),
  ];

  const alturaCard = 17;
  const gapCard = 4;
  const larguraCard = (largura - margem * 2 - gapCard * (cards.length - 1)) / cards.length;
  const yCard = 34;
  let xCard = margem;
  for (const c of cards) {
    // Fundo claro com moldura na cor da relacao
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(...c.cor);
    doc.setLineWidth(0.6);
    doc.rect(xCard, yCard, larguraCard, alturaCard, "FD");

    // Rotulo pequeno em cima
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(110);
    doc.text(c.rotulo, xCard + 3, yCard + 6);

    // Valor em negrito (fonte encolhe se nao couber no card)
    const valorTxt = formatarValor(c.valor);
    let fs = 12;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(fs);
    while (fs > 7 && doc.getTextWidth(valorTxt) > larguraCard - 6) {
      fs -= 0.5;
      doc.setFontSize(fs);
    }
    doc.setTextColor(30);
    doc.text(valorTxt, xCard + 3, yCard + 14);

    xCard += larguraCard + gapCard;
  }
  doc.setDrawColor(0);
  doc.setTextColor(0);

  let y = yCard + alturaCard + 10;

  // ---------------------------------------------------------------------
  // Desenho das secoes (faixa colorida + tabela). Cada funcao devolve a nova
  // posicao vertical (y) depois da tabela.
  // ---------------------------------------------------------------------
  type LinhaFat = { data: string; cliente: string; valor: string; ehTotalDia: boolean };

  const secaoFaturamento = (f: FaturamentoExport, yIni: number): number => {
    let y = yIni;
    doc.setFillColor(22, 163, 74);
    doc.rect(margem, y - 4.5, largura - margem * 2, 8, "F");
    doc.setTextColor(255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(`Faturamento — ${formatarValor(f.total)}`, margem + 4, y + 1);
    doc.setTextColor(0);
    y += 8;

    // Linhas: uma por cliente (remetente) em cada dia + linha "Total do dia".
    const linhasFat: LinhaFat[] = [];
    for (const d of f.porDia) {
      const clientes = d.clientes ?? [];
      if (clientes.length === 0) {
        linhasFat.push({ data: formatarDataBR(d.data), cliente: "", valor: formatarValor(d.total), ehTotalDia: false });
        continue;
      }
      for (const c of clientes) {
        linhasFat.push({ data: formatarDataBR(d.data), cliente: c.nome, valor: formatarValor(c.total), ehTotalDia: false });
      }
      linhasFat.push({
        data: formatarDataBR(d.data),
        cliente: "Total do dia",
        valor: formatarValor(d.total),
        ehTotalDia: true,
      });
    }

    autoTable(doc, {
      startY: y,
      head: [["Data", "Cliente", "Faturamento (R$)"]],
      body: linhasFat.map((l) => [l.data, l.cliente, l.valor]),
      foot: [["", "TOTAL", formatarValor(f.total)]],
      theme: "grid",
      styles: { fontSize: 8, cellPadding: 2, overflow: "linebreak" },
      headStyles: { fillColor: [60, 60, 60], textColor: 255, fontStyle: "bold" },
      footStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: "bold" },
      // Linha de total do dia em negrito e com fundo claro
      didParseCell: (data: any) => {
        if (data.section === "body" && linhasFat[data.row.index]?.ehTotalDia) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = [240, 240, 240];
        }
      },
      columnStyles: {
        0: { maxWidth: 24 },
        1: { maxWidth: 60 },
        2: { maxWidth: 30, halign: "right" },
      } as any,
      margin: { top: 30, bottom: 16, left: margem, right: margem },
    });

    // Posicao final da tabela do Faturamento (o autoTable ja pagina sozinho
    // quando o conteudo nao cabe).
    return ((doc as any).lastAutoTable?.finalY ?? y + 30) + 14;
  };

  const secaoTitulos = (
    item: (typeof ROTULOS_PDF)[number],
    listaBruta: LinhaExport[],
    yIni: number,
  ): number => {
    let y = yIni;
    const lista = ordenarTitulosRelatorio(listaBruta);
    const total = lista.reduce((s, t) => s + (Number(t.valor) || 0), 0);

    // Faixa colorida do titulo da secao
    doc.setFillColor(...item.cor);
    doc.rect(margem, y - 4.5, largura - margem * 2, 8, "F");
    doc.setTextColor(255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(`${item.titulo} — ${formatarValor(total)}`, margem + 4, y + 1);
    doc.setTextColor(0);
    y += 8;

    // Sem "Categoria" e sem "Empresa" no PDF impresso: o relatorio ja sai
    // separado por empresa (cada bloco e de uma empresa) e a Categoria
    // continua apenas no XLSX. A coluna "Metodo" so aparece se a lista tiver
    // algum metodo preenchido (nos Pagos/Recebidos ela e sempre vazia).
    const temMetodo = lista.some((t) => !!t.metodo);
    const head = temMetodo
      ? [["Data", "Descrição", item.rotuloTerceiro, "Método", "Valor (R$)"]]
      : [["Data", "Descrição", item.rotuloTerceiro, "Valor (R$)"]];
    const body = lista.map((t) => {
      const base = [formatarDataBR(t.data), tituloDaLinha(t), subtituloDaLinha(t)];
      return temMetodo
        ? [...base, t.metodo || "", formatarValor(t.valor)]
        : [...base, formatarValor(t.valor)];
    });
    const foot = [
      ["", "TOTAL", ...(temMetodo ? ["", ""] : [""]), formatarValor(total)],
    ];
    // Larguras automaticas com teto de quebra do texto (evita estourar a pagina).
    // "maxWidth" existe no runtime do jspdf-autotable, mas nao nos tipos da v5.
    const columnStyles = temMetodo
      ? ({
          0: { maxWidth: 18 },
          1: { maxWidth: 60 },
          2: { maxWidth: 46 },
          3: { maxWidth: 24 },
          4: { maxWidth: 30, halign: "right" },
        } as any)
      : ({
          0: { maxWidth: 18 },
          1: { maxWidth: 64 },
          2: { maxWidth: 50 },
          3: { maxWidth: 32, halign: "right" },
        } as any);

    autoTable(doc, {
      startY: y,
      head,
      body,
      foot,
      theme: "grid",
      styles: { fontSize: 8, cellPadding: 2, overflow: "linebreak" },
      headStyles: { fillColor: [60, 60, 60], textColor: 255, fontStyle: "bold" },
      footStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: "bold" },
      columnStyles,
      margin: { top: 30, bottom: 16, left: margem, right: margem },
    });

    // Posicao final da tabela (o autoTable ja pagina sozinho quando precisa)
    return ((doc as any).lastAutoTable?.finalY ?? y + 30) + 14;
  };

  // Garante espaco para a faixa + um pedaco da tabela; se nao couber, abre
  // uma pagina nova (usado no modo "por empresa", em que as secoes fluem).
  const garantirEspaco = (yAtual: number, minimo = 42): number => {
    if (altura - margem - yAtual < minimo) {
      doc.addPage();
      return 24;
    }
    return yAtual;
  };

  // No PDF impresso entram apenas "Recebidos" e "Pagos" (nenhuma lista de
  // "A Receber"/"A Pagar" e nenhum card de Resultado).
  if (rel.empresa === "todas") {
    // -------------------------------------------------------------------
    // Visao "Todas": um BLOCO por empresa. Cada empresa comeca numa pagina
    // nova (a primeira continua na pagina 1, logo apos os cards) e as
    // secoes dela FLUEM: Faturamento, Recebidos e Pagos ficam na mesma
    // folha enquanto ainda houver espaco.
    // -------------------------------------------------------------------
    const grupos = agruparPorEmpresa(rel);
    for (let i = 0; i < grupos.length; i++) {
      const g = grupos[i];
      if (i > 0) {
        doc.addPage();
        y = 24;
      }

      // Faixa da empresa: nome + resumo dos totais dela
      const totalRecebidas = g.recebidas.reduce((s, t) => s + (Number(t.valor) || 0), 0);
      const totalPagos = g.pagos.reduce((s, t) => s + (Number(t.valor) || 0), 0);
      const resumo = [
        `Faturamento ${formatarValor(g.faturamento.total)}`,
        `Recebidos ${formatarValor(totalRecebidas)}`,
        `Pagos ${formatarValor(totalPagos)}`,
      ].join("     ");
      doc.setFillColor(15, 23, 42);
      doc.rect(margem, y - 5, largura - margem * 2, 9, "F");
      doc.setTextColor(255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text(g.nome, margem + 4, y + 1);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(203, 213, 225);
      doc.text(resumo, largura - margem - 4, y + 1, { align: "right" });
      doc.setTextColor(0);
      y += 10;

      // Secoes da empresa (fluem na mesma pagina enquanto houver espaco)
      if (g.faturamento.porDia.length > 0) {
        y = garantirEspaco(y);
        y = secaoFaturamento(g.faturamento, y);
      }
      for (const item of ROTULOS_PDF) {
        const lista = item.chave === "recebidas" ? g.recebidas : g.pagos;
        if (lista.length === 0) continue;
        y = garantirEspaco(y);
        y = secaoTitulos(item, lista, y);
      }
    }
  } else {
    // -------------------------------------------------------------------
    // Empresa unica: paginacao fixa (Faturamento na MESMA pagina do
    // cabecalho/cards; cada secao seguinte numa PAGINA NOVA).
    // -------------------------------------------------------------------
    if (fat.porDia.length > 0) {
      y = secaoFaturamento(fat, y);
    }

    for (const item of ROTULOS_PDF) {
      const lista = rel[item.chave] ?? [];
      // Cada seção de títulos começa em uma PÁGINA NOVA, imediatamente após o
      // fim da seção anterior (Recebidos -> Pagos).
      doc.addPage();
      y = 24;
      y = secaoTitulos(item, lista, y);
    }
  }

  // Rodape com paginacao
  const paginas = doc.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(130);
    doc.text(
      `Gerado em ${new Date().toLocaleString("pt-BR")}    |    Página ${i} de ${paginas}`,
      largura - margem,
      altura - 8,
      { align: "right" },
    );
  }

  doc.save(`${nomeDoArquivo(rel)}.pdf`);
}
