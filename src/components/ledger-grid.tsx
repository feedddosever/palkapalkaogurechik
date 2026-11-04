"use client";

import Link from "next/link";
import { useCallback, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type GridApi,
  type GridState,
  type ICellRendererParams,
  type RowClickedEvent,
  type ValueFormatterParams,
} from "ag-grid-community";
import { AllEnterpriseModule, LicenseManager } from "ag-grid-enterprise";
import { AgChartsEnterpriseModule } from "ag-charts-enterprise";
import { BarChart3, FileDown, FileSignature, RotateCcw, Sparkles } from "lucide-react";
import { askLedgerAction } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { LedgerRow } from "@/server/ledger";

ModuleRegistry.registerModules([AllEnterpriseModule.with(AgChartsEnterpriseModule)]);
if (process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY)
  LicenseManager.setLicenseKey(process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY);

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const money = (p: ValueFormatterParams) =>
  p.value == null || p.value === "" ? "" : usd.format(Number(p.value));
const weekLabel = (iso: string) =>
  iso
    ? `Week of ${new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`
    : "";

const STATUS_TONE: Record<string, "allow" | "review" | "block" | "neutral" | "info"> = {
  Paid: "allow",
  Approved: "allow",
  "Waiting for you": "review",
  Blocked: "block",
  Failed: "block",
  Denied: "neutral",
  Held: "info",
  Released: "neutral",
};

function StatusCell(p: ICellRendererParams<LedgerRow>) {
  if (!p.value) return null;
  return <Badge tone={STATUS_TONE[String(p.value)] ?? "neutral"}>{String(p.value)}</Badge>;
}

function ReceiptCell(p: ICellRendererParams<LedgerRow>) {
  if (!p.value) return null;
  return (
    <Link
      href={`/verify/${String(p.value)}`}
      className="text-primary inline-flex items-center gap-1 hover:underline"
      onClick={(e) => e.stopPropagation()}
    >
      <FileSignature className="size-3.5" aria-hidden /> Receipt
    </Link>
  );
}

// Grid theme from Leash's tokens (light / dark).
const LIGHT = {
  accentColor: "#0e6b5c",
  backgroundColor: "#ffffff",
  foregroundColor: "#16181d",
  headerBackgroundColor: "#f1efe9",
  headerTextColor: "#5e6470",
  borderColor: "#e4e1d8",
  chromeBackgroundColor: "#f7f6f2",
  oddRowBackgroundColor: "#fcfbf8",
  selectedRowBackgroundColor: "#e5f2ee",
};
const DARK = {
  accentColor: "#3fc1a5",
  backgroundColor: "#16191e",
  foregroundColor: "#ecedef",
  headerBackgroundColor: "#1c2026",
  headerTextColor: "#9aa1ac",
  borderColor: "#2a2f37",
  chromeBackgroundColor: "#0e1013",
  oddRowBackgroundColor: "#181b21",
  selectedRowBackgroundColor: "#12302a",
};
const BASE = {
  fontFamily: "inherit",
  fontSize: 13,
  headerFontWeight: 600,
  borderRadius: 8,
  wrapperBorderRadius: 12,
  spacing: 7,
};

function subscribeScheme(cb: () => void) {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

const NARROW = "(max-width: 640px)";
function subscribeNarrow(cb: () => void) {
  const mq = window.matchMedia(NARROW);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/** Most important columns first; on phones, secondary columns start hidden (side bar can show them). */
const ORDER = [
  "date",
  "description",
  "supplier",
  "status",
  "amount",
  "spent",
  "reason",
  "decidedBy",
  "vsMarketPct",
  "saved",
  "trend",
  "receiptId",
  "week",
  "event",
  "category",
  "captureId",
  "payoutBatchId",
  "authorizationId",
];
const COMPACT_HIDDEN = new Set([
  "reason",
  "decidedBy",
  "vsMarketPct",
  "saved",
  "trend",
  "week",
  "event",
  "category",
]);

function arrange(cols: ColDef<LedgerRow>[], compact: boolean): ColDef<LedgerRow>[] {
  const byField = new Map(cols.map((c) => [String(c.field), c]));
  return ORDER.flatMap((f) => {
    const c = byField.get(f);
    if (!c) return [];
    return [compact && COMPACT_HIDDEN.has(f) ? { ...c, hide: true } : c];
  });
}

const PRESETS: { label: string; state: GridState }[] = [
  {
    label: "Spend by supplier",
    state: {
      rowGroup: { groupColIds: ["supplier"] },
      aggregation: {
        aggregationModel: [
          { colId: "spent", aggFunc: "sum" },
          { colId: "saved", aggFunc: "sum" },
        ],
      },
      filter: { filterModel: { status: { filterType: "set", values: ["Paid"] } } },
    },
  },
  {
    label: "Week × supplier",
    state: {
      pivot: { pivotMode: true, pivotColIds: ["supplier"] },
      rowGroup: { groupColIds: ["week"] },
      aggregation: { aggregationModel: [{ colId: "spent", aggFunc: "sum" }] },
      filter: { filterModel: { status: { filterType: "set", values: ["Paid"] } } },
    },
  },
  {
    label: "Stopped by Leash",
    state: { filter: { filterModel: { status: { filterType: "set", values: ["Blocked"] } } } },
  },
  {
    label: "Waiting for you",
    state: { filter: { filterModel: { status: { filterType: "set", values: ["Waiting for you"] } } } },
  },
];

const EXAMPLES = [
  "What did Leash block?",
  "Paid over $100 by supplier",
  "Which supplier got the most this month?",
  "Spend by week",
];

export function LedgerGrid({ rows, aiLive }: { rows: LedgerRow[]; aiLive: boolean }) {
  const apiRef = useRef<GridApi<LedgerRow> | null>(null);
  const [selected, setSelected] = useState<LedgerRow | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<{ text: string; source: "ai" | "offline" } | null>(null);
  const [asking, startAsking] = useTransition();
  const dark = useSyncExternalStore(
    subscribeScheme,
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
    () => false,
  );
  const theme = useMemo(() => themeQuartz.withParams({ ...BASE, ...(dark ? DARK : LIGHT) }), [dark]);
  const compact = useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia(NARROW).matches,
    () => false,
  );

  const columnDefs = useMemo<ColDef<LedgerRow>[]>(
    () =>
      arrange(
        [
          {
            field: "date",
            headerName: "When",
            sort: "desc",
            width: 150,
            filter: "agDateColumnFilter",
            valueFormatter: (p) =>
              p.value
                ? new Date(String(p.value)).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })
                : "",
          },
          {
            field: "week",
            headerName: "Week",
            width: 140,
            enableRowGroup: true,
            enablePivot: true,
            filter: "agSetColumnFilter",
            valueFormatter: (p) => weekLabel(String(p.value ?? "")),
          },
          {
            field: "event",
            headerName: "Type",
            width: 120,
            enableRowGroup: true,
            enablePivot: true,
            filter: "agSetColumnFilter",
          },
          {
            field: "supplier",
            width: 170,
            enableRowGroup: true,
            enablePivot: true,
            filter: "agSetColumnFilter",
          },
          {
            field: "category",
            width: 130,
            enableRowGroup: true,
            enablePivot: true,
            filter: "agSetColumnFilter",
          },
          {
            field: "description",
            headerName: "What",
            flex: 2,
            minWidth: 220,
            tooltipField: "description",
            filter: "agTextColumnFilter",
          },
          {
            field: "amount",
            headerName: "Amount",
            width: 120,
            type: "rightAligned",
            filter: "agNumberColumnFilter",
            enableValue: true,
            valueFormatter: money,
          },
          {
            field: "spent",
            headerName: "Spent",
            width: 115,
            type: "rightAligned",
            filter: "agNumberColumnFilter",
            enableValue: true,
            aggFunc: "sum",
            valueFormatter: money,
          },
          {
            field: "status",
            width: 150,
            enableRowGroup: true,
            enablePivot: true,
            filter: "agSetColumnFilter",
            cellRenderer: StatusCell,
          },
          {
            field: "decidedBy",
            headerName: "Decided by",
            width: 140,
            enableRowGroup: true,
            filter: "agSetColumnFilter",
          },
          {
            field: "reason",
            headerName: "Why",
            flex: 2,
            minWidth: 240,
            tooltipField: "reason",
            filter: "agTextColumnFilter",
          },
          {
            field: "vsMarketPct",
            headerName: "vs market",
            width: 110,
            type: "rightAligned",
            filter: "agNumberColumnFilter",
            valueFormatter: (p) =>
              p.value == null ? "" : `${Number(p.value) > 0 ? "+" : ""}${Number(p.value).toFixed(1)}%`,
            cellClassRules: {
              "text-allow": (p) => p.value != null && Number(p.value) < 0,
              "text-review": (p) => p.value != null && Number(p.value) > 10,
            },
          },
          {
            field: "saved",
            headerName: "Saved",
            width: 105,
            type: "rightAligned",
            enableValue: true,
            aggFunc: "sum",
            valueFormatter: money,
          },
          {
            field: "trend",
            headerName: "Supplier, 5 wks",
            width: 150,
            sortable: false,
            filter: false,
            cellRenderer: "agSparklineCellRenderer",
            cellRendererParams: {
              sparklineOptions: {
                type: "bar",
                fill: dark ? "#3fc1a5" : "#0e6b5c",
                padding: { top: 4, bottom: 4 },
              },
            },
          },
          { field: "receiptId", headerName: "Receipt", width: 110, cellRenderer: ReceiptCell, filter: false },
          { field: "captureId", headerName: "PayPal capture", width: 180, hide: true },
          { field: "payoutBatchId", headerName: "PayPal payout", width: 180, hide: true },
          { field: "authorizationId", headerName: "PayPal hold", width: 180, hide: true },
        ],
        compact,
      ),
    [dark, compact],
  );

  const defaultColDef = useMemo<ColDef>(
    () => ({ sortable: true, resizable: true, filter: true, menuTabs: ["filterMenuTab", "generalMenuTab"] }),
    [],
  );

  const reset = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    api.setState({ sort: { sortModel: [{ colId: "date", sort: "desc" }] } });
    setAnswer(null);
  }, []);

  const apply = useCallback((state: GridState) => {
    const api = apiRef.current;
    if (!api) return;
    api.setState(state);
  }, []);

  const ask = (q: string) => {
    const api = apiRef.current;
    if (!api || !q.trim()) return;
    setQuestion(q);
    const schema = api.getStructuredSchema({
      exclude: ["columnSizing"],
      columns: {
        status: { includeSetValues: true, description: "Outcome of the payment request" },
        supplier: { includeSetValues: true },
        category: { includeSetValues: true },
        event: { includeSetValues: true },
        week: { includeSetValues: true, description: "Monday date (YYYY-MM-DD) of the week" },
        decidedBy: { includeSetValues: true, description: "Guard layers that decided the outcome" },
        spent: { description: "Money that actually moved (null unless paid)" },
        amount: { description: "Amount requested" },
      },
    });
    startAsking(async () => {
      try {
        const res = await askLedgerAction(q, schema);
        api.setState(res.state as GridState);
        setAnswer({ text: res.explanation, source: res.source });
      } catch {
        setAnswer({ text: "Couldn't answer that one. Try rephrasing.", source: "offline" });
      }
    });
  };

  const chart = () => {
    const api = apiRef.current;
    if (!api) return;
    apply(PRESETS[1].state);
    setTimeout(() => api.createPivotChart({ chartType: "stackedColumn" }), 50);
  };

  const totals = useMemo(() => {
    const live = rows.filter((r) => !r.historical);
    return {
      paid: live.filter((r) => r.status === "Paid").reduce((a, r) => a + (r.spent ?? 0), 0),
      blocked: live.filter((r) => r.status === "Blocked").reduce((a, r) => a + r.amount, 0),
      saved: rows.reduce((a, r) => a + (r.saved ?? 0), 0),
    };
  }, [rows]);

  return (
    <div className="flex flex-col gap-4">
      <form
        className="border-border bg-surface shadow-card flex flex-col gap-2 rounded-xl border p-4"
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
      >
        <label htmlFor="ledger-question" className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="text-primary size-4" aria-hidden /> Ask the ledger
          <Badge tone={aiLive ? "primary" : "neutral"}>
            {aiLive ? "Claude + AG Grid AI Toolkit" : "offline parser"}
          </Badge>
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="ledger-question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. blocked or waiting payments over $50, by supplier"
            className="border-border bg-background focus:ring-ring h-10 flex-1 rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
          />
          <Button type="submit" disabled={asking || !question.trim()} aria-busy={asking}>
            {asking ? "Thinking…" : "Ask"}
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => ask(ex)}
              className="border-border text-muted hover:border-border-strong hover:text-foreground rounded-full border px-2.5 py-1 text-xs"
            >
              {ex}
            </button>
          ))}
        </div>
        {answer ? (
          <p role="status" className="text-muted text-sm">
            {answer.text}
          </p>
        ) : null}
      </form>

      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <Button key={p.label} variant="secondary" size="sm" onClick={() => apply(p.state)}>
            {p.label}
          </Button>
        ))}
        <Button variant="secondary" size="sm" onClick={chart}>
          <BarChart3 aria-hidden /> Chart it
        </Button>
        <Button variant="ghost" size="sm" onClick={reset}>
          <RotateCcw aria-hidden /> Reset
        </Button>
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => apiRef.current?.exportDataAsExcel({ fileName: "leash-ledger.xlsx" })}
        >
          <FileDown aria-hidden /> Excel
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => apiRef.current?.exportDataAsCsv({ fileName: "leash-ledger.csv" })}
        >
          CSV
        </Button>
      </div>

      <div className="text-muted flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <span>
          Paid this week:{" "}
          <span className="tabular text-foreground font-semibold">{usd.format(totals.paid)}</span>
        </span>
        <span>
          Stopped by Leash:{" "}
          <span className="tabular text-block font-semibold">{usd.format(totals.blocked)}</span>
        </span>
        <span>
          Saved vs market (all time):{" "}
          <span className="tabular text-primary font-semibold">{usd.format(totals.saved)}</span>
        </span>
      </div>

      <div className="h-[640px] w-full">
        <AgGridReact<LedgerRow>
          theme={theme}
          rowData={rows}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          getRowId={(p) => p.data.id}
          rowGroupPanelShow="always"
          pivotPanelShow="onlyWhenPivoting"
          groupDefaultExpanded={1}
          autoGroupColumnDef={{ minWidth: 220, headerName: "Group" }}
          sideBar={{ toolPanels: ["columns", "filters"], defaultToolPanel: "" }}
          statusBar={{
            statusPanels: [
              { statusPanel: "agTotalAndFilteredRowCountComponent", align: "left" },
              { statusPanel: "agAggregationComponent", align: "right" },
            ],
          }}
          cellSelection
          enableCharts
          animateRows
          suppressColumnVirtualisation
          tooltipShowDelay={300}
          onGridReady={(e) => {
            apiRef.current = e.api;
          }}
          onRowClicked={(e: RowClickedEvent<LedgerRow>) => {
            if (e.data && !e.node.group) setSelected(e.data);
          }}
        />
      </div>

      <Dialog
        open={selected !== null}
        onClose={() => setSelected(null)}
        side="right"
        title={selected?.description ?? ""}
        description={selected ? `${selected.supplier} · ${selected.event}` : undefined}
      >
        {selected ? <RowDetail row={selected} /> : null}
      </Dialog>
    </div>
  );
}

function RowDetail({ row }: { row: LedgerRow }) {
  const ids: [string, string | null][] = [
    ["PayPal hold (authorization)", row.authorizationId],
    ["Captured from hold", row.captureId],
    ["Paid to supplier (payout)", row.payoutBatchId],
  ];
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={STATUS_TONE[row.status] ?? "neutral"}>{row.status}</Badge>
        <span className="tabular text-lg font-semibold">{usd.format(row.amount)}</span>
        <span className="text-muted">{new Date(row.date).toLocaleString("en-US")}</span>
      </div>
      <div>
        <p className="font-medium">Why</p>
        <p className="text-muted">{row.reason}</p>
        <p className="text-subtle mt-1 text-xs">Decided by: {row.decidedBy}</p>
      </div>
      {row.vsMarketPct != null ? (
        <p className="text-muted">
          Price vs Channel3 market median:{" "}
          <span className={row.vsMarketPct < 0 ? "text-allow" : "text-review"}>
            {row.vsMarketPct > 0 ? "+" : ""}
            {row.vsMarketPct.toFixed(1)}%
          </span>
          {row.saved ? ` (saved ${usd.format(row.saved)})` : ""}
        </p>
      ) : null}
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
        {ids.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-subtle">{label}</dt>
            <dd>
              {value ? (
                <code className="font-mono text-xs break-all">{value}</code>
              ) : (
                <span className="text-subtle">n/a</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-3">
        {row.receiptId ? (
          <Link
            href={`/verify/${row.receiptId}`}
            className="text-primary inline-flex items-center gap-1 font-medium hover:underline"
          >
            <FileSignature className="size-4" aria-hidden /> Signed receipt
          </Link>
        ) : null}
        {row.runId ? (
          <Link href={`/app/runs/${row.runId}`} className="text-primary font-medium hover:underline">
            Agent run
          </Link>
        ) : null}
      </div>
    </div>
  );
}
