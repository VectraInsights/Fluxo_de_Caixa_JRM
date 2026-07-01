import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  ComposedChart,
  Bar,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  Moon,
  Sun,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Wallet,
  TrendingUp,
  TrendingDown,
  Sparkles,
  RefreshCw,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  Barcode,
} from "lucide-react";
import {
  listarEmpresas,
  getDashboard,
  limparCache,
} from "@/lib/contaazul.functions";
import { useQueryClient } from "@tanstack/react-query";
// using public SVG logo
const logo = "/jrm-icone.svg";
import logoBradesco from "@/assets/bradesco.png";
import logoItau from "@/assets/itau.png";
import logoSicoob from "@/assets/sicoob.png";


export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Fluxo de Caixa - JRM Gestão" },
      { name: "description", content: "Dashboard de fluxo de caixa multi-empresa integrado à Conta Azul." },
      { property: "og:title", content: "Fluxo de Caixa - JRM Gestão" },
      { property: "og:description", content: "Dashboard de fluxo de caixa multi-empresa integrado à Conta Azul." },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "icon", href: "/jrm-icone.svg" }],
  }),
  component: Dashboard,
});

const fmt = (v: number) =>
  (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtCompact = (v: number) =>
  Number(v).toLocaleString("pt-BR", { notation: "compact", compactDisplay: "short" });

function todayLocalISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const tz = d.getTimezoneOffset();
  return new Date(d.getTime() - tz * 60000).toISOString().slice(0, 10);
}


function Dashboard() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [empresa, setEmpresa] = useState("todas");
  const [intervalo, setIntervalo] = useState("7");

  // Estados "ativos" — usados na query (só mudam ao clicar Recarregar ou trocar intervalo predefinido)
  const [dataInicio, setDataInicio] = useState(todayLocalISO(0));
  const [dataFim, setDataFim] = useState(todayLocalISO(7));

  // Estados "pendentes" — vinculados aos inputs de data no modo personalizado
  const [pendingInicio, setPendingInicio] = useState(todayLocalISO(0));
  const [pendingFim, setPendingFim] = useState(todayLocalISO(7));

    useEffect(() => {
    const saved = localStorage.getItem("theme");
    if (saved === "light") setTheme("light");
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    if (intervalo === "personalizado") return;
    const dias = parseInt(intervalo);
    const inicio = todayLocalISO(0);
    const fim = todayLocalISO(dias);
    setDataInicio(inicio);
    setDataFim(fim);
    setPendingInicio(inicio);
    setPendingFim(fim);
  }, [intervalo]);

  // Fecha sidebar automaticamente em telas pequenas ao iniciar
  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setSidebarOpen(false);
    }
  }, []);

  const listarEmpresasFn = useServerFn(listarEmpresas);
  const getDashboardFn = useServerFn(getDashboard);
  const limparCacheFn = useServerFn(limparCache);
  const queryClient = useQueryClient();

  const { data: empresas = [], refetch: refetchEmpresas } = useQuery({
    queryKey: ["empresas"],
    queryFn: () => listarEmpresasFn(),
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const {
    data,
    isFetching,
    refetch,
    dataUpdatedAt,
    isError,
    error,
  } = useQuery({
    queryKey: ["dashboard", empresa, dataInicio, dataFim],
    queryFn: () => getDashboardFn({ data: { empresa, data_inicio: dataInicio, data_fim: dataFim } }),
    enabled: !!dataInicio && !!dataFim,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  async function recarregarTudo() {
    // 1. Limpa o cache no servidor
    await limparCacheFn();

    // 2. Se os inputs de data pendentes mudaram, atualizamos os estados ativos.
    // Isso mudará a queryKey do useQuery, que disparará a busca automaticamente.
    if (dataInicio !== pendingInicio || dataFim !== pendingFim) {
      setDataInicio(pendingInicio);
      setDataFim(pendingFim);
    } else {
      // 3. Se as datas são as mesmas, apenas forçamos o refetch da query ativa
      refetch();
    }
    
    // 4. Refresca a lista de empresas
    refetchEmpresas();
  }


  const bancosPermitidos = ["ITAU", "SICOOB", "BRADESCO"];
  const bancosFiltrados = useMemo(() => {
    const bancos = data?.saldos_por_banco || [];
    const vistos = new Set<string>();
    return bancos
      .filter((b) => {
        const nu = (b.nome || "").toUpperCase();
        const ok = bancosPermitidos.some((p) => nu.includes(p));
        if (!ok || vistos.has(nu) || Math.abs(b.saldo) < 0.01) return false;
        vistos.add(nu);
        return true;
      })
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }, [data]);

  const saldoAtual = bancosFiltrados.reduce((acc, b) => acc + b.saldo, 0);
  const totalSaldoBancos = bancosFiltrados.reduce((sum, b) => sum + Math.max(b.saldo, 0), 0);
  const totalRec = data?.resumo.total_rec || 0;
  const totalRecBoleto = data?.resumo.total_rec_boleto || 0;
  const totalRecOutros = Math.max(0, totalRec - totalRecBoleto);
  const totalDesp = Math.abs(data?.resumo.total_desp || 0);
  const saldoPrevisto = saldoAtual + totalRec - totalDesp;
  const positivo = saldoPrevisto >= saldoAtual;

  const chartData = useMemo(() => {
    if (!data) return [];
    return data.labels.map((l, i) => ({
      label: l,
      receitas: data.receitas[i],
      despesas: -Math.abs(data.despesas[i]),
      saldo: data.saldo[i],
    }));
  }, [data]);



  return (
    <div className="min-h-screen w-full bg-background text-foreground font-sans relative overflow-hidden">
      {/* Background ambient glow */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -top-40 -right-40 h-[500px] w-[500px] rounded-full bg-brand/20 blur-[120px]" />
        <div className="absolute top-1/2 -left-40 h-[400px] w-[400px] rounded-full bg-brand-2/15 blur-[120px]" />
      </div>

      {isFetching && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-background/60 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-10 w-10 animate-spin text-brand" />
            <span className="text-sm text-muted-foreground">Sincronizando...</span>
          </div>
        </div>
      )}

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed left-0 top-0 z-40 h-screen w-[280px] border-r border-border bg-sidebar/80 backdrop-blur-xl p-6 flex flex-col overflow-y-auto transition-transform duration-300 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-3 mb-8">
            <div className="relative">
            <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-brand to-brand-2 blur-md opacity-60" />
            <img src="/jrm-icone.svg" alt="JRM" className="relative h-10 w-10 rounded-xl" />
          </div>
          <div>
            <div className="font-display font-bold text-lg leading-none">JRM</div>
            <div className="text-xs text-muted-foreground">Gestão Financeira</div>
          </div>
        </div>

        <SectionLabel>Filtros</SectionLabel>

        <Label>Empresa</Label>
        <Select
          value={empresa}
          onChange={(e) => {
            setEmpresa(e.target.value);
            if (typeof window !== "undefined" && window.innerWidth < 768) setSidebarOpen(false);
          }}
        >
          <option value="todas">Todas as Empresas</option>
          {empresas.map((e) => (
            <option key={e.nome} value={e.nome}>
              {e.nome}
              {e.status === "ERRO" ? " ⚠" : ""}
            </option>
          ))}
        </Select>

        <Label>Intervalo de Projeção</Label>
        <Select value={intervalo} onChange={(e) => setIntervalo(e.target.value)}>
          <option value="0">Hoje</option>
          <option value="7">Próximos 7 dias</option>
          <option value="15">Próximos 15 dias</option>
          <option value="30">Próximos 30 dias</option>
          <option value="personalizado">Personalizado</option>
        </Select>

        {intervalo === "personalizado" && (
          <>
            <Label>Início</Label>
            <Input type="date" value={pendingInicio} onChange={(e) => setPendingInicio(e.target.value)} />
            <Label>Fim</Label>
            <Input type="date" value={pendingFim} onChange={(e) => setPendingFim(e.target.value)} />
            <p className="text-[10px] text-muted-foreground mt-1 mb-2">Clique em Recarregar para aplicar as datas.</p>
          </>
        )}

                <SectionLabel className="mt-8">Bancos</SectionLabel>
        <div className="space-y-2">
          {bancosFiltrados.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-4">
              {isFetching ? "Carregando..." : "Aguardando sincronização..."}
            </div>
          ) : (
            bancosFiltrados.map((b) => {
              return (
                <div
                  key={b.nome}
                  className="rounded-xl border border-border/50 bg-card/50 p-3 hover:border-brand/30 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <BankAvatar nome={b.nome} />
                    <div className="text-xs font-medium flex-1 min-w-0 truncate" title={b.nome}>
                      {b.nome}
                    </div>
                    <div
                      className={`text-xs font-semibold tabular-nums shrink-0 ${
                        b.saldo < 0 ? "text-destructive" : ""
                      }`}
                    >
                      {fmt(b.saldo)}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* Sidebar toggle */}
      <button
        onClick={() => setSidebarOpen((o) => !o)}
        className={`fixed top-6 z-50 rounded-full border border-border bg-card/80 backdrop-blur p-2 text-foreground/70 hover:text-foreground hover:border-brand/40 transition-all ${
          sidebarOpen ? "left-[268px]" : "left-4"
        }`}
      >
        {sidebarOpen ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>

      {/* Main */}
      <main
        className={`min-h-screen transition-[margin] duration-300 ${
          sidebarOpen ? "ml-[280px]" : "ml-0"
        }`}
      >
        <div className="mx-auto max-w-[1400px] p-6 lg:p-10">
          {/* Header */}
          <div className="flex items-start justify-between mb-8 gap-4 flex-wrap">
            <div className="pl-12 lg:pl-0">
              <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground mb-2">
                <Sparkles className="h-3 w-3 text-brand" />
                Visão Geral
              </div>
              <h1 className="font-display text-3xl lg:text-4xl font-bold tracking-tight">
                Fluxo de Caixa
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Projeção de {dataInicio.split("-").reverse().join("/")} até{" "}
                {dataFim.split("-").reverse().join("/")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={recarregarTudo}
                disabled={isFetching}
                className="flex items-center gap-2 rounded-full border border-border bg-card/60 backdrop-blur px-4 py-2 text-xs font-semibold hover:border-brand/40 transition-colors disabled:opacity-60"
                title="Recarregar dados"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
                Recarregar
              </button>
              <button
                onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
                className="rounded-full border border-border bg-card/60 backdrop-blur p-2.5 hover:border-brand/40 transition-colors"
                title="Alternar tema"
              >
                {theme === "light" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Estado do sync (banner) */}
          <div className="mb-6 flex items-center gap-3 text-xs text-muted-foreground">
            <span className={`inline-flex h-2 w-2 rounded-full ${isError ? "bg-destructive" : isFetching ? "bg-brand animate-pulse" : "bg-success"}`} />
            <span>
              {isError
                ? `Erro: ${String((error as any)?.message || error).slice(0, 120)}`
                : isFetching
                ? "Sincronizando com a Conta Azul..."
                : `Última sincronização: ${dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString("pt-BR") : "—"}`}
            </span>
          </div>

          {/* KPI cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-5">
            {!data && isFetching ? (
              Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
            ) : (
              <>
                <KpiCard
                  label="Saldo Atual"
                  valor={saldoAtual}
                  icon={<Wallet className="h-5 w-5" />}
                  gradient="from-brand/30 via-brand/10 to-transparent"
                  accent="text-brand"
                />
                <KpiCard
                  label="Entradas Previstas"
                  valor={totalRec}
                  icon={<TrendingUp className="h-5 w-5" />}
                  gradient="from-success/30 via-success/10 to-transparent"
                  accent="text-success"
                />
                <KpiCard
                  label="Saídas Previstas"
                  valor={-totalDesp}
                  icon={<TrendingDown className="h-5 w-5" />}
                  gradient="from-destructive/30 via-destructive/10 to-transparent"
                  accent="text-destructive"
                />
                <KpiCard
                  label="Saldo Previsto"
                  valor={saldoPrevisto}
                  icon={
                    positivo ? (
                      <ArrowUpRight className="h-5 w-5" />
                    ) : (
                      <ArrowDownRight className="h-5 w-5" />
                    )
                  }
                  gradient={
                    positivo
                      ? "from-success/30 via-success/10 to-transparent"
                      : "from-destructive/30 via-destructive/10 to-transparent"
                  }
                  accent={positivo ? "text-success" : "text-destructive"}
                />
              </>
            )}
          </div>

          {/* Breakdown de recebimentos por meio de pagamento */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
            {!data && isFetching ? (
              <>
                <SkeletonCard />
                <SkeletonCard />
              </>
            ) : (
              <>
                <KpiCard
                  label="A Receber via Boleto"
                  valor={totalRecBoleto}
                  icon={<Barcode className="h-5 w-5" />}
                  gradient="from-brand-2/30 via-brand-2/10 to-transparent"
                  accent="text-brand-2"
                  sub={
                    totalRec > 0
                      ? `${((totalRecBoleto / totalRec) * 100).toFixed(1)}% do total a receber`
                      : "Sem recebimentos no período"
                  }
                />
                <KpiCard
                  label="A Receber - Outros Meios"
                  valor={totalRecOutros}
                  icon={<TrendingUp className="h-5 w-5" />}
                  gradient="from-success/30 via-success/10 to-transparent"
                  accent="text-success"
                  sub={
                    totalRec > 0
                      ? `${((totalRecOutros / totalRec) * 100).toFixed(1)}% do total a receber`
                      : "Sem recebimentos no período"
                  }
                />
              </>
            )}
          </div>





          {/* Chart */}
          <div className="relative rounded-2xl border border-border bg-card/60 backdrop-blur-xl p-6 shadow-xl overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-brand/5 via-transparent to-brand-2/5 pointer-events-none" />
            <div className="relative">
              <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
                <div>
                  <h2 className="font-display text-lg font-semibold">Projeção Diária</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Receitas, despesas e saldo acumulado
                  </p>
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <LegendDot color="var(--color-success)" label="Receitas" />
                  <LegendDot color="var(--color-destructive)" label="Despesas" />
                  <LegendDot color="var(--color-brand)" label="Saldo" line />
                </div>
              </div>

              <div className="h-[420px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} stackOffset="sign" margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gradSaldo" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-brand)" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="var(--color-brand)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--color-border)" vertical={false} strokeDasharray="3 3" />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tickFormatter={fmtCompact}
                      tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      cursor={{ fill: "var(--color-muted)", opacity: 0.3 }}
                      contentStyle={{
                        background: "var(--color-card)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 12,
                        boxShadow: "0 10px 40px rgba(0,0,0,0.3)",
                        color: "var(--color-foreground)",
                      }}
                      labelStyle={{ color: "var(--color-muted-foreground)", fontSize: 12, marginBottom: 4 }}
                      formatter={(v: number, name: string) => [fmt(v as number), name]}
                    />
                    <Bar dataKey="receitas" name="Receitas" stackId="ops" fill="var(--color-success)" radius={[6, 6, 0, 0]} maxBarSize={32} />
                    <Bar dataKey="despesas" name="Despesas" stackId="ops" fill="var(--color-destructive)" radius={[6, 6, 0, 0]} maxBarSize={32} />
                    <Area
                      type="monotone"
                      dataKey="saldo"
                      name="Saldo"
                      stroke="var(--color-brand)"
                      strokeWidth={2.5}
                      fill="url(#gradSaldo)"
                      dot={{ r: 3, fill: "var(--color-brand)", strokeWidth: 0 }}
                      activeDot={{ r: 5 }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Alerta de empresas com erro */}
          {empresas.some((e) => e.status === "ERRO") && (
            <div className="mt-6 flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4">
              <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
              <div className="text-sm">
                <div className="font-semibold mb-1">Algumas empresas precisam reautenticar</div>
                <div className="text-muted-foreground">
                  {empresas.filter((e) => e.status === "ERRO").map((e) => e.nome).join(", ")}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}


function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-medium text-muted-foreground mb-1.5 mt-3">{children}</label>;
}

function SectionLabel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <h3 className={`text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground mb-3 ${className}`}>
      {children}
    </h3>
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className="w-full rounded-xl border border-border bg-background/50 px-3 py-2.5 text-sm focus:outline-none focus:border-brand/50 focus:ring-2 focus:ring-brand/20 transition-all mb-1"
    />
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="w-full rounded-xl border border-border bg-background/50 px-3 py-2.5 text-sm focus:outline-none focus:border-brand/50 focus:ring-2 focus:ring-brand/20 transition-all mb-1 jrm-date-input"
    />
  );
}

function LegendDot({ color, label, line }: { color: string; label: string; line?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 text-muted-foreground">
      {line ? (
        <span className="h-[2px] w-4 rounded-full" style={{ background: color }} />
      ) : (
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
      )}
      {label}
    </div>
  );
}

function KpiCard({
  label,
  valor,
  icon,
  gradient,
  accent,
  badge,
  variation,
  sub,
}: {
  label: string;
  valor: number;
  icon: React.ReactNode;
  gradient: string;
  accent: string;
  badge?: React.ReactNode;
  variation?: number | null;
  sub?: string;
}) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-border bg-card/60 backdrop-blur-xl p-4 shadow-lg hover:border-brand/30 hover:-translate-y-0.5 transition-all">
      <div className={`absolute -top-12 -right-12 h-32 w-32 rounded-full bg-gradient-to-br ${gradient} blur-2xl opacity-80 group-hover:opacity-100 transition-opacity`} />
      <div className="relative">
        <div className="flex items-center justify-between mb-3">
          <div className={`flex h-8 w-8 items-center justify-center rounded-lg bg-background/60 border border-border ${accent}`}>
            {icon}
          </div>
          {badge && (
            <div className={`flex h-6 w-6 items-center justify-center rounded-full bg-background/60 border border-border ${accent}`}>
              {badge}
            </div>
          )}
          {variation !== null && variation !== undefined && (
            <div
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                variation >= 0
                  ? "border-success/30 bg-success/10 text-success"
                  : "border-destructive/30 bg-destructive/10 text-destructive"
              }`}
            >
              {variation >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
              {Math.abs(variation).toFixed(1)}%
            </div>
          )}
        </div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
          {label}
        </div>
        <div className={`font-display text-xl lg:text-[1.4rem] font-bold tabular-nums tracking-tight ${accent}`}>
          {fmt(valor)}
        </div>
        {sub && (
          <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>
        )}
      </div>
    </div>
  );
}

const BANK_LOGOS: Array<[string, string]> = [
  ["ITAU", logoItau],
  ["BRADESCO", logoBradesco],
  ["SICOOB", logoSicoob],
];

const BANK_COLORS: Array<[string, string, string]> = [
  ["ITAU", "#F97316", "#F59E0B"],
  ["BRADESCO", "#DC2626", "#EF4444"],
  ["SICOOB", "#16A34A", "#059669"],
  ["SICREDI", "#22C55E", "#14B8A6"],
  ["SANTANDER", "#DC2626", "#F87171"],
  ["NUBANK", "#9333EA", "#8B5CF6"],
  ["INTER", "#EA580C", "#F59E0B"],
  ["BANCO DO BRASIL", "#CA8A04", "#EAB308"],
];

function BankAvatar({ nome }: { nome: string }) {
  const n = (nome || "").toUpperCase();
  const logoMatch = BANK_LOGOS.find(([k]) => n.includes(k));

  if (logoMatch) {
    return (
      <div className="h-8 w-8 rounded-lg overflow-hidden bg-white flex items-center justify-center shrink-0 shadow-sm border border-border/30">
        <img
          src={logoMatch[1]}
          alt={logoMatch[0]}
          className="h-full w-full object-contain p-0.5"
        />
      </div>
    );
  }

  const colorMatch = BANK_COLORS.find(([k]) => n.includes(k));
  const [, from, to] = colorMatch ?? ["", "var(--color-brand)", "var(--color-brand-2)"];
  const initials =
    nome
      .split(" ")
      .filter((w) => w.length > 2)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || nome.charAt(0).toUpperCase();

  return (
    <div
      style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
      className="h-8 w-8 rounded-lg flex items-center justify-center text-[10px] font-bold text-white shrink-0 shadow-sm"
    >
      {initials}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-card/60 backdrop-blur-xl p-4 shadow-lg">
      <div className="flex items-center justify-between mb-3">
        <div className="h-8 w-8 rounded-lg bg-muted/60 animate-pulse" />
      </div>
      <div className="h-2.5 w-20 rounded-full bg-muted/60 animate-pulse mb-2" />
      <div className="h-7 w-32 rounded-full bg-muted/60 animate-pulse" />
    </div>
  );
}
