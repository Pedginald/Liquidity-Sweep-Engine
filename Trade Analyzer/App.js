import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  psychologicalStressTest,
  PSYCHOLOGICAL_PROFILES,
} from "./psychologicalStressTest";
import { simulateEquityCurve, compareTPscenarios } from "./equitySimulator";
import {
  initPairProfiles,
  getPairProfile,
  updatePairProfile,
  importBacktestToProfile,
} from "./pairProfileManager";
import { TabPortfolioSimulator, TabPsychologicalFit } from "./NewTabs";
import { TabPairOptimizer } from "./TabPairOptimizer";

// ── THEME ─────────────────────────────────────────────────────────────────────
const T = {
  bg: "#080c14",
  panel: "#0e1520",
  panelAlt: "#131d2e",
  border: "#1a2840",
  accent: "#38bdf8",
  green: "#34d399",
  red: "#f87171",
  yellow: "#fbbf24",
  purple: "#a78bfa",
  orange: "#fb923c",
  text: "#e2e8f0",
  sub: "#64748b",
  mono: "'JetBrains Mono','Fira Code','Courier New',monospace",
};

// ── MILESTONE DEFINITIONS ─────────────────────────────────────────────────────
const MILESTONES = Array.from({ length: 40 }, (_, i) => (i + 1) * 0.5);

function milestoneColName(r) {
  const whole = Math.floor(r);
  const hasHalf = r - whole > 0.01;
  return hasHalf ? `TimeTo${whole}_5R` : `TimeTo${whole}R`;
}

const MILESTONE_COLS = MILESTONES.map(milestoneColName);
const SL_COL = "TimeToSL";
const FILL_COL = "TimeToFill";

// ── CSV PARSER ────────────────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const firstLine = lines[0];
  const delim = firstLine.includes("\t") ? "\t" : ",";
  const headers = firstLine.split(delim).map((h) => h.trim().replace(/"/g, ""));

  const PRESERVE_COLS = [
    "TimeToFill",
    "TimeTo30Min",
    "TimeTo1H",
    "TimeTo4H",
    "TimeTo24H",
    "H4Trend",
    "VolRegime",
    "ATRPercentile",
    "ADX",
    "MomentumBefore",
    "LondonOrNY",
    "SlippagePips",
    "FillLatencyMs",
    "BarsToLevelRetouch",
    "TargetR",
    "Mode",
    "SimSlippage",
    "SpreadCost",
  ];

  return lines
    .slice(1)
    .map((line) => {
      const vals = line.split(delim).map((v) => v.trim().replace(/"/g, ""));
      const obj = {};
      headers.forEach((h, i) => {
        const raw = vals[i] || "";
        if (
          MILESTONE_COLS.includes(h) ||
          h === SL_COL ||
          PRESERVE_COLS.includes(h)
        ) {
          obj[h] = raw;
          return;
        }
        const n = parseFloat(raw);
        obj[h] = isNaN(n) ? raw : n;
      });
      return obj;
    })
    .filter((r) => r.ExitReason && r.ExitReason !== "");
}

// ── MILESTONE HELPERS ─────────────────────────────────────────────────────────
function parseMT5Time(str) {
  if (!str || str === "" || str === "0") return null;
  const cleaned = str.replace(/\./g, "-");
  const d = new Date(cleaned);
  return isNaN(d.getTime()) ? null : d;
}

function hasMilestoneData(trade) {
  return MILESTONE_COLS.some(
    (col) => trade[col] !== undefined && trade[col] !== ""
  );
}

function milestoneOutcome(trade, targetR) {
  const rCol = milestoneColName(targetR);
  const rTime = parseMT5Time(trade[rCol]);
  const slTime = parseMT5Time(trade[SL_COL]);

  const rHit = rTime !== null;
  const slHit = slTime !== null;

  if (rHit && slHit) {
    return rTime <= slTime ? "WIN" : "LOSS";
  }
  if (rHit && !slHit) return "WIN";
  if (!rHit && slHit) return "LOSS";
  return "EXPIRED";
}

// ── STATS CALCULATION ─────────────────────────────────────────────────────────
function calcStats(trades, tp = 2.0) {
  if (!trades || !trades.length) return null;

  const snappedTP = Math.round(tp * 2) / 2;
  const useMilestones =
    trades.some(hasMilestoneData) && MILESTONES.includes(snappedTP);

  const results = trades.map((t) => {
    if (useMilestones && hasMilestoneData(t)) {
      const outcome = milestoneOutcome(t, snappedTP);
      if (outcome === "WIN") return snappedTP;
      if (outcome === "LOSS") return -1;

      const slTime = parseMT5Time(t[SL_COL]);
      let bestR = 0;
      for (let i = MILESTONES.length - 1; i >= 0; i--) {
        const rTime = parseMT5Time(t[milestoneColName(MILESTONES[i])]);
        if (rTime !== null) {
          if (slTime && rTime > slTime) continue;
          bestR = MILESTONES[i];
          break;
        }
      }
      return Math.min(bestR, snappedTP);
    }

    const maxR = typeof t.MaxR === "number" ? t.MaxR : 0;
    const worstR = typeof t.WorstR === "number" ? t.WorstR : 0;
    const barMax = typeof t.BarToMaxR === "number" ? t.BarToMaxR : 999999;
    const barWst = typeof t.BarToWorstR === "number" ? t.BarToWorstR : 999999;
    const exitR = typeof t.ExitR === "number" ? t.ExitR : null;

    if (exitR !== null) {
      if (maxR >= tp && barMax <= barWst) return tp;
      if (worstR >= 1.0 && barWst < barMax) return -1;
      return Math.max(-1, Math.min(exitR, tp));
    }

    if (maxR >= tp && barMax <= barWst) return tp;
    if (worstR >= 1.0 && barWst <= barMax) return -1;
    return Math.max(-1, Math.min(maxR, tp));
  });

  const wins = results.filter((r) => r > 0).length;
  const losses = results.filter((r) => r < 0).length;
  const scratch = results.filter((r) => r === 0).length;
  const tpHits = results.filter((r) => r >= snappedTP - 0.01).length;
  const slHits = results.filter((r) => r <= -0.99).length;
  const expired = trades.length - tpHits - slHits;

  const exp = results.reduce((a, b) => a + b, 0) / results.length;
  const totalR = results.reduce((a, b) => a + b, 0);

  return {
    count: trades.length,
    wins,
    losses,
    scratch,
    tpHits,
    slHits,
    expired,
    wr: wins / trades.length,
    tpWr: tpHits / trades.length,
    exp,
    totalR,
  };
}

function calcTPCurve(trades) {
  return MILESTONES.map((r) => {
    const s = calcStats(trades, r);
    return {
      r,
      ...(s || {
        exp: 0,
        wr: 0,
        tpWr: 0,
        count: 0,
        totalR: 0,
        wins: 0,
        losses: 0,
        tpHits: 0,
        slHits: 0,
        expired: 0,
      }),
    };
  });
}

function groupBy(trades, keyFn) {
  const map = {};
  trades.forEach((t) => {
    const k = keyFn(t);
    if (k === null || k === undefined || k === "") return;
    if (!map[k]) map[k] = [];
    map[k].push(t);
  });
  return map;
}

function sortedBuckets(map, sortFn) {
  return Object.entries(map)
    .map(([k, v]) => ({ key: k, trades: v }))
    .sort(sortFn || ((a, b) => parseFloat(a.key) - parseFloat(b.key)));
}

// ── UI COMPONENTS ─────────────────────────────────────────────────────────────
function Pill({ label, active, onClick, color }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontFamily: T.mono,
        fontSize: 11,
        fontWeight: 700,
        padding: "4px 12px",
        borderRadius: 4,
        cursor: "pointer",
        border: `1px solid ${active ? color || T.accent : T.border}`,
        background: active ? color || T.accent : T.panel,
        color: active ? T.bg : T.text,
        transition: "all 0.15s",
      }}
    >
      {label}
    </button>
  );
}

function Panel({ children, style }) {
  return (
    <div
      style={{
        background: T.panel,
        border: `1px solid ${T.border}`,
        borderRadius: 8,
        padding: 20,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function SectionTitle({ children, sub }) {
  return (
    <div
      style={{
        marginBottom: 16,
        paddingBottom: 12,
        borderBottom: `1px solid ${T.border}`,
      }}
    >
      <div
        style={{
          color: T.accent,
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.12em",
          fontWeight: 700,
          fontFamily: T.mono,
        }}
      >
        {children}
      </div>
      {sub && (
        <div
          style={{
            color: T.sub,
            fontSize: 11,
            marginTop: 3,
            fontFamily: T.mono,
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color, sub }) {
  return (
    <div
      style={{
        background: T.panelAlt,
        border: `1px solid ${T.border}`,
        borderRadius: 6,
        padding: "14px 16px",
        minWidth: 120,
      }}
    >
      <div
        style={{
          color: T.sub,
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          marginBottom: 6,
          fontFamily: T.mono,
        }}
      >
        {label}
      </div>
      <div
        style={{
          color: color || T.text,
          fontSize: 22,
          fontWeight: 700,
          fontFamily: T.mono,
        }}
      >
        {value}
      </div>
      {sub && (
        <div
          style={{
            color: T.sub,
            fontSize: 10,
            marginTop: 3,
            fontFamily: T.mono,
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

function HBar({ label, value, maxAbs, count, color, onClick, active }) {
  const pct = maxAbs > 0 ? (Math.abs(value) / maxAbs) * 100 : 0;
  const col = value >= 0 ? color || T.green : T.red;
  return (
    <div
      onClick={onClick}
      style={{
        marginBottom: 7,
        cursor: onClick ? "pointer" : "default",
        background: active ? "rgba(56,189,248,0.05)" : "transparent",
        borderRadius: 4,
        padding: "4px 6px",
        transition: "background 0.15s",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 4,
          alignItems: "center",
        }}
      >
        <span style={{ color: T.text, fontSize: 12, fontFamily: T.mono }}>
          {label}
        </span>
        <span style={{ fontFamily: T.mono, fontSize: 12 }}>
          <span style={{ color: col }}>
            {value >= 0 ? "+" : ""}
            {value.toFixed(4)}R
          </span>
          <span style={{ color: T.sub, marginLeft: 10 }}>n={count}</span>
        </span>
      </div>
      <div style={{ height: 5, background: T.border, borderRadius: 3 }}>
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: col,
            borderRadius: 3,
            transition: "width 0.4s",
          }}
        />
      </div>
    </div>
  );
}

function Table({ headers, rows, highlightCol }) {
  return (
    <table
      style={{
        width: "100%",
        borderCollapse: "collapse",
        fontFamily: T.mono,
        fontSize: 12,
      }}
    >
      <thead>
        <tr>
          {headers.map((h, i) => (
            <th
              key={i}
              style={{
                color: T.sub,
                padding: "6px 10px",
                textAlign: "left",
                borderBottom: `1px solid ${T.border}`,
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} style={{ borderTop: `1px solid ${T.border}` }}>
            {row.map((cell, j) => (
              <td
                key={j}
                style={{
                  padding: "7px 10px",
                  color: j === highlightCol ? T.accent : T.text,
                }}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DropZone({ onFiles, fileNames, totalTrades }) {
  const [drag, setDrag] = useState(false);
  const onDrop = (e) => {
    e.preventDefault();
    setDrag(false);
    onFiles([...e.dataTransfer.files].filter((f) => f.name.endsWith(".csv")));
  };
  return (
    <div
      onDrop={onDrop}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onClick={() => document.getElementById("_fi").click()}
      style={{
        border: `2px dashed ${drag ? T.accent : T.border}`,
        borderRadius: 8,
        padding: "20px",
        textAlign: "center",
        cursor: "pointer",
        background: drag ? "rgba(56,189,248,0.04)" : "transparent",
        transition: "all 0.2s",
        marginBottom: 20,
      }}
    >
      <div
        style={{
          color: drag ? T.accent : T.sub,
          fontSize: 13,
          fontFamily: T.mono,
        }}
      >
        {totalTrades === 0
          ? "📂 Drop CSV files here — or click to browse"
          : `${totalTrades} trades loaded from ${fileNames.length} files — drop more to add`}
      </div>
      {fileNames.length > 0 && (
        <div
          style={{
            marginTop: 10,
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            justifyContent: "center",
          }}
        >
          {fileNames.map((n, i) => (
            <span
              key={i}
              style={{
                background: T.border,
                color: T.accent,
                fontSize: 10,
                padding: "2px 8px",
                borderRadius: 4,
                fontFamily: T.mono,
              }}
            >
              {n}
            </span>
          ))}
        </div>
      )}
      <input
        id="_fi"
        type="file"
        multiple
        accept=".csv"
        style={{ display: "none" }}
        onChange={(e) => onFiles([...e.target.files])}
      />
    </div>
  );
}

// LazyTab - truly prevents rendering of inactive tabs
const LazyTab = React.memo(function LazyTab({ active, children }) {
  const [hasRendered, setHasRendered] = useState(false);

  useEffect(() => {
    if (active && !hasRendered) setHasRendered(true);
  }, [active, hasRendered]);

  // CRITICAL: Don't evaluate children at all if not active and never rendered
  if (!active && !hasRendered) return null;

  return <div style={{ display: active ? "block" : "none" }}>{children}</div>;
});

// ── TABS ──────────────────────────────────────────────────────────────────────

const TabOverview = React.memo(function TabOverview({ trades, tp }) {
  const tradesWithSlippage = trades.filter(
    (t) =>
      t.SlippagePips !== undefined &&
      t.SlippagePips !== "" &&
      !isNaN(t.SlippagePips)
  ).length;
  const tradesWithLatency = trades.filter(
    (t) =>
      t.FillLatencyMs !== undefined &&
      t.FillLatencyMs !== "" &&
      !isNaN(t.FillLatencyMs)
  ).length;

  const avgSlippage =
    tradesWithSlippage > 0
      ? trades
          .filter(
            (t) =>
              t.SlippagePips !== undefined &&
              t.SlippagePips !== "" &&
              !isNaN(t.SlippagePips)
          )
          .reduce((a, t) => a + (parseFloat(t.SlippagePips) || 0), 0) /
        tradesWithSlippage
      : 0;

  const maxSlippage =
    tradesWithSlippage > 0
      ? Math.max(
          ...trades
            .filter(
              (t) => t.SlippagePips !== undefined && !isNaN(t.SlippagePips)
            )
            .map((t) => parseFloat(t.SlippagePips) || 0)
        )
      : 0;

  const avgLatency =
    tradesWithLatency > 0
      ? trades
          .filter(
            (t) =>
              t.FillLatencyMs !== undefined &&
              t.FillLatencyMs !== "" &&
              !isNaN(t.FillLatencyMs)
          )
          .reduce((a, t) => a + (parseInt(t.FillLatencyMs) || 0), 0) /
        tradesWithLatency
      : 0;

  const badSlippageCount = trades.filter(
    (t) => (parseFloat(t.SlippagePips) || 0) > 1.0
  ).length;

  const slippageByPair = useMemo(() => {
    const map = {};
    trades
      .filter((t) => t.SlippagePips !== undefined && !isNaN(t.SlippagePips))
      .forEach((t) => {
        const pair = t._pair || "UNKNOWN";
        if (!map[pair]) map[pair] = { values: [], count: 0 };
        map[pair].values.push(parseFloat(t.SlippagePips) || 0);
        map[pair].count++;
      });
    Object.keys(map).forEach((k) => {
      map[k].avg =
        map[k].values.reduce((a, b) => a + b, 0) / map[k].values.length;
      map[k].max = Math.max(...map[k].values);
    });
    return map;
  }, [trades]);

  const stats = useMemo(() => calcStats(trades, tp), [trades, tp]);
  const byYear = useMemo(
    () => sortedBuckets(groupBy(trades, (t) => t.Year)),
    [trades]
  );
  const yearExps = byYear.map((b) =>
    Math.abs(calcStats(b.trades, tp)?.exp || 0)
  );
  const maxYearExp = Math.max(...yearExps, 0.001);
  const posYears = byYear.filter(
    (b) => (calcStats(b.trades, tp)?.exp || 0) > 0
  ).length;
  const negYears = byYear.filter(
    (b) => (calcStats(b.trades, tp)?.exp || 0) <= 0
  ).length;
  const isMilestone = trades.some(hasMilestoneData);

  // Detect validation mode
  const validationMode = trades.some((t) => t.Mode === "VALIDATION");
  const liveMode = trades.some((t) => t.Mode === "LIVE");
  const mixedMode = validationMode && liveMode;
  const simSlippage = trades[0]?.SimSlippage || "0";
  const spreadCost = trades[0]?.SpreadCost || "0";
  const hasRealisticCosts =
    parseFloat(simSlippage) > 0 || parseFloat(spreadCost) > 0;

  if (!stats)
    return (
      <div style={{ color: T.sub, fontFamily: T.mono }}>No data loaded</div>
    );

  const expColor =
    stats.exp > 0.15 ? T.green : stats.exp > 0 ? T.yellow : T.red;

  const slipColor =
    avgSlippage > 0.5 ? T.red : avgSlippage > 0.3 ? T.yellow : T.green;
  const latColor =
    avgLatency > 2000 ? T.red : avgLatency > 500 ? T.yellow : T.green;

  return (
    <div>
      {isMilestone && (
        <div
          style={{
            background: "rgba(52,211,153,0.08)",
            border: `1px solid ${T.green}`,
            borderRadius: 6,
            padding: "10px 16px",
            marginBottom: 16,
            fontFamily: T.mono,
            fontSize: 11,
            color: T.green,
          }}
        >
          ✅ v4.5 FIXED execution — Plan never changes, slippage is just cost
        </div>
      )}
      {!isMilestone && (
        <div
          style={{
            background: "rgba(251,191,36,0.08)",
            border: `1px solid ${T.yellow}`,
            borderRadius: 6,
            padding: "10px 16px",
            marginBottom: 16,
            fontFamily: T.mono,
            fontSize: 11,
            color: T.yellow,
          }}
        >
          ⚠️ Legacy data — upgrade to v4.5 EA for fixed execution model
        </div>
      )}

      {mixedMode && (
        <div
          style={{
            background: "rgba(251,191,36,0.08)",
            border: `1px solid ${T.yellow}`,
            borderRadius: 6,
            padding: "10px 16px",
            marginBottom: 16,
            fontFamily: T.mono,
            fontSize: 11,
            color: T.yellow,
          }}
        >
          ⚠️ Mixed validation and live trades — analysis may be inconsistent
        </div>
      )}

      {validationMode && !liveMode && (
        <div
          style={{
            background: hasRealisticCosts
              ? "rgba(251,191,36,0.08)"
              : "rgba(56,189,248,0.08)",
            border: `1px solid ${hasRealisticCosts ? T.yellow : T.accent}`,
            borderRadius: 6,
            padding: "10px 16px",
            marginBottom: 16,
            fontFamily: T.mono,
            fontSize: 11,
            color: hasRealisticCosts ? T.yellow : T.accent,
          }}
        >
          ℹ️ VALIDATION MODE — Sim slippage: {simSlippage}p, Spread cost:{" "}
          {spreadCost}p
          {hasRealisticCosts
            ? " (Realistic costs ON)"
            : " (Ideal fills — no costs)"}
        </div>
      )}

      {tradesWithSlippage > 0 && (
        <Panel
          style={{
            marginBottom: 16,
            borderColor: avgSlippage > 0.5 ? T.red : T.border,
          }}
        >
          <SectionTitle sub="Execution quality — v4.5 FIXED model: plan never changes, costs are subtracted">
            💰 Data Quality Check
          </SectionTitle>
          <div
            style={{
              display: "flex",
              gap: 16,
              flexWrap: "wrap",
              marginBottom: 12,
            }}
          >
            <StatCard
              label="Avg Entry Slippage"
              value={avgSlippage.toFixed(2) + " pips"}
              color={slipColor}
              sub={
                avgSlippage > 0.5
                  ? "⚠️ HIGH"
                  : avgSlippage > 0.3
                  ? "⚡ OK"
                  : "✅ GOOD"
              }
            />
            <StatCard
              label="Max Slippage"
              value={maxSlippage.toFixed(2) + " pips"}
              color={maxSlippage > 2.0 ? T.red : T.yellow}
            />
            <StatCard
              label="Slippage Cost"
              value={`-${(avgSlippage * 0.5).toFixed(2)}R`}
              color={
                avgSlippage > 1.0
                  ? T.red
                  : avgSlippage > 0.5
                  ? T.yellow
                  : T.green
              }
              sub={`${avgSlippage.toFixed(2)} pips × 0.5R per pip`}
            />
            <StatCard
              label="Avg Latency"
              value={avgLatency.toFixed(0) + " ms"}
              color={latColor}
              sub={
                avgLatency > 2000
                  ? "⚠️ SLOW"
                  : avgLatency > 500
                  ? "⚡ OK"
                  : "✅ FAST"
              }
            />
            <StatCard
              label="Bad Slippage"
              value={badSlippageCount}
              color={badSlippageCount > 10 ? T.red : T.yellow}
              sub={
                ((badSlippageCount / trades.length) * 100).toFixed(1) +
                "% >1.0 pip"
              }
            />
          </div>

          {Object.keys(slippageByPair).length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div
                style={{
                  color: T.sub,
                  fontSize: 10,
                  marginBottom: 8,
                  textTransform: "uppercase",
                }}
              >
                Slippage by Pair (avg / max)
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {Object.entries(slippageByPair)
                  .sort((a, b) => a[1].avg - b[1].avg)
                  .map(([pair, data]) => (
                    <div
                      key={pair}
                      style={{
                        background: T.panelAlt,
                        border: `1px solid ${
                          data.avg > 0.5
                            ? T.red
                            : data.avg > 0.3
                            ? T.yellow
                            : T.green
                        }`,
                        borderRadius: 4,
                        padding: "6px 10px",
                        fontSize: 11,
                        fontFamily: T.mono,
                      }}
                    >
                      <span style={{ color: T.text, fontWeight: 700 }}>
                        {pair}
                      </span>
                      <span
                        style={{
                          color:
                            data.avg > 0.5
                              ? T.red
                              : data.avg > 0.3
                              ? T.yellow
                              : T.green,
                          marginLeft: 8,
                        }}
                      >
                        {data.avg.toFixed(2)}p
                      </span>
                      <span style={{ color: T.sub, marginLeft: 4 }}>
                        / {data.max.toFixed(1)}p
                      </span>
                      <span style={{ color: T.sub, marginLeft: 4 }}>
                        ({data.count})
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {avgSlippage > 0.3 && (
            <div
              style={{
                background: "rgba(52,211,153,0.08)",
                border: `1px solid ${T.green}`,
                borderRadius: 4,
                padding: "10px 14px",
                marginTop: 12,
                fontSize: 12,
                color: T.green,
                fontFamily: T.mono,
              }}
            >
              <strong>✅ v4.5 FIXED Model:</strong> Your realized expectancy of{" "}
              <strong>{stats.exp.toFixed(3)}R</strong> already includes{" "}
              {avgSlippage.toFixed(2)}pip slippage costs.
              <br />
              <em>
                Without slippage, theoretical expectancy would be ~
                {(stats.exp + avgSlippage * 0.5).toFixed(2)}R
              </em>
              <br />
              <br />
              <span style={{ color: T.sub }}>
                v4.5 FIX: Your TP target stays at {tp}R regardless of slippage.
                Before v4.5, slippage would pull your TP closer, hiding the real
                cost!
              </span>
            </div>
          )}
        </Panel>
      )}

      <div
        style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24 }}
      >
        <StatCard label="Trades" value={stats.count} />
        <StatCard
          label="Expectancy"
          value={(stats.exp >= 0 ? "+" : "") + stats.exp.toFixed(4) + "R"}
          color={expColor}
        />
        <StatCard
          label="Profitable"
          value={(stats.wr * 100).toFixed(1) + "%"}
          sub="positive exits"
          color={stats.wr >= 0.5 ? T.green : stats.wr >= 0.4 ? T.yellow : T.red}
        />
        <StatCard
          label="TP Hit Rate"
          value={(stats.tpWr * 100).toFixed(1) + "%"}
          sub={`full ${tp}R hit`}
          color={
            stats.tpWr >= 0.35 ? T.green : stats.tpWr >= 0.2 ? T.yellow : T.red
          }
        />
        <StatCard
          label="Total R"
          value={(stats.totalR >= 0 ? "+" : "") + stats.totalR.toFixed(1) + "R"}
          color={stats.totalR >= 0 ? T.green : T.red}
        />
        <StatCard
          label="TP Hits"
          value={stats.tpHits}
          color={T.green}
          sub={((stats.tpHits / stats.count) * 100).toFixed(0) + "%"}
        />
        <StatCard
          label="SL Hits"
          value={stats.slHits}
          color={T.red}
          sub={((stats.slHits / stats.count) * 100).toFixed(0) + "%"}
        />
        <StatCard
          label="Expired"
          value={stats.expired}
          color={T.yellow}
          sub={((stats.expired / stats.count) * 100).toFixed(0) + "%"}
        />
        <StatCard
          label="Pos Years"
          value={posYears}
          color={T.green}
          sub={`${negYears} negative`}
        />
      </div>

      <Panel>
        <SectionTitle
          sub={`${posYears} positive / ${negYears} negative at ${tp}R TP`}
        >
          Year by Year
        </SectionTitle>
        {byYear.map((b, i) => {
          const s = calcStats(b.trades, tp);
          if (!s) return null;
          return (
            <HBar
              key={i}
              label={b.key}
              value={s.exp}
              maxAbs={maxYearExp}
              count={s.count}
            />
          );
        })}
      </Panel>
    </div>
  );
});

function TabTPCurve({ trades, tp }) {
  const curve = useMemo(() => calcTPCurve(trades), [trades]);
  const isMilestone = trades.some(hasMilestoneData);
  const best = curve.reduce((a, b) => (b.exp > a.exp ? b : a), curve[0]);
  const maxExp = Math.max(...curve.map((c) => Math.abs(c.exp)), 0.001);
  const maxTotalR = Math.max(...curve.map((c) => Math.abs(c.totalR)), 0.001);

  const W = 800,
    H = 220,
    PAD = 50;
  const plotW = W - PAD * 2,
    plotH = H - PAD * 2;
  const minExp = Math.min(...curve.map((c) => c.exp));
  const maxExpV = Math.max(...curve.map((c) => c.exp));
  const expRange = Math.max(maxExpV - minExp, 0.01);

  const toX = (i) => PAD + (i / (curve.length - 1)) * plotW;
  const toY = (v) => PAD + plotH - ((v - minExp) / expRange) * plotH;

  const expPath = curve
    .map(
      (c, i) =>
        `${i === 0 ? "M" : "L"} ${toX(i).toFixed(1)} ${toY(c.exp).toFixed(1)}`
    )
    .join(" ");
  const zeroY = toY(0);

  return (
    <div>
      <Panel style={{ marginBottom: 20, borderColor: T.green }}>
        <SectionTitle>🎯 Optimal TP Level</SectionTitle>
        <div
          style={{
            display: "flex",
            gap: 16,
            flexWrap: "wrap",
            marginBottom: 12,
          }}
        >
          <StatCard
            label="Best TP"
            value={best.r + "R"}
            color={T.green}
            sub={`+${best.exp.toFixed(4)}R expectancy`}
          />
          <StatCard
            label="Win Rate"
            value={(best.wr * 100).toFixed(1) + "%"}
            color={best.wr >= 0.4 ? T.green : T.yellow}
            sub={`at ${best.r}R`}
          />
          <StatCard
            label="TP Hit Rate"
            value={(best.tpWr * 100).toFixed(1) + "%"}
            color={T.accent}
            sub={`full ${best.r}R reached`}
          />
          <StatCard
            label="Total R"
            value={(best.totalR >= 0 ? "+" : "") + best.totalR.toFixed(1) + "R"}
            color={best.totalR >= 0 ? T.green : T.red}
            sub={`over ${best.count} trades`}
          />
          <StatCard
            label="Current TP"
            value={tp + "R"}
            color={T.accent}
            sub={`${
              tp === best.r
                ? "✅ optimal!"
                : `${(best.exp - (calcStats(trades, tp)?.exp || 0)).toFixed(
                    4
                  )}R left on table`
            }`}
          />
        </div>
      </Panel>

      <Panel style={{ marginBottom: 20 }}>
        <SectionTitle sub="Expectancy at every 0.5R increment from 0.5R to 20R — v4.5 FIXED: targets never change with slippage">
          Expectancy Curve
        </SectionTitle>
        <svg
          width="100%"
          viewBox={`0 0 ${W} ${H}`}
          style={{ display: "block" }}
        >
          <line
            x1={PAD}
            y1={zeroY}
            x2={W - PAD}
            y2={zeroY}
            stroke={T.border}
            strokeWidth={1}
            strokeDasharray="4,4"
          />
          {[...Array(6)].map((_, i) => {
            const v = minExp + (i / 5) * expRange;
            const y = toY(v);
            return (
              <g key={i}>
                <line
                  x1={PAD}
                  y1={y}
                  x2={W - PAD}
                  y2={y}
                  stroke={T.border}
                  strokeWidth={0.5}
                  opacity={0.3}
                />
                <text
                  x={PAD - 6}
                  y={y + 4}
                  textAnchor="end"
                  fill={T.sub}
                  fontSize={9}
                  fontFamily={T.mono}
                >
                  {v.toFixed(2)}
                </text>
              </g>
            );
          })}
          {curve
            .filter((_, i) => i % 2 === 1)
            .map((c, i) => (
              <text
                key={i}
                x={toX(curve.indexOf(c))}
                y={H - 8}
                textAnchor="middle"
                fill={T.sub}
                fontSize={9}
                fontFamily={T.mono}
              >
                {c.r}R
              </text>
            ))}
          <path
            d={expPath}
            fill="none"
            stroke={T.accent}
            strokeWidth={2.5}
            strokeLinejoin="round"
          />
          {curve.map((c, i) => (
            <circle
              key={i}
              cx={toX(i)}
              cy={toY(c.exp)}
              r={c.r === best.r ? 5 : c.r === tp ? 4 : 2.5}
              fill={
                c.r === best.r
                  ? T.green
                  : c.r === tp
                  ? T.accent
                  : c.exp >= 0
                  ? T.green
                  : T.red
              }
              stroke={c.r === best.r || c.r === tp ? T.text : "none"}
              strokeWidth={1.5}
            />
          ))}
          <text
            x={toX(curve.indexOf(best))}
            y={toY(best.exp) - 12}
            textAnchor="middle"
            fill={T.green}
            fontSize={10}
            fontWeight={700}
            fontFamily={T.mono}
          >
            BEST {best.r}R
          </text>
        </svg>
      </Panel>

      <Panel>
        <SectionTitle sub="Complete TP optimisation data — v4.5: plan is sacred, costs are subtracted">
          TP Level Detail
        </SectionTitle>
        <div style={{ maxHeight: 500, overflowY: "auto" }}>
          <Table
            headers={[
              "TP",
              "Exp/Trade",
              "Win Rate",
              "TP Hit%",
              "Wins",
              "Losses",
              "Expired",
              "Total R",
              "",
            ]}
            rows={curve
              .filter(
                (c) =>
                  MILESTONES.indexOf(c.r) % 2 === 1 ||
                  c.r === best?.r ||
                  c.r === tp
              )
              .map((c) => [
                <span
                  style={{
                    color:
                      c.r === best.r ? T.green : c.r === tp ? T.accent : T.text,
                    fontWeight: c.r === best.r ? 700 : 400,
                  }}
                >
                  {c.r}R
                </span>,
                <span style={{ color: c.exp > 0 ? T.green : T.red }}>
                  {c.exp >= 0 ? "+" : ""}
                  {c.exp.toFixed(4)}R
                </span>,
                <span
                  style={{
                    color:
                      c.wr >= 0.4 ? T.green : c.wr >= 0.3 ? T.yellow : T.red,
                  }}
                >
                  {(c.wr * 100).toFixed(1)}%
                </span>,
                (c.tpWr * 100).toFixed(1) + "%",
                <span style={{ color: T.green }}>{c.wins}</span>,
                <span style={{ color: T.red }}>{c.losses}</span>,
                <span style={{ color: T.yellow }}>{c.expired}</span>,
                <span style={{ color: c.totalR >= 0 ? T.green : T.red }}>
                  {c.totalR >= 0 ? "+" : ""}
                  {c.totalR.toFixed(1)}R
                </span>,
                c.r === tp && c.r !== best.r ? (
                  <span style={{ color: T.accent }}>← current</span>
                ) : c.r === best.r ? (
                  <span style={{ color: T.green }}>★ best</span>
                ) : (
                  ""
                ),
              ])}
          />
        </div>
      </Panel>
    </div>
  );
}

function TabPoolQuality({ trades, tp }) {
  const byTouches = useMemo(
    () =>
      sortedBuckets(
        groupBy(trades, (t) => {
          const tc = t.TouchCount;
          if (!tc) return null;
          return tc >= 6 ? "6+" : String(Math.round(tc));
        })
      ),
    [trades]
  );

  const byAge = useMemo(
    () =>
      sortedBuckets(
        groupBy(trades, (t) => {
          const a = t.PoolAge;
          if (!a) return null;
          if (a <= 20) return "0-20";
          if (a <= 50) return "21-50";
          if (a <= 100) return "51-100";
          if (a <= 200) return "101-200";
          return "200+";
        })
      ),
    [trades]
  );

  const byFreshness = useMemo(
    () =>
      sortedBuckets(
        groupBy(trades, (t) => {
          const f = t.PoolAgeFresh;
          if (!f && f !== 0) return null;
          if (f <= 5) return "0-5";
          if (f <= 15) return "6-15";
          if (f <= 30) return "16-30";
          if (f <= 60) return "31-60";
          return "60+";
        })
      ),
    [trades]
  );

  const bySweepSize = useMemo(
    () =>
      sortedBuckets(
        groupBy(trades, (t) => {
          const s = t.SweepSizePips;
          if (!s) return null;
          if (s <= 5) return "0-5";
          if (s <= 15) return "6-15";
          if (s <= 30) return "16-30";
          if (s <= 60) return "31-60";
          return "60+";
        })
      ),
    [trades]
  );

  const bySweepBody = useMemo(
    () =>
      sortedBuckets(
        groupBy(trades, (t) => {
          const b = t.SweepBodyPct;
          if (!b && b !== 0) return null;
          if (b < 0.2) return "0-20% body";
          if (b < 0.4) return "20-40% body";
          if (b < 0.6) return "40-60% body";
          if (b < 0.8) return "60-80% body";
          return "80-100% body";
        })
      ),
    [trades]
  );

  const byRetouch = useMemo(
    () =>
      sortedBuckets(
        groupBy(trades, (t) => {
          const r = t.BarsToLevelRetouch;
          if (r === undefined || r === null) return "No data";
          if (r < 0) return "No retouch";
          if (r <= 2) return "0-2 bars";
          if (r <= 6) return "3-6 bars";
          if (r <= 12) return "7-12 bars";
          return "12+ bars";
        })
      ),
    [trades]
  );

  const maxExp = (buckets) =>
    Math.max(
      ...buckets.map((x) => Math.abs(calcStats(x.trades, tp)?.exp || 0)),
      0.001
    );
  const hasTouches = trades.some((t) => t.TouchCount);

  if (!hasTouches)
    return (
      <Panel>
        <div style={{ color: T.yellow, fontFamily: T.mono, fontSize: 13 }}>
          ⚠️ Pool quality columns not found in this CSV.
          <br />
          <span style={{ color: T.sub }}>
            Run LiquidityEngine_v4.5.mq5 to generate rich data.
          </span>
        </div>
      </Panel>
    );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
      <Panel>
        <SectionTitle sub="Does having more H4 touches improve results?">
          Touch Count
        </SectionTitle>
        {byTouches.map((b, i) => {
          const s = calcStats(b.trades, tp);
          return s ? (
            <HBar
              key={i}
              label={`${b.key} touches`}
              value={s.exp}
              maxAbs={maxExp(byTouches)}
              count={s.count}
              color={T.accent}
            />
          ) : null;
        })}
      </Panel>
      <Panel>
        <SectionTitle sub="firstBarAgo — how old is the level in H4 bars?">
          Pool Age
        </SectionTitle>
        {byAge.map((b, i) => {
          const s = calcStats(b.trades, tp);
          return s ? (
            <HBar
              key={i}
              label={`${b.key} H4 bars ago`}
              value={s.exp}
              maxAbs={maxExp(byAge)}
              count={s.count}
              color={T.purple}
            />
          ) : null;
        })}
      </Panel>
      <Panel>
        <SectionTitle sub="lastBarAgo — how recently was the level last touched?">
          Level Freshness
        </SectionTitle>
        {byFreshness.map((b, i) => {
          const s = calcStats(b.trades, tp);
          return s ? (
            <HBar
              key={i}
              label={`last touched ${b.key} H4 bars ago`}
              value={s.exp}
              maxAbs={maxExp(byFreshness)}
              count={s.count}
              color={T.yellow}
            />
          ) : null;
        })}
      </Panel>
      <Panel>
        <SectionTitle sub="How far did the H4 sweep candle extend beyond the level?">
          Sweep Size (pips)
        </SectionTitle>
        {bySweepSize.map((b, i) => {
          const s = calcStats(b.trades, tp);
          return s ? (
            <HBar
              key={i}
              label={`${b.key} pip sweep`}
              value={s.exp}
              maxAbs={maxExp(bySweepSize)}
              count={s.count}
              color={T.green}
            />
          ) : null;
        })}
      </Panel>
      <Panel style={{ gridColumn: "1 / -1" }}>
        <SectionTitle sub="Body % of sweep candle — 0=doji/wick, 1=full body breakout">
          Sweep Candle Character (Body %)
        </SectionTitle>
        {bySweepBody.map((b, i) => {
          const s = calcStats(b.trades, tp);
          return s ? (
            <HBar
              key={i}
              label={b.key}
              value={s.exp}
              maxAbs={maxExp(bySweepBody)}
              count={s.count}
              color={T.accent}
            />
          ) : null;
        })}
      </Panel>
      <Panel style={{ gridColumn: "1 / -1" }}>
        <SectionTitle sub="Did price retouch the HTF level before entry?">
          Level Retouch Before Entry
        </SectionTitle>
        {byRetouch.map((b, i) => {
          const s = calcStats(b.trades, tp);
          return s ? (
            <HBar
              key={i}
              label={b.key}
              value={s.exp}
              maxAbs={maxExp(byRetouch)}
              count={s.count}
              color={T.orange}
            />
          ) : null;
        })}
      </Panel>
    </div>
  );
}

function TabEntryTiming({ trades, tp }) {
  const byHour = useMemo(
    () =>
      sortedBuckets(
        groupBy(trades, (t) =>
          t.Hour !== undefined ? Math.floor(t.Hour) : null
        )
      ),
    [trades]
  );
  const bySession = useMemo(
    () =>
      sortedBuckets(
        groupBy(trades, (t) => t.Session || null),
        (a, b) => {
          const order = {
            Asia: 0,
            "London Open": 1,
            London: 2,
            "London/NY": 3,
            "NY Open": 4,
            NY: 5,
            Unknown: 6,
          };
          return (order[a.key] || 99) - (order[b.key] || 99);
        }
      ),
    [trades]
  );
  const byDay = useMemo(
    () =>
      sortedBuckets(
        groupBy(trades, (t) => t.DayOfWeek || null),
        (a, b) => {
          const order = {
            Mon: 0,
            Tue: 1,
            Wed: 2,
            Thu: 3,
            Fri: 4,
            Sat: 5,
            Sun: 6,
          };
          return (order[a.key] || 99) - (order[b.key] || 99);
        }
      ),
    [trades]
  );
  const byDir = useMemo(
    () => sortedBuckets(groupBy(trades, (t) => t.Dir || null)),
    [trades]
  );
  const byMode = useMemo(
    () => sortedBuckets(groupBy(trades, (t) => t.Mode || null)),
    [trades]
  );
  const byBarsToEntry = useMemo(
    () =>
      sortedBuckets(
        groupBy(trades, (t) => {
          const b = t.BarsToEntry;
          if (!b && b !== 0) return null;
          if (b <= 2) return "0-2";
          if (b <= 6) return "3-6";
          if (b <= 12) return "7-12";
          if (b <= 24) return "13-24";
          return "24+";
        })
      ),
    [trades]
  );

  const bySlippage = useMemo(
    () =>
      sortedBuckets(
        groupBy(trades, (t) => {
          const s = t.SlippagePips;
          if (s === undefined) return "No data";
          if (s <= 0) return "0 or positive";
          if (s <= 0.5) return "0-0.5 pips";
          if (s <= 1.0) return "0.5-1.0 pips";
          if (s <= 2.0) return "1.0-2.0 pips";
          return "2.0+ pips";
        })
      ),
    [trades]
  );

  const maxExp = (b) =>
    Math.max(
      ...b.map((x) => Math.abs(calcStats(x.trades, tp)?.exp || 0)),
      0.001
    );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
      <Panel style={{ gridColumn: "1 / -1" }}>
        <SectionTitle sub="Which hours generate the best expectancy? (UTC time)">
          Hour of Day
        </SectionTitle>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "0 40px",
          }}
        >
          {byHour.map((b, i) => {
            const s = calcStats(b.trades, tp);
            return s ? (
              <HBar
                key={i}
                label={`${b.key}:00`}
                value={s.exp}
                maxAbs={maxExp(byHour)}
                count={s.count}
                color={T.accent}
              />
            ) : null;
          })}
        </div>
      </Panel>
      <Panel>
        <SectionTitle sub="London Open, London, NY Open, NY, Asia">
          Session
        </SectionTitle>
        {bySession.map((b, i) => {
          const s = calcStats(b.trades, tp);
          return s ? (
            <HBar
              key={i}
              label={b.key}
              value={s.exp}
              maxAbs={maxExp(bySession)}
              count={s.count}
              color={T.yellow}
            />
          ) : null;
        })}
      </Panel>
      <Panel>
        <SectionTitle sub="Does day of week matter?">Day of Week</SectionTitle>
        {byDay.map((b, i) => {
          const s = calcStats(b.trades, tp);
          return s ? (
            <HBar
              key={i}
              label={b.key}
              value={s.exp}
              maxAbs={maxExp(byDay)}
              count={s.count}
              color={T.purple}
            />
          ) : null;
        })}
      </Panel>
      <Panel>
        <SectionTitle sub="SELL vs BUY">Direction</SectionTitle>
        {byDir.map((b, i) => {
          const s = calcStats(b.trades, tp);
          return s ? (
            <HBar
              key={i}
              label={b.key}
              value={s.exp}
              maxAbs={maxExp(byDir)}
              count={s.count}
              color={T.green}
            />
          ) : null;
        })}
      </Panel>
      <Panel>
        <SectionTitle sub="REV vs CONT">Mode</SectionTitle>
        {byMode.map((b, i) => {
          const s = calcStats(b.trades, tp);
          return s ? (
            <HBar
              key={i}
              label={b.key}
              value={s.exp}
              maxAbs={maxExp(byMode)}
              count={s.count}
              color={T.accent}
            />
          ) : null;
        })}
      </Panel>
      <Panel style={{ gridColumn: "1 / -1" }}>
        <SectionTitle sub="M5 bars between H4 confirmation and entry">
          Bars to Entry After H4 Confirmation
        </SectionTitle>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "0 40px",
          }}
        >
          {byBarsToEntry.map((b, i) => {
            const s = calcStats(b.trades, tp);
            return s ? (
              <HBar
                key={i}
                label={`${b.key} bars`}
                value={s.exp}
                maxAbs={maxExp(byBarsToEntry)}
                count={s.count}
                color={T.green}
              />
            ) : null;
          })}
        </div>
      </Panel>
      <Panel style={{ gridColumn: "1 / -1" }}>
        <SectionTitle sub="Does entry slippage predict outcome? (v4.5 FIXED model)">
          Entry Slippage Impact
        </SectionTitle>
        {bySlippage.map((b, i) => {
          const s = calcStats(b.trades, tp);
          return s ? (
            <HBar
              key={i}
              label={b.key}
              value={s.exp}
              maxAbs={maxExp(bySlippage)}
              count={s.count}
              color={T.red}
            />
          ) : null;
        })}
      </Panel>
    </div>
  );
}

function TabRegime({ trades, tp }) {
  const byVol = useMemo(
    () =>
      sortedBuckets(
        groupBy(trades, (t) => t.VolRegime || "No data"),
        (a, b) => {
          const order = {
            LOW: 0,
            NORMAL: 1,
            HIGH: 2,
            EXTREME: 3,
            "No data": 4,
          };
          return (order[a.key] || 99) - (order[b.key] || 99);
        }
      ),
    [trades]
  );

  const byTrend = useMemo(
    () =>
      sortedBuckets(
        groupBy(trades, (t) => t.H4Trend || "No data"),
        (a, b) => {
          const order = { BULL: 0, NEUTRAL: 1, BEAR: 2, "No data": 3 };
          return (order[a.key] || 99) - (order[b.key] || 99);
        }
      ),
    [trades]
  );

  const byADX = useMemo(
    () =>
      sortedBuckets(
        groupBy(trades, (t) => {
          const adx = t.ADX;
          if (!adx) return "No data";
          if (adx < 20) return "ADX <20 (weak)";
          if (adx < 40) return "ADX 20-40 (trending)";
          return "ADX >40 (strong)";
        })
      ),
    [trades]
  );

  const byMomentum = useMemo(
    () =>
      sortedBuckets(
        groupBy(trades, (t) => {
          const m = t.MomentumBefore;
          if (!m) return "No data";
          if (m < 0.5) return "Low momentum (<0.5 ATR)";
          if (m < 1.0) return "Medium (0.5-1.0 ATR)";
          return "High (>1.0 ATR)";
        })
      ),
    [trades]
  );

  const maxExp = (b) =>
    Math.max(
      ...b.map((x) => Math.abs(calcStats(x.trades, tp)?.exp || 0)),
      0.001
    );
  const hasRegime = trades.some((t) => t.VolRegime);

  if (!hasRegime)
    return (
      <Panel>
        <div style={{ color: T.yellow, fontFamily: T.mono, fontSize: 13 }}>
          ⚠️ Regime data not found.
          <br />
          <span style={{ color: T.sub }}>
            Run v4.5 EA with EnableTimeMilestones=true for full regime tracking.
          </span>
        </div>
      </Panel>
    );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
      <Panel>
        <SectionTitle sub="Volatility regime at entry (ATR percentile)">
          Volatility Regime
        </SectionTitle>
        {byVol.map((b, i) => {
          const s = calcStats(b.trades, tp);
          return s ? (
            <HBar
              key={i}
              label={b.key}
              value={s.exp}
              maxAbs={maxExp(byVol)}
              count={s.count}
              color={T.purple}
            />
          ) : null;
        })}
      </Panel>
      <Panel>
        <SectionTitle sub="H4 trend direction at entry">
          Trend Regime
        </SectionTitle>
        {byTrend.map((b, i) => {
          const s = calcStats(b.trades, tp);
          return s ? (
            <HBar
              key={i}
              label={b.key}
              value={s.exp}
              maxAbs={maxExp(byTrend)}
              count={s.count}
              color={T.green}
            />
          ) : null;
        })}
      </Panel>
      <Panel>
        <SectionTitle sub="Trend strength (ADX) at entry">
          Trend Strength
        </SectionTitle>
        {byADX.map((b, i) => {
          const s = calcStats(b.trades, tp);
          return s ? (
            <HBar
              key={i}
              label={b.key}
              value={s.exp}
              maxAbs={maxExp(byADX)}
              count={s.count}
              color={T.orange}
            />
          ) : null;
        })}
      </Panel>
      <Panel>
        <SectionTitle sub="Momentum into the sweep level">
          Pre-Sweep Momentum
        </SectionTitle>
        {byMomentum.map((b, i) => {
          const s = calcStats(b.trades, tp);
          return s ? (
            <HBar
              key={i}
              label={b.key}
              value={s.exp}
              maxAbs={maxExp(byMomentum)}
              count={s.count}
              color={T.accent}
            />
          ) : null;
        })}
      </Panel>
    </div>
  );
}

function TabPairProfiles({ trades, tp }) {
  const byPair = useMemo(() => {
    const grouped = groupBy(trades, (t) => t._pair || "UNKNOWN");
    return Object.entries(grouped)
      .map(([pair, trades]) => {
        const stats = calcStats(trades, tp);
        const curve = calcTPCurve(trades);
        const best = curve.reduce((a, b) => (b.exp > a.exp ? b : a), curve[0]);

        const targetTrades = trades.filter(
          (t) => t.TargetR !== undefined && !isNaN(t.TargetR)
        );
        const avgTargetR =
          targetTrades.length > 0
            ? targetTrades.reduce((a, t) => a + parseFloat(t.TargetR), 0) /
              targetTrades.length
            : 0;

        return {
          pair,
          trades,
          stats,
          best,
          avgTargetR,
          hasProfile: avgTargetR > 0,
        };
      })
      .sort((a, b) => (b.stats?.exp || 0) - (a.stats?.exp || 0));
  }, [trades, tp]);

  const maxExp = Math.max(
    ...byPair.map((p) => Math.abs(p.stats?.exp || 0)),
    0.001
  );

  if (byPair.length === 0) {
    return (
      <Panel>
        <div style={{ color: T.sub, fontFamily: T.mono }}>
          No pair data available
        </div>
      </Panel>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
      {byPair.map((p) => (
        <Panel
          key={p.pair}
          style={{ borderColor: p.stats?.exp > 0 ? T.green : T.red }}
        >
          <SectionTitle
            sub={`${p.trades.length} trades${
              p.hasProfile
                ? ` | Profile Target: ${p.avgTargetR.toFixed(1)}R`
                : ""
            }`}
          >
            {p.pair} {p.hasProfile && "🎯"}
          </SectionTitle>

          <div
            style={{
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
              marginBottom: 12,
            }}
          >
            <StatCard
              label="Expectancy"
              value={
                (p.stats?.exp >= 0 ? "+" : "") +
                (p.stats?.exp || 0).toFixed(3) +
                "R"
              }
              color={p.stats?.exp > 0 ? T.green : T.red}
            />
            <StatCard
              label="Win Rate"
              value={((p.stats?.wr || 0) * 100).toFixed(1) + "%"}
              color={
                p.stats?.wr > 0.4
                  ? T.green
                  : p.stats?.wr > 0.3
                  ? T.yellow
                  : T.red
              }
            />
            <StatCard
              label="Optimal TP"
              value={p.best?.r + "R"}
              color={T.accent}
              sub={
                p.hasProfile
                  ? `vs ${p.avgTargetR.toFixed(1)}R target`
                  : "no profile"
              }
            />
          </div>

          <HBar
            label="Performance"
            value={p.stats?.exp || 0}
            maxAbs={maxExp}
            count={p.trades.length}
            color={p.stats?.exp > 0 ? T.green : T.red}
          />

          {p.hasProfile &&
            p.best &&
            Math.abs(p.best.r - p.avgTargetR) > 1.0 && (
              <div
                style={{
                  marginTop: 8,
                  padding: "6px 10px",
                  background: T.panelAlt,
                  borderRadius: 4,
                  fontSize: 11,
                  color: T.yellow,
                  fontFamily: T.mono,
                }}
              >
                ⚠️ Gap: Target {p.avgTargetR.toFixed(1)}R vs optimal {p.best.r}R
                ({(p.best.exp - (p.stats?.exp || 0)).toFixed(3)}R diff)
              </div>
            )}
        </Panel>
      ))}
    </div>
  );
}

function TabParamLab({ trades, tp, labFilters, setLabFilters }) {
  const lf = labFilters;
  const set = (key, val) => setLabFilters((prev) => ({ ...prev, [key]: val }));

  const allSessions = useMemo(
    () => [...new Set(trades.map((t) => t.Session).filter(Boolean))],
    [trades]
  );
  const allDirs = useMemo(
    () => [...new Set(trades.map((t) => t.Dir).filter(Boolean))],
    [trades]
  );
  const allModes = useMemo(
    () => [...new Set(trades.map((t) => t.Mode).filter(Boolean))],
    [trades]
  );
  const allTrends = useMemo(
    () => [...new Set(trades.map((t) => t.H4Trend).filter(Boolean))],
    [trades]
  );
  const allVols = useMemo(
    () => [...new Set(trades.map((t) => t.VolRegime).filter(Boolean))],
    [trades]
  );

  const stats = useMemo(() => calcStats(trades, tp), [trades, tp]);
  const curve = useMemo(
    () => (trades.length > 0 ? calcTPCurve(trades) : []),
    [trades]
  );
  const bestCurve =
    curve.length > 0
      ? curve.reduce((a, b) => (b.exp > a.exp ? b : a), curve[0])
      : null;

  const expColor = stats
    ? stats.exp > 0.15
      ? T.green
      : stats.exp > 0
      ? T.yellow
      : T.red
    : T.sub;

  const SliderRow = ({ label, val, min, max, step = 1, onChange, sub }) => (
    <div style={{ marginBottom: 14 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 4,
        }}
      >
        <span style={{ color: T.text, fontSize: 12, fontFamily: T.mono }}>
          {label}
        </span>
        <span
          style={{
            color: T.accent,
            fontSize: 12,
            fontFamily: T.mono,
            fontWeight: 700,
          }}
        >
          {val}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={val}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: "100%", accentColor: T.accent }}
      />
      {sub && (
        <div
          style={{
            color: T.sub,
            fontSize: 10,
            fontFamily: T.mono,
            marginTop: 2,
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 20 }}>
      <div>
        <Panel style={{ marginBottom: 16 }}>
          <SectionTitle>Pool Filters</SectionTitle>
          <SliderRow
            label="Min Touches"
            val={lf.minTouches}
            min={2}
            max={8}
            onChange={(v) => set("minTouches", v)}
            sub="Minimum H4 touches to qualify"
          />
          <SliderRow
            label="Max Touches"
            val={lf.maxTouches}
            min={2}
            max={12}
            onChange={(v) => set("maxTouches", v)}
          />
          <SliderRow
            label="Min Pool Age (H4)"
            val={lf.minAge}
            min={0}
            max={100}
            step={5}
            onChange={(v) => set("minAge", v)}
            sub="firstBarAgo minimum"
          />
          <SliderRow
            label="Max Pool Age (H4)"
            val={lf.maxAge}
            min={50}
            max={400}
            step={10}
            onChange={(v) => set("maxAge", v)}
          />
          <SliderRow
            label="Min Sweep (pips)"
            val={lf.minSweep}
            min={0}
            max={50}
            step={2}
            onChange={(v) => set("minSweep", v)}
            sub="Minimum sweep size beyond level"
          />
          <SliderRow
            label="Max Sweep (pips)"
            val={lf.maxSweep}
            min={10}
            max={200}
            step={5}
            onChange={(v) => set("maxSweep", v)}
          />
          <SliderRow
            label="Min Stop (pips)"
            val={lf.minStop}
            min={0}
            max={100}
            step={5}
            onChange={(v) => set("minStop", v)}
            sub="Filter out tiny stops"
          />
          <SliderRow
            label="Max Stop (pips)"
            val={lf.maxStop}
            min={50}
            max={500}
            step={10}
            onChange={(v) => set("maxStop", v)}
          />
        </Panel>
        <Panel style={{ marginBottom: 16 }}>
          <SectionTitle>Time Filters</SectionTitle>
          <SliderRow
            label="From Hour (UTC)"
            val={lf.minHour}
            min={0}
            max={23}
            onChange={(v) => set("minHour", v)}
          />
          <SliderRow
            label="To Hour (UTC)"
            val={lf.maxHour}
            min={0}
            max={23}
            onChange={(v) => set("maxHour", v)}
          />
          <div style={{ marginBottom: 10 }}>
            <div
              style={{
                color: T.sub,
                fontSize: 10,
                fontFamily: T.mono,
                marginBottom: 6,
                textTransform: "uppercase",
              }}
            >
              Sessions
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {allSessions.map((s) => (
                <Pill
                  key={s}
                  label={s}
                  active={lf.sessFilter.includes(s)}
                  onClick={() =>
                    set(
                      "sessFilter",
                      lf.sessFilter.includes(s)
                        ? lf.sessFilter.filter((x) => x !== s)
                        : [...lf.sessFilter, s]
                    )
                  }
                  color={T.yellow}
                />
              ))}
            </div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <div
              style={{
                color: T.sub,
                fontSize: 10,
                fontFamily: T.mono,
                marginBottom: 6,
                textTransform: "uppercase",
              }}
            >
              Direction
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              {allDirs.map((d) => (
                <Pill
                  key={d}
                  label={d}
                  active={lf.dirFilter.includes(d)}
                  onClick={() =>
                    set(
                      "dirFilter",
                      lf.dirFilter.includes(d)
                        ? lf.dirFilter.filter((x) => x !== d)
                        : [...lf.dirFilter, d]
                    )
                  }
                  color={T.green}
                />
              ))}
            </div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <div
              style={{
                color: T.sub,
                fontSize: 10,
                fontFamily: T.mono,
                marginBottom: 6,
                textTransform: "uppercase",
              }}
            >
              Mode
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              {allModes.map((m) => (
                <Pill
                  key={m}
                  label={m}
                  active={lf.modeFilter.includes(m)}
                  onClick={() =>
                    set(
                      "modeFilter",
                      lf.modeFilter.includes(m)
                        ? lf.modeFilter.filter((x) => x !== m)
                        : [...lf.modeFilter, m]
                    )
                  }
                  color={T.purple}
                />
              ))}
            </div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <div
              style={{
                color: T.sub,
                fontSize: 10,
                fontFamily: T.mono,
                marginBottom: 6,
                textTransform: "uppercase",
              }}
            >
              Trend
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              {allTrends.map((t) => (
                <Pill
                  key={t}
                  label={t}
                  active={lf.trendFilter.includes(t)}
                  onClick={() =>
                    set(
                      "trendFilter",
                      lf.trendFilter.includes(t)
                        ? lf.trendFilter.filter((x) => x !== t)
                        : [...lf.trendFilter, t]
                    )
                  }
                  color={T.accent}
                />
              ))}
            </div>
          </div>
          <div>
            <div
              style={{
                color: T.sub,
                fontSize: 10,
                fontFamily: T.mono,
                marginBottom: 6,
                textTransform: "uppercase",
              }}
            >
              Volatility
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              {allVols.map((v) => (
                <Pill
                  key={v}
                  label={v}
                  active={lf.volFilter.includes(v)}
                  onClick={() =>
                    set(
                      "volFilter",
                      lf.volFilter.includes(v)
                        ? lf.volFilter.filter((x) => x !== v)
                        : [...lf.volFilter, v]
                    )
                  }
                  color={T.orange}
                />
              ))}
            </div>
          </div>
        </Panel>
        <button
          onClick={() => setLabFilters(LAB_DEFAULTS)}
          style={{
            width: "100%",
            background: T.panelAlt,
            border: `1px solid ${T.border}`,
            color: T.sub,
            padding: "8px",
            borderRadius: 6,
            cursor: "pointer",
            fontFamily: T.mono,
            fontSize: 12,
          }}
        >
          Reset All Filters
        </button>
      </div>

      <div>
        <Panel style={{ marginBottom: 16 }}>
          <SectionTitle
            sub={`${trades.length} trades with current lab filters`}
          >
            Live Results
          </SectionTitle>
          {stats ? (
            <div>
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  flexWrap: "wrap",
                  marginBottom: 16,
                }}
              >
                <StatCard label="Trades" value={stats.count} />
                <StatCard
                  label="Expectancy"
                  value={
                    (stats.exp >= 0 ? "+" : "") + stats.exp.toFixed(4) + "R"
                  }
                  color={expColor}
                />
                <StatCard
                  label="Win Rate"
                  value={(stats.wr * 100).toFixed(1) + "%"}
                  color={
                    stats.wr >= 0.35
                      ? T.green
                      : stats.wr >= 0.25
                      ? T.yellow
                      : T.red
                  }
                />
                <StatCard
                  label="Total R"
                  value={
                    (stats.totalR >= 0 ? "+" : "") +
                    stats.totalR.toFixed(1) +
                    "R"
                  }
                  color={stats.totalR >= 0 ? T.green : T.red}
                />
                {bestCurve && (
                  <StatCard
                    label="Optimal TP"
                    value={bestCurve.r + "R"}
                    color={T.green}
                    sub={`+${bestCurve.exp.toFixed(4)}R expectancy`}
                  />
                )}
              </div>
              <div
                style={{
                  background: T.panelAlt,
                  borderRadius: 6,
                  padding: "12px 16px",
                  fontFamily: T.mono,
                  fontSize: 12,
                }}
              >
                <div
                  style={{ color: expColor, fontWeight: 700, marginBottom: 4 }}
                >
                  {stats.exp > 0.2 && "🟢 Strong edge with these parameters"}
                  {stats.exp > 0.1 &&
                    stats.exp <= 0.2 &&
                    "🟡 Moderate edge — keep refining"}
                  {stats.exp > 0 &&
                    stats.exp <= 0.1 &&
                    "🟠 Marginal edge — look for tighter filters"}
                  {stats.exp <= 0 &&
                    "🔴 Negative expectancy with these parameters"}
                </div>
              </div>
            </div>
          ) : (
            <div style={{ color: T.sub, fontFamily: T.mono }}>
              No trades match current filters
            </div>
          )}
        </Panel>

        {curve.length > 0 && (
          <Panel>
            <SectionTitle sub="Complete TP optimisation on filtered trades">
              TP Sensitivity (Filtered)
            </SectionTitle>
            {curve
              .filter(
                (c) =>
                  MILESTONES.indexOf(c.r) % 2 === 1 ||
                  c.r === bestCurve?.r ||
                  c.r === tp
              )
              .map((c) => (
                <div
                  key={c.r}
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                    marginBottom: 8,
                    fontFamily: T.mono,
                    fontSize: 12,
                  }}
                >
                  <span style={{ color: T.sub, width: 40 }}>{c.r}R</span>
                  <span
                    style={{ color: c.exp > 0 ? T.green : T.red, width: 90 }}
                  >
                    {c.exp >= 0 ? "+" : ""}
                    {c.exp.toFixed(4)}R
                  </span>
                  <span style={{ color: T.text, width: 70 }}>
                    WR {(c.wr * 100).toFixed(1)}%
                  </span>
                  <span style={{ color: T.sub }}>
                    wins={c.wins} losses={c.losses}
                  </span>
                  {c.r === tp && (
                    <span style={{ color: T.accent }}>← current</span>
                  )}
                  {bestCurve && c.r === bestCurve.r && (
                    <span style={{ color: T.green }}>★ best</span>
                  )}
                </div>
              ))}
          </Panel>
        )}
      </div>
    </div>
  );
}

// ── EXPORT FUNCTION ───────────────────────────────────────────────────────────
function buildExportData(
  allTrades,
  filtered,
  tp,
  fileNames,
  modeFilter,
  pairFilter
) {
  const isMilestone = filtered.some(hasMilestoneData);
  const overall = calcStats(filtered, tp);
  const tpCurve = calcTPCurve(filtered);
  const bestTP = tpCurve.reduce((a, b) => (b.exp > a.exp ? b : a), tpCurve[0]);

  const pairMap = groupBy(filtered, (t) => t._pair);
  const perPair = {};
  Object.entries(pairMap).forEach(([pair, trades]) => {
    const s = calcStats(trades, tp);
    const curve = calcTPCurve(trades);
    const best = curve.reduce((a, b) => (b.exp > a.exp ? b : a), curve[0]);
    perPair[pair] = {
      count: s?.count || 0,
      exp: s?.exp || 0,
      wr: s?.wr || 0,
      tpWr: s?.tpWr || 0,
      totalR: s?.totalR || 0,
      tpHits: s?.tpHits || 0,
      slHits: s?.slHits || 0,
      expired: s?.expired || 0,
      bestTP: best.r,
      bestTPExp: best.exp,
      tpCurve: curve.map((c) => ({
        r: c.r,
        exp: +c.exp.toFixed(4),
        wr: +(c.wr * 100).toFixed(1),
        tpHits: c.tpHits,
        slHits: c.slHits,
        totalR: +c.totalR.toFixed(1),
      })),
    };
  });

  const modeMap = groupBy(filtered, (t) => t.Mode);
  const perMode = {};
  Object.entries(modeMap).forEach(([mode, trades]) => {
    const s = calcStats(trades, tp);
    const curve = calcTPCurve(trades);
    const best = curve.reduce((a, b) => (b.exp > a.exp ? b : a), curve[0]);
    perMode[mode] = {
      count: s?.count || 0,
      exp: s?.exp || 0,
      wr: s?.wr || 0,
      totalR: s?.totalR || 0,
      bestTP: best.r,
      bestTPExp: best.exp,
      tpCurve: curve.map((c) => ({
        r: c.r,
        exp: +c.exp.toFixed(4),
        wr: +(c.wr * 100).toFixed(1),
        tpHits: c.tpHits,
        slHits: c.slHits,
        totalR: +c.totalR.toFixed(1),
      })),
    };
  });

  const yearMap = groupBy(filtered, (t) => t.Year);
  const perYear = {};
  Object.entries(yearMap)
    .sort(([a], [b]) => a - b)
    .forEach(([yr, trades]) => {
      const s = calcStats(trades, tp);
      perYear[yr] = {
        count: s?.count || 0,
        exp: s?.exp || 0,
        wr: s?.wr || 0,
        totalR: s?.totalR || 0,
      };
    });

  const bucketStats = (keyFn) => {
    const map = groupBy(filtered, keyFn);
    const out = {};
    Object.entries(map).forEach(([k, trades]) => {
      const s = calcStats(trades, tp);
      out[k] = { count: s?.count || 0, exp: s?.exp || 0, wr: s?.wr || 0 };
    });
    return out;
  };

  return {
    _meta: {
      exported: new Date().toISOString(),
      version: "v4.5",
      files: fileNames,
      filters: { mode: modeFilter, pair: pairFilter, tp },
      hasMilestoneData: isMilestone,
      totalTrades: allTrades.length,
      filteredTrades: filtered.length,
    },
    overall: {
      count: overall?.count || 0,
      exp: overall?.exp || 0,
      wr: overall?.wr || 0,
      tpWr: overall?.tpWr || 0,
      totalR: overall?.totalR || 0,
      tpHits: overall?.tpHits || 0,
      slHits: overall?.slHits || 0,
      expired: overall?.expired || 0,
      bestTP: bestTP.r,
      bestTPExp: bestTP.exp,
    },
    tpCurve: tpCurve.map((c) => ({
      r: c.r,
      exp: +c.exp.toFixed(4),
      wr: +(c.wr * 100).toFixed(1),
      tpWr: +(c.tpWr * 100).toFixed(1),
      tpHits: c.tpHits,
      slHits: c.slHits,
      expired: c.expired,
      totalR: +c.totalR.toFixed(1),
    })),
    perPair,
    perMode,
    perYear,
    poolQuality: {
      byTouches: bucketStats((t) =>
        t.TouchCount
          ? t.TouchCount >= 6
            ? "6+"
            : String(Math.round(t.TouchCount))
          : null
      ),
      byAge: bucketStats((t) => {
        const a = t.PoolAge;
        if (!a) return null;
        if (a <= 20) return "0-20";
        if (a <= 50) return "21-50";
        if (a <= 100) return "51-100";
        if (a <= 200) return "101-200";
        return "200+";
      }),
      bySweep: bucketStats((t) => {
        const s = t.SweepSizePips;
        if (!s) return null;
        if (s <= 5) return "0-5";
        if (s <= 15) return "6-15";
        if (s <= 30) return "16-30";
        if (s <= 60) return "31-60";
        return "60+";
      }),
      byRetouch: bucketStats((t) => {
        const r = t.BarsToLevelRetouch;
        if (r === undefined) return null;
        if (r < 0) return "No retouch";
        if (r <= 2) return "0-2";
        if (r <= 6) return "3-6";
        return "6+";
      }),
    },
    timing: {
      bySession: bucketStats((t) => t.Session || null),
      byDay: bucketStats((t) => t.DayOfWeek || null),
      byDir: bucketStats((t) => t.Dir || null),
    },
    regime: {
      byVol: bucketStats((t) => t.VolRegime || null),
      byTrend: bucketStats((t) => t.H4Trend || null),
      byADX: bucketStats((t) => {
        const adx = t.ADX;
        if (!adx) return null;
        if (adx < 20) return "weak";
        if (adx < 40) return "trending";
        return "strong";
      }),
      byMomentum: bucketStats((t) => {
        const m = t.MomentumBefore;
        if (!m) return null;
        if (m < 0.5) return "low";
        if (m < 1.0) return "medium";
        return "high";
      }),
    },
  };
}

const LAB_DEFAULTS = {
  minTouches: 2,
  maxTouches: 10,
  minAge: 10,
  maxAge: 400,
  minSweep: 0,
  maxSweep: 200,
  minStop: 0,
  maxStop: 500,
  minHour: 0,
  maxHour: 23,
  sessFilter: [],
  dirFilter: [],
  modeFilter: [],
  trendFilter: [],
  volFilter: [],
};

function isLabActive(lf) {
  return JSON.stringify(lf) !== JSON.stringify(LAB_DEFAULTS);
}

function applyLabFilters(trades, lf) {
  return trades.filter((t) => {
    if (
      t.TouchCount &&
      (t.TouchCount < lf.minTouches || t.TouchCount > lf.maxTouches)
    )
      return false;
    if (t.PoolAge && (t.PoolAge < lf.minAge || t.PoolAge > lf.maxAge))
      return false;
    if (
      t.SweepSizePips !== undefined &&
      (t.SweepSizePips < lf.minSweep || t.SweepSizePips > lf.maxSweep)
    )
      return false;
    if (
      t.StopSizePips !== undefined &&
      (t.StopSizePips < lf.minStop || t.StopSizePips > lf.maxStop)
    )
      return false;
    if (t.Hour !== undefined && (t.Hour < lf.minHour || t.Hour > lf.maxHour))
      return false;
    if (lf.sessFilter.length && !lf.sessFilter.includes(t.Session))
      return false;
    if (lf.dirFilter.length && !lf.dirFilter.includes(t.Dir)) return false;
    if (lf.modeFilter.length && !lf.modeFilter.includes(t.Mode)) return false;
    if (lf.trendFilter.length && !lf.trendFilter.includes(t.H4Trend))
      return false;
    if (lf.volFilter.length && !lf.volFilter.includes(t.VolRegime))
      return false;
    return true;
  });
}

// ── MAIN APP ──────────────────────────────────────────────────────────────────
const TABS = [
  { id: 0, label: "Overview", icon: "📊" },
  { id: 1, label: "TP Curve", icon: "📈" },
  { id: 2, label: "Pool Quality", icon: "🎯" },
  { id: 3, label: "Entry Timing", icon: "⏰" },
  { id: 4, label: "Regime", icon: "🌊" },
  { id: 5, label: "Pair Profiles", icon: "💱" },
  { id: 6, label: "Parameter Lab", icon: "🔬" },
  { id: 7, label: "Portfolio Sim", icon: "💰" }, // NEW
  { id: 8, label: "Psych Fit", icon: "🧠" }, // NEW
  { id: 9, label: "Pair Optimizer", icon: "🎯" }, // NEW
];

export default function App() {
  const [allTrades, setAllTrades] = useState([]);
  const [fileNames, setFileNames] = useState([]);
  const [tab, setTab] = useState(0);
  const [tp, setTp] = useState(2.0);
  const [modeFilter, setModeFilter] = useState("ALL");
  const [pairFilter, setPairFilter] = useState("ALL");
  const [exportJSON, setExportJSON] = useState(null);
  const [copied, setCopied] = useState(false);
  const [labFilters, setLabFilters] = useState(LAB_DEFAULTS);
  const [pairProfiles, setPairProfiles] = useState(() => initPairProfiles());
  const [exporting, setExporting] = useState(false);
  const [pendingTab, setPendingTab] = useState(null);

  // Debounced tab switch
  const handleTabChange = useCallback((newTab) => {
    setPendingTab(newTab);
    setTimeout(() => setTab(newTab), 50); // 50ms delay lets UI update
  }, []);

  const processFiles = useCallback(async (files) => {
    const newTrades = [];
    const names = [];
    for (const file of files) {
      const text = await file.text();
      const rows = parseCSV(text);
      const name = file.name.replace(".csv", "");
      const isRev = name.toLowerCase().startsWith("rev");
      const pair = (name.match(/[A-Z]{6}/) || ["UNKNOWN"])[0];
      rows.forEach((t) => {
        if (!t.Mode) t.Mode = isRev ? "REV" : "CONT";
        t._pair = pair;
        t._file = name;
      });
      newTrades.push(...rows);
      names.push(name);
    }
    setAllTrades((p) => [...p, ...newTrades]);
    setFileNames((p) => [...p, ...names]);
  }, []);

  const pairs = useMemo(
    () => ["ALL", ...new Set(allTrades.map((t) => t._pair))],
    [allTrades]
  );

  const filtered = useMemo(() => {
    let trades = allTrades.filter((t) => {
      if (modeFilter !== "ALL" && t.Mode !== modeFilter) return false;
      if (pairFilter !== "ALL" && t._pair !== pairFilter) return false;
      return true;
    });
    if (isLabActive(labFilters)) trades = applyLabFilters(trades, labFilters);
    return trades;
  }, [allTrades, modeFilter, pairFilter, labFilters]);

  const handleExport = useCallback(async () => {
    setExporting(true);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const data = buildExportData(
      allTrades,
      filtered,
      tp,
      fileNames,
      modeFilter,
      pairFilter
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    setExportJSON(JSON.stringify(data, null, 2));
    setCopied(false);
    setExporting(false);
  }, [allTrades, filtered, tp, fileNames, modeFilter, pairFilter]);

  // ============================================
  // CSV LOAD HANDLER - Auto-import to pair profiles
  // ============================================
  useEffect(() => {
    if (allTrades.length > 0) {
      // Initialize pair profiles from localStorage
      const profiles = initPairProfiles();

      // Group trades by pair
      const byPair = groupBy(allTrades, (t) => t._pair || "UNKNOWN");

      // Auto-import backtest data for each pair with sufficient trades
      Object.entries(byPair).forEach(([pair, pairTrades]) => {
        if (pairTrades.length >= 10) {
          const { profiles: updated } = importBacktestToProfile(
            profiles,
            pair,
            pairTrades
          );
          console.log(`✅ Imported ${pairTrades.length} trades for ${pair}`);
        }
      });

      // Run psychological stress test on current 20R strategy
      const conservativeProfile = PSYCHOLOGICAL_PROFILES.conservative;
      const currentConfig = {
        tpLevel: 20,
        partialClose: 0,
        trailingStop: 0,
        useBreakeven: false,
      };
      const stressResult = psychologicalStressTest(
        allTrades,
        conservativeProfile,
        currentConfig
      );
      console.log(
        "🧠 Abandonment Risk:",
        stressResult.abandonmentRisk.toFixed(1) + "%"
      );
      console.log("📊 Verdict:", stressResult.psychologicalVerdict);
    }
  }, [allTrades]); // Runs whenever new CSV data is loaded

  return (
    <div
      style={{
        background: T.bg,
        minHeight: "100vh",
        color: T.text,
        padding: 24,
        fontFamily: T.mono,
      }}
    >
      <div style={{ marginBottom: 20 }}>
        <div
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: T.accent,
            letterSpacing: "0.04em",
            marginBottom: 4,
          }}
        >
          ⚡ LIQUIDITY SWEEP RESEARCH ENGINE v4.5
        </div>
        <div style={{ color: T.sub, fontSize: 11 }}>
          FIXED execution model — Plan never changes, costs are subtracted —
          datetime timestamps for exact TP optimisation
        </div>
      </div>

      <DropZone
        onFiles={processFiles}
        fileNames={fileNames}
        totalTrades={allTrades.length}
      />

      {exportJSON && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.8)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 40,
          }}
          onClick={() => setExportJSON(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: T.panel,
              border: `1px solid ${T.accent}`,
              borderRadius: 12,
              padding: 24,
              width: "100%",
              maxWidth: 700,
              maxHeight: "80vh",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 16,
              }}
            >
              <div>
                <div
                  style={{
                    color: T.accent,
                    fontSize: 14,
                    fontWeight: 700,
                    fontFamily: T.mono,
                  }}
                >
                  📊 Snapshot Export
                </div>
                <div
                  style={{
                    color: T.sub,
                    fontSize: 11,
                    fontFamily: T.mono,
                    marginTop: 4,
                  }}
                >
                  Copy this JSON for external analysis
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => {
                    navigator.clipboard
                      .writeText(exportJSON)
                      .then(() => setCopied(true))
                      .catch(() => {
                        const ta = document.getElementById("_export_ta");
                        if (ta) {
                          ta.select();
                          document.execCommand("copy");
                          setCopied(true);
                        }
                      });
                  }}
                  style={{
                    background: copied ? T.green : T.accent,
                    color: T.bg,
                    border: "none",
                    borderRadius: 4,
                    padding: "6px 16px",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 700,
                    fontFamily: T.mono,
                    transition: "background 0.2s",
                  }}
                >
                  {copied ? "✅ Copied!" : "📋 Copy All"}
                </button>
                <button
                  onClick={() => setExportJSON(null)}
                  style={{
                    background: "transparent",
                    color: T.sub,
                    border: `1px solid ${T.border}`,
                    borderRadius: 4,
                    padding: "6px 12px",
                    cursor: "pointer",
                    fontSize: 12,
                    fontFamily: T.mono,
                  }}
                >
                  Close
                </button>
              </div>
            </div>
            <textarea
              id="_export_ta"
              readOnly
              value={exportJSON}
              style={{
                flex: 1,
                minHeight: 300,
                background: T.bg,
                color: T.text,
                border: `1px solid ${T.border}`,
                borderRadius: 6,
                padding: 12,
                fontFamily: T.mono,
                fontSize: 11,
                resize: "vertical",
                lineHeight: 1.4,
              }}
            />
            <div
              style={{
                color: T.sub,
                fontSize: 10,
                fontFamily: T.mono,
                marginTop: 8,
              }}
            >
              {(exportJSON.length / 1024).toFixed(1)} KB — contains TP curves,
              per-pair stats, pool quality, timing, and regime breakdowns
            </div>
          </div>
        </div>
      )}

      {allTrades.length > 0 && (
        <>
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              alignItems: "center",
              marginBottom: 20,
            }}
          >
            <span style={{ color: T.sub, fontSize: 11 }}>MODE:</span>
            {["ALL", "REV", "CONT"].map((m) => (
              <Pill
                key={m}
                label={m}
                active={modeFilter === m}
                onClick={() => setModeFilter(m)}
              />
            ))}
            <div
              style={{
                width: 1,
                height: 20,
                background: T.border,
                margin: "0 4px",
              }}
            />
            <span style={{ color: T.sub, fontSize: 11 }}>PAIR:</span>
            {pairs.map((p) => (
              <Pill
                key={p}
                label={p}
                active={pairFilter === p}
                onClick={() => setPairFilter(p)}
                color={T.yellow}
              />
            ))}
            <div
              style={{
                width: 1,
                height: 20,
                background: T.border,
                margin: "0 4px",
              }}
            />
            <span style={{ color: T.sub, fontSize: 11 }}>TP:</span>
            {[
              1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 5.0, 6.0, 8.0, 10.0, 15.0,
              20.0,
            ].map((t) => (
              <Pill
                key={t}
                label={t + "R"}
                active={tp === t}
                onClick={() => setTp(t)}
                color={T.green}
              />
            ))}
            <button
              onClick={handleExport}
              disabled={exporting}
              style={{
                marginLeft: "auto",
                background: exporting ? T.border : T.panelAlt,
                color: exporting ? T.sub : T.accent,
                border: `1px solid ${exporting ? T.border : T.accent}`,
                borderRadius: 4,
                padding: "4px 12px",
                cursor: exporting ? "wait" : "pointer",
                fontSize: 11,
                fontFamily: T.mono,
              }}
            >
              {exporting ? "⏳ Building..." : "📊 Export Snapshot"}
            </button>
            <button
              onClick={() => {
                setAllTrades([]);
                setFileNames([]);
              }}
              style={{
                background: "transparent",
                color: T.red,
                border: `1px solid ${T.red}`,
                borderRadius: 4,
                padding: "4px 12px",
                cursor: "pointer",
                fontSize: 11,
                fontFamily: T.mono,
              }}
            >
              Clear
            </button>
          </div>
          <div
            style={{
              display: "flex",
              gap: 4,
              marginBottom: 20,
              borderBottom: `1px solid ${T.border}`,
              paddingBottom: 0,
            }}
          >
            {TABS.map((t, i) => (
              <button
                key={i}
                onClick={() => handleTabChange(i)}
                style={{
                  fontFamily: T.mono,
                  fontSize: 12,
                  fontWeight: 700,
                  padding: "8px 16px",
                  cursor: "pointer",
                  border: "none",
                  borderBottom: `2px solid ${
                    pendingTab === i || tab === i ? T.accent : "transparent"
                  }`,
                  opacity: pendingTab !== null && pendingTab !== i ? 0.5 : 1,
                  background: "transparent",
                  color: tab === i ? T.accent : T.sub,
                  transition: "all 0.15s",
                }}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>
          {isLabActive(labFilters) && (
            <div
              style={{
                background: "rgba(167,139,250,0.08)",
                border: `1px solid ${T.purple}`,
                borderRadius: 6,
                padding: "8px 14px",
                marginBottom: 16,
                fontFamily: T.mono,
                fontSize: 11,
                color: T.purple,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>
                🔬 Lab filters active — {filtered.length}/{allTrades.length}{" "}
                trades (
                {((filtered.length / allTrades.length) * 100).toFixed(0)}%)
              </span>
              <button
                onClick={() => setLabFilters(LAB_DEFAULTS)}
                style={{
                  background: "transparent",
                  border: `1px solid ${T.purple}`,
                  color: T.purple,
                  borderRadius: 4,
                  padding: "2px 10px",
                  cursor: "pointer",
                  fontSize: 10,
                  fontFamily: T.mono,
                }}
              >
                Reset
              </button>
            </div>
          )}
          <LazyTab active={tab === 0}>
            <TabOverview trades={filtered} tp={tp} />
          </LazyTab>
          <LazyTab active={tab === 1}>
            <TabTPCurve trades={filtered} tp={tp} />
          </LazyTab>
          <LazyTab active={tab === 2}>
            <TabPoolQuality trades={filtered} tp={tp} />
          </LazyTab>
          <LazyTab active={tab === 3}>
            <TabEntryTiming trades={filtered} tp={tp} />
          </LazyTab>
          <LazyTab active={tab === 4}>
            <TabRegime trades={filtered} tp={tp} />
          </LazyTab>
          <LazyTab active={tab === 5}>
            <TabPairProfiles trades={filtered} tp={tp} />
          </LazyTab>
          <LazyTab active={tab === 6}>
            <TabParamLab
              trades={filtered}
              tp={tp}
              labFilters={labFilters}
              setLabFilters={setLabFilters}
            />
          </LazyTab>
          <LazyTab active={tab === 7}>
            <TabPortfolioSimulator trades={filtered} T={T} />
          </LazyTab>
          <LazyTab active={tab === 8}>
            <TabPsychologicalFit trades={filtered} T={T} />
          </LazyTab>
          <LazyTab active={tab === 9}>
            <TabPairOptimizer trades={filtered} T={T} />
          </LazyTab>
        </>
      )}

      {allTrades.length === 0 && (
        <div
          style={{
            textAlign: "center",
            padding: "60px 20px",
            color: T.sub,
            fontSize: 12,
            lineHeight: 2,
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
          <div>
            Run{" "}
            <span style={{ color: T.accent }}>LiquidityEngine_v4.5.mq5</span> —
            ValidationMode=true for backtesting, =false for live
          </div>
          <div>Then drop the CSV files here to start the analysis.</div>
          <div style={{ marginTop: 8, color: T.green, fontSize: 11 }}>
            ✅ v4.5 features: FIXED execution (plan never changes), 40 R-levels
            (0.5R→20R), realistic cost simulation, regime detection
          </div>
          <div style={{ marginTop: 4, color: T.yellow, fontSize: 11 }}>
            ⚠️ Also backwards-compatible with v3 and v4.0/4.1/4.2 data
          </div>
          <div style={{ marginTop: 12, color: T.border, fontSize: 10 }}>
            Expected v4.5 cols: Date, Hour, Dir, Mode, Entry, Fill, Stop, TP,
            TargetR,
            <br />
            TimeTo0_5R ... TimeTo20R, TimeToSL, TimeToFill,
            TimeTo30Min...TimeTo24H,
            <br />
            H4Trend, VolRegime, ATRPercentile, ADX, MomentumBefore,
            SlippagePips, FillLatencyMs, Mode, SimSlippage, SpreadCost + more
          </div>
        </div>
      )}
    </div>
  );
}
