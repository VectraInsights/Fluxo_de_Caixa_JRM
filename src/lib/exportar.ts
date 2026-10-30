// Exportacao das listas de titulos (A Receber, A Pagar, Pagos) para PDF e XLSX.
// Tudo roda no navegador: as libs sao carregadas sob demanda (import dinamico),
// para nao pesar no bundle inicial nem quebrar o SSR.

import type { TituloDetalhe } from "./contaazul.functions";

export type LinhaExport = TituloDetalhe & { empresa?: string };

export type FaturamentoExport = {
  total: number;
  porDia: { data: string; total: number }[];
};

export type RelatorioListas = {
  empresa: string;
  dataInicio: string;
  dataFim: string;
  receber: LinhaExport[];
  pagar: LinhaExport[];
  pagos: LinhaExport[];
  faturamento: FaturamentoExport;
};

const ROTULOS: {
  chave: "receber" | "pagar" | "pagos";
  titulo: string;
  cor: [number, number, number];
  // Rotulo da coluna de terceiro: quem paga/recebe em "A Receber" e quem
  // recebe/paga nas demais listas.
  rotuloTerceiro: string;
}[] = [
  { chave: "receber", titulo: "A Receber", cor: [22, 163, 74], rotuloTerceiro: "Cliente" },
  { chave: "pagar", titulo: "A Pagar", cor: [220, 38, 38], rotuloTerceiro: "Fornecedor" },
  { chave: "pagos", titulo: "Pagos", cor: [220, 38, 38], rotuloTerceiro: "Fornecedor" },
];

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

// Ordenacao usada na tela e na exportacao:
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

function nomeDoArquivo(rel: RelatorioListas): string {
  const empresa = rel.empresa === "todas" ? "todas" : rel.empresa.replace(/[^\w\-]+/g, "_");
  return `fluxo-caixa_${empresa}_${rel.dataInicio}_${rel.dataFim}`;
}

// ------------------------------- XLSX -------------------------------

export async function exportarXlsx(rel: RelatorioListas) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();

  // Aba de resumo com os totais (Faturamento primeiro, na mesma ordem dos cards)
  const resumo: (string | number)[][] = [["Relação", "Total (R$)", "Qtd. títulos"]];
  const fat = rel.faturamento ?? { total: 0, porDia: [] };
  resumo.push(["Faturamento", fat.total, fat.porDia.filter((d) => d.total !== 0).length]);
  for (const item of ROTULOS) {
    const lista = ordenarTitulos(rel[item.chave]);
    const total = lista.reduce((s, t) => s + (Number(t.valor) || 0), 0);
    resumo.push([item.titulo, total, lista.length]);
  }
  const wsResumo = XLSX.utils.aoa_to_sheet(resumo);
  wsResumo["!cols"] = [{ wch: 18 }, { wch: 18 }, { wch: 14 }];
  for (let i = 1; i < resumo.length; i++) {
    const addr = XLSX.utils.encode_cell({ r: i, c: 1 });
    if (wsResumo[addr]) wsResumo[addr].z = 'R$ #,##0.00';
  }
  XLSX.utils.book_append_sheet(wb, wsResumo, "Resumo");

  // Aba de faturamento por dia (uma linha por dia do periodo)
  {
    const aoa: (string | number)[][] = [["Data", "Faturamento (R$)"]];
    for (const d of fat.porDia) aoa.push([formatarDataBR(d.data), Number(d.total) || 0]);
    aoa.push(["TOTAL", fat.total]);

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 14 }, { wch: 20 }];
    for (let i = 1; i < aoa.length; i++) {
      const addr = XLSX.utils.encode_cell({ r: i, c: 1 });
      if (ws[addr]) ws[addr].z = 'R$ #,##0.00';
    }
    XLSX.utils.book_append_sheet(wb, ws, "Faturamento");
  }

  // Uma aba por lista
  for (const item of ROTULOS) {
    const lista = ordenarTitulos(rel[item.chave]);
    const aoa: (string | number)[][] = [
      ["Data", "Descrição", item.rotuloTerceiro, "Empresa", "Método", "Valor (R$)"],
    ];
    for (const t of lista) {
      aoa.push([
        formatarDataBR(t.data),
        tituloDaLinha(t),
        subtituloDaLinha(t),
        t.empresa || "",
        t.metodo || "",
        Number(t.valor) || 0,
      ]);
    }
    aoa.push(["", "TOTAL", "", "", "", lista.reduce((s, t) => s + (Number(t.valor) || 0), 0)]);

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [
      { wch: 12 },
      { wch: 48 },
      { wch: 30 },
      { wch: 22 },
      { wch: 16 },
      { wch: 16 },
    ];
    // Formata a coluna de valor como moeda
    for (let i = 1; i < aoa.length; i++) {
      const addr = XLSX.utils.encode_cell({ r: i, c: 5 });
      if (ws[addr]) ws[addr].z = 'R$ #,##0.00';
    }
    XLSX.utils.book_append_sheet(wb, ws, item.titulo);
  }

  XLSX.writeFile(wb, `${nomeDoArquivo(rel)}.xlsx`);
}

// ------------------------------- PDF -------------------------------

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
  doc.text("Fluxo de Caixa — Faturamento, A Receber, A Pagar e Pagos", margem, 16);
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

  // ---- Cards de totais no topo (mesma ordem das secoes do relatorio) ----
  const fat = rel.faturamento ?? { total: 0, porDia: [] };
  const cards: { rotulo: string; valor: number; cor: [number, number, number] }[] = [
    { rotulo: "Faturamento", valor: fat.total, cor: [22, 163, 74] },
    ...ROTULOS.map((item) => ({
      rotulo: item.titulo,
      valor: ordenarTitulos(rel[item.chave]).reduce((s, t) => s + (Number(t.valor) || 0), 0),
      cor: item.cor,
    })),
  ];

  const alturaCard = 17;
  const gapCard = 4;
  const larguraCard = (largura - margem * 2 - gapCard * (cards.length - 1)) / cards.length;
  const yCard = 30;
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

  // Seção Faturamento (planilha de cargas), antes das listas de títulos
  if (fat.porDia.length > 0) {
    if (altura - margem - y < 45) {
      doc.addPage();
      y = 24;
    }

    doc.setFillColor(22, 163, 74);
    doc.rect(margem, y - 4.5, largura - margem * 2, 8, "F");
    doc.setTextColor(255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(`Faturamento — ${formatarValor(fat.total)}`, margem + 4, y + 1);
    doc.setTextColor(0);
    y += 8;

    autoTable(doc, {
      startY: y,
      head: [["Data", "Faturamento (R$)"]],
      body: fat.porDia.map((d) => [formatarDataBR(d.data), formatarValor(d.total)]),
      foot: [["TOTAL", formatarValor(fat.total)]],
      theme: "grid",
      styles: { fontSize: 8, cellPadding: 2, overflow: "linebreak" },
      headStyles: { fillColor: [60, 60, 60], textColor: 255, fontStyle: "bold" },
      footStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: "bold" },
      columnStyles: {
        0: { maxWidth: 24 },
        1: { maxWidth: 30, halign: "right" },
      } as any,
      margin: { top: 30, bottom: 16, left: margem, right: margem },
    });

    y = ((doc as any).lastAutoTable?.finalY ?? y + 30) + 14;
  }

  for (const item of ROTULOS) {
    const lista = ordenarTitulos(rel[item.chave]);
    const total = lista.reduce((s, t) => s + (Number(t.valor) || 0), 0);

    // Sem espaco para o titulo + algumas linhas: quebra a pagina
    if (altura - margem - y < 45) {
      doc.addPage();
      y = 24;
    }

    // Faixa colorida do titulo da secao
    doc.setFillColor(...item.cor);
    doc.rect(margem, y - 4.5, largura - margem * 2, 8, "F");
    doc.setTextColor(255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(`${item.titulo} — ${formatarValor(total)}`, margem + 4, y + 1);
    doc.setTextColor(0);
    y += 8;

    autoTable(doc, {
      startY: y,
      head: [["Data", "Descrição", item.rotuloTerceiro, "Empresa", "Método", "Valor (R$)"]],
      body: lista.map((t) => [
        formatarDataBR(t.data),
        tituloDaLinha(t),
        subtituloDaLinha(t),
        t.empresa || "",
        t.metodo || "",
        formatarValor(t.valor),
      ]),
      foot: [["", "TOTAL", "", "", "", formatarValor(total)]],
      theme: "grid",
      styles: { fontSize: 8, cellPadding: 2, overflow: "linebreak" },
      headStyles: { fillColor: [60, 60, 60], textColor: 255, fontStyle: "bold" },
      footStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: "bold" },
      // Larguras automaticas com teto de quebra do texto (evita estourar a pagina).
      // "maxWidth" existe no runtime do jspdf-autotable, mas nao nos tipos da v5.
      columnStyles: {
        0: { maxWidth: 20 },
        1: { maxWidth: 78 },
        2: { maxWidth: 52 },
        3: { maxWidth: 42 },
        4: { maxWidth: 24 },
        5: { maxWidth: 30, halign: "right" },
      } as any,
      margin: { top: 30, bottom: 16, left: margem, right: margem },
    });

    // Posicao final da tabela (o autoTable ja pagina sozinho quando precisa)
    y = ((doc as any).lastAutoTable?.finalY ?? y + 30) + 14;
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
