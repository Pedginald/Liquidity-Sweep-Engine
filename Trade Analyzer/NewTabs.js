/**
 * New Tabs v4.6
 * TabPortfolioSimulator (Tab 7) and TabPsychologicalFit (Tab 8)
 */

import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from "react";
import { simulateEquityCurve, compareTPscenarios } from "./equitySimulator";
import {
  psychologicalStressTest,
  PSYCHOLOGICAL_PROFILES,
  compareScenarios,
  getOptimalPsychologicalConfig,
} from "./psychologicalStressTest";
import {
  initPairProfiles,
  getPairProfile,
  updatePairProfile,
  importBacktestToProfile,
  optimizePairProfile,
} from "./pairProfileManager";

// ============================================
// SAFE NUMBER FORMATTER - ADD THIS HERE
// ============================================
const safeFixed = (val, digits = 2) => {
  if (
    val === undefined ||
    val === null ||
    isNaN(val) ||
    typeof val !== "number"
  ) {
    return "—";
  }
  return val.toFixed(digits);
};

const safePercent = (val, digits = 1) => {
  if (
    val === undefined ||
    val === null ||
    isNaN(val) ||
    typeof val !== "number"
  ) {
    return "—%";
  }
  return val.toFixed(digits) + "%";
};

// ============================================
// TAB 7: PORTFOLIO SIMULATOR
// ============================================

export function TabPortfolioSimulator({ trades, T }) {
  const [profiles, setProfiles] = useState(() => initPairProfiles());
  const [selectedPair, setSelectedPair] = useState("ALL");
  const [initialBalance, setInitialBalance] = useState(10000);
  const [riskPerTrade, setRiskPerTrade] = useState(1); // percent
  const [useCompounding, setUseCompounding] = useState(true);
  const [activeConfig, setActiveConfig] = useState(null);
  const [simulationResults, setSimulationResults] = useState(null);
  const canvasRef = useRef(null);

  // Get unique pairs from trades
  const availablePairs = useMemo(() => {
    const pairs = [...new Set(trades.map((t) => t.Pair || "UNKNOWN"))];
    return ["ALL", ...pairs.sort()];
  }, [trades]);

  // Filter trades by pair
  const filteredTrades = useMemo(() => {
    if (selectedPair === "ALL") return trades;
    return trades.filter((t) => t.Pair === selectedPair);
  }, [trades, selectedPair]);

  // Load profile when pair changes
  useEffect(() => {
    if (selectedPair !== "ALL") {
      const profile = getPairProfile(profiles, selectedPair);
      setActiveConfig({
        tpLevel: profile.tpLevel,
        partialClose: profile.partialClose,
        trailingStop: profile.trailingStop,
        useBreakeven: profile.useBreakeven,
        breakevenTrigger: profile.breakevenTrigger,
        breakevenOffset: profile.breakevenOffset,
      });
    } else {
      setActiveConfig({
        tpLevel: 2.0,
        partialClose: 0.5,
        trailingStop: 1.5,
        useBreakeven: true,
        breakevenTrigger: 0.5,
        breakevenOffset: 0.1,
      });
    }
  }, [selectedPair, profiles]);

  // Run simulation
  const runSimulation = useCallback(() => {
    if (!activeConfig || filteredTrades.length === 0) return;

    const results = simulateEquityCurve(
      filteredTrades,
      activeConfig,
      initialBalance,
      riskPerTrade / 100,
      useCompounding
    );

    setSimulationResults(results);
  }, [
    filteredTrades,
    activeConfig,
    initialBalance,
    riskPerTrade,
    useCompounding,
  ]);

  // Auto-run on config change
  useEffect(() => {
    runSimulation();
  }, [runSimulation]);

  // Draw equity curve
  useEffect(() => {
    if (!simulationResults || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const { width, height } = canvas;

    // Clear
    ctx.fillStyle = T.bg;
    ctx.fillRect(0, 0, width, height);

    const { equityCurve } = simulationResults;
    if (equityCurve.length < 2) return;

    // Scales
    const balances = equityCurve.map((e) => e.balance);
    const minBal = Math.min(...balances) * 0.95;
    const maxBal = Math.max(...balances) * 1.05;
    const range = maxBal - minBal;

    const padding = 40;
    const chartW = width - padding * 2;
    const chartH = height - padding * 2;

    // Grid lines
    ctx.strokeStyle = T.panelAlt;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      const y = padding + (chartH * i) / 5;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();
    }

    // Equity line
    ctx.strokeStyle = T.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();

    equityCurve.forEach((point, i) => {
      const x = padding + (chartW * i) / (equityCurve.length - 1);
      const y = padding + chartH - ((point.balance - minBal) / range) * chartH;

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Stress events
    simulationResults.stressAnalysis.stressEvents.forEach((event) => {
      const idx = Math.min(event.trade, equityCurve.length - 1);
      const point = equityCurve[idx];
      const x = padding + (chartW * idx) / (equityCurve.length - 1);
      const y = padding + chartH - ((point.balance - minBal) / range) * chartH;

      ctx.fillStyle = event.type === "MAJOR_DRAWDOWN" ? T.red : T.orange;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    });

    // Labels
    ctx.fillStyle = T.text;
    ctx.font = "12px JetBrains Mono";
    ctx.fillText(`Start: $${initialBalance.toLocaleString()}`, padding, 20);
    ctx.fillText(
      `End: $${Math.round(
        simulationResults.summary.finalBalance
      ).toLocaleString()}`,
      width - 150,
      20
    );
  }, [simulationResults, T]);

  const updateConfig = (key, value) => {
    setActiveConfig((prev) => ({ ...prev, [key]: value }));
  };

  const saveToProfile = () => {
    if (selectedPair === "ALL") return;
    const newProfiles = updatePairProfile(profiles, selectedPair, activeConfig);
    setProfiles(newProfiles);
    alert(`Saved configuration for ${selectedPair}`);
  };

  if (!activeConfig) return <div style={{ color: T.text }}>Loading...</div>;

  return (
    <div style={{ padding: "20px", background: T.bg, color: T.text }}>
      <h2 style={{ color: T.accent, marginBottom: "20px" }}>
        Portfolio Simulator
      </h2>

      {/* Controls */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "15px",
          marginBottom: "20px",
          background: T.panel,
          padding: "15px",
          borderRadius: "8px",
        }}
      >
        <div>
          <label
            style={{ display: "block", marginBottom: "5px", fontSize: "12px" }}
          >
            Pair
          </label>
          <select
            value={selectedPair}
            onChange={(e) => setSelectedPair(e.target.value)}
            style={{
              width: "100%",
              padding: "8px",
              background: T.panelAlt,
              color: T.text,
              border: "none",
            }}
          >
            {availablePairs.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            style={{ display: "block", marginBottom: "5px", fontSize: "12px" }}
          >
            Initial Balance ($)
          </label>
          <input
            type="number"
            value={initialBalance}
            onChange={(e) => setInitialBalance(Number(e.target.value))}
            style={{
              width: "100%",
              padding: "8px",
              background: T.panelAlt,
              color: T.text,
              border: "none",
            }}
          />
        </div>

        <div>
          <label
            style={{ display: "block", marginBottom: "5px", fontSize: "12px" }}
          >
            Risk Per Trade (%)
          </label>
          <input
            type="number"
            step="0.1"
            value={riskPerTrade}
            onChange={(e) => setRiskPerTrade(Number(e.target.value))}
            style={{
              width: "100%",
              padding: "8px",
              background: T.panelAlt,
              color: T.text,
              border: "none",
            }}
          />
        </div>

        <div>
          <label
            style={{ display: "block", marginBottom: "5px", fontSize: "12px" }}
          >
            TP Level (R)
          </label>
          <input
            type="number"
            step="0.5"
            value={activeConfig.tpLevel}
            onChange={(e) => updateConfig("tpLevel", Number(e.target.value))}
            style={{
              width: "100%",
              padding: "8px",
              background: T.panelAlt,
              color: T.text,
              border: "none",
            }}
          />
        </div>

        <div>
          <label
            style={{ display: "block", marginBottom: "5px", fontSize: "12px" }}
          >
            Partial Close (%)
          </label>
          <input
            type="number"
            step="10"
            min="0"
            max="100"
            value={activeConfig.partialClose * 100}
            onChange={(e) =>
              updateConfig("partialClose", Number(e.target.value) / 100)
            }
            style={{
              width: "100%",
              padding: "8px",
              background: T.panelAlt,
              color: T.text,
              border: "none",
            }}
          />
        </div>

        <div>
          <label
            style={{ display: "block", marginBottom: "5px", fontSize: "12px" }}
          >
            Trailing Stop (R)
          </label>
          <input
            type="number"
            step="0.5"
            value={activeConfig.trailingStop}
            onChange={(e) =>
              updateConfig("trailingStop", Number(e.target.value))
            }
            style={{
              width: "100%",
              padding: "8px",
              background: T.panelAlt,
              color: T.text,
              border: "none",
            }}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <input
            type="checkbox"
            checked={useCompounding}
            onChange={(e) => setUseCompounding(e.target.checked)}
            id="compounding"
          />
          <label htmlFor="compounding">Use Compounding</label>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <input
            type="checkbox"
            checked={activeConfig.useBreakeven}
            onChange={(e) => updateConfig("useBreakeven", e.target.checked)}
            id="breakeven"
          />
          <label htmlFor="breakeven">Use Breakeven</label>
        </div>

        {selectedPair !== "ALL" && (
          <button
            onClick={saveToProfile}
            style={{
              background: T.green,
              color: T.bg,
              border: "none",
              padding: "10px",
              borderRadius: "4px",
              cursor: "pointer",
              fontWeight: "bold",
            }}
          >
            Save to {selectedPair} Profile
          </button>
        )}
      </div>

      {/* Equity Chart */}
      <div
        style={{
          background: T.panel,
          padding: "15px",
          borderRadius: "8px",
          marginBottom: "20px",
        }}
      >
        <h3 style={{ marginBottom: "10px" }}>Equity Curve</h3>
        <canvas
          ref={canvasRef}
          width={800}
          height={300}
          style={{ width: "100%", height: "300px", background: T.bg }}
        />
      </div>

      {/* Metrics */}
      {simulationResults && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: "15px",
            marginBottom: "20px",
          }}
        >
          <MetricCard
            label="Final Balance"
            value={`$${Math.round(
              simulationResults?.summary?.finalBalance || 0
            ).toLocaleString()}`}
            color={
              (simulationResults?.summary?.finalBalance || 0) > initialBalance
                ? T.green
                : T.red
            }
            T={T}
          />
          <MetricCard
            label="Total Return"
            value={safePercent(simulationResults?.summary?.totalReturn, 1)}
            color={
              (simulationResults?.summary?.totalReturn || 0) > 0
                ? T.green
                : T.red
            }
            T={T}
          />
          <MetricCard
            label="Max Drawdown"
            value={safePercent(
              simulationResults?.summary?.maxDrawdownPercent,
              1
            )}
            color={T.red}
            T={T}
          />
          <MetricCard
            label="Expectancy (R)"
            value={safeFixed(simulationResults?.summary?.expectancy, 2)}
            color={
              (simulationResults?.summary?.expectancy || 0) > 0
                ? T.green
                : T.red
            }
            T={T}
          />
          <MetricCard
            label="Win Rate"
            value={safePercent(simulationResults?.summary?.winRate, 1)}
            color={T.accent}
            T={T}
          />
          <MetricCard
            label="Sharpe Ratio"
            value={safeFixed(simulationResults?.summary?.sharpeRatio, 2)}
            color={T.accent}
            T={T}
          />
          <MetricCard
            label="Recovery Factor"
            value={safeFixed(simulationResults?.summary?.recoveryFactor, 2)}
            color={T.accent}
            T={T}
          />
          <MetricCard
            label="Stress Events"
            value={simulationResults?.stressAnalysis?.stressEventCount ?? "—"}
            color={
              (simulationResults?.stressAnalysis?.stressEventCount || 0) > 5
                ? T.red
                : T.yellow
            }
            T={T}
          />
        </div>
      )}

      {/* Exit Distribution */}
      {simulationResults && (
        <div
          style={{ background: T.panel, padding: "15px", borderRadius: "8px" }}
        >
          <h3 style={{ marginBottom: "10px" }}>Exit Distribution</h3>
          <div style={{ display: "flex", gap: "20px", flexWrap: "wrap" }}>
            <ExitBadge
              label="Full TP"
              count={simulationResults.exitDistribution.fullTP}
              color={T.green}
              T={T}
            />
            <ExitBadge
              label="Partial TP"
              count={simulationResults.exitDistribution.partialTP}
              color={T.accent}
              T={T}
            />
            <ExitBadge
              label="Breakeven"
              count={simulationResults.exitDistribution.breakeven}
              color={T.yellow}
              T={T}
            />
            <ExitBadge
              label="Trailing Stop"
              count={simulationResults.exitDistribution.trailingStop}
              color={T.purple}
              T={T}
            />
            <ExitBadge
              label="Stop Loss"
              count={simulationResults.exitDistribution.stopLoss}
              color={T.red}
              T={T}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value, color, T }) {
  return (
    <div
      style={{
        background: T.panel,
        padding: "15px",
        borderRadius: "8px",
        borderLeft: `3px solid ${color}`,
      }}
    >
      <div style={{ fontSize: "11px", opacity: 0.7, marginBottom: "5px" }}>
        {label}
      </div>
      <div style={{ fontSize: "18px", fontWeight: "bold", color }}>{value}</div>
    </div>
  );
}

function ExitBadge({ label, count, color, T }) {
  return (
    <div
      style={{
        background: T.panelAlt,
        padding: "10px 15px",
        borderRadius: "20px",
        display: "flex",
        alignItems: "center",
        gap: "8px",
      }}
    >
      <div
        style={{
          width: "10px",
          height: "10px",
          borderRadius: "50%",
          background: color,
        }}
      />
      <span>
        {label}: <strong>{count}</strong>
      </span>
    </div>
  );
}

// ============================================
// TAB 8: PSYCHOLOGICAL FIT
// ============================================

export function TabPsychologicalFit({ trades, T }) {
  const [selectedProfile, setSelectedProfile] = useState("conservative");
  const [stressResults, setStressResults] = useState(null);
  const [scenarioComparison, setScenarioComparison] = useState([]);
  const [activeScenario, setActiveScenario] = useState(null);

  const profile = PSYCHOLOGICAL_PROFILES[selectedProfile];

  // Run stress test when profile changes
  useEffect(() => {
    if (!trades || trades.length === 0) return;

    // Test current strategy (assumes 20R from memory)
    const currentConfig = {
      tpLevel: 20,
      partialClose: 0,
      trailingStop: 0,
      useBreakeven: false,
    };
    const currentResult = psychologicalStressTest(
      trades,
      profile,
      currentConfig
    );
    setStressResults(currentResult);

    // Compare scenarios
    const scenarios = [
      {
        name: "Current (20R Hold)",
        tpLevel: 20,
        partialClose: 0,
        trailingStop: 0,
        useBreakeven: false,
      },
      {
        name: "Quick Wins (1R)",
        tpLevel: 1,
        partialClose: 0.6,
        trailingStop: 0,
        useBreakeven: true,
      },
      {
        name: "Balanced (2R)",
        tpLevel: 2,
        partialClose: 0.5,
        trailingStop: 1,
        useBreakeven: true,
      },
      {
        name: "Conservative (1.5R)",
        tpLevel: 1.5,
        partialClose: 0.6,
        trailingStop: 1,
        useBreakeven: true,
      },
    ];

    const comparison = compareScenarios(trades, profile, scenarios);
    setScenarioComparison(comparison);

    // Set best as active
    const best = comparison[0];
    setActiveScenario(best);
  }, [selectedProfile, trades]);

  const getVerdictColor = (verdict) => {
    if (verdict === "SUSTAINABLE") return T.green;
    if (verdict === "STRESSFUL") return T.yellow;
    return T.red;
  };

  return (
    <div style={{ padding: "20px", background: T.bg, color: T.text }}>
      <h2 style={{ color: T.accent, marginBottom: "20px" }}>
        Psychological Fit Analyzer
      </h2>

      {/* Profile Selector */}
      <div
        style={{
          background: T.panel,
          padding: "20px",
          borderRadius: "8px",
          marginBottom: "20px",
        }}
      >
        <h3 style={{ marginBottom: "15px" }}>
          Select Your Psychological Profile
        </h3>
        <div style={{ display: "flex", gap: "15px", flexWrap: "wrap" }}>
          {Object.entries(PSYCHOLOGICAL_PROFILES).map(([key, prof]) => (
            <button
              key={key}
              onClick={() => setSelectedProfile(key)}
              style={{
                flex: "1",
                minWidth: "200px",
                padding: "15px",
                background: selectedProfile === key ? T.accent : T.panelAlt,
                color: selectedProfile === key ? T.bg : T.text,
                border: "none",
                borderRadius: "8px",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <div style={{ fontWeight: "bold", marginBottom: "5px" }}>
                {prof.name}
              </div>
              <div style={{ fontSize: "12px", opacity: 0.8 }}>
                {prof.description}
              </div>
              <div
                style={{
                  fontSize: "11px",
                  marginTop: "8px",
                  display: "flex",
                  gap: "10px",
                }}
              >
                <span>
                  DD Tolerance: {(prof.maxDrawdownTolerance * 100).toFixed(0)}%
                </span>
                <span>
                  Partials: {(prof.partialClosePreference * 100).toFixed(0)}%
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Current Stress Test */}
      {stressResults && (
        <div
          style={{
            background: T.panel,
            padding: "20px",
            borderRadius: "8px",
            marginBottom: "20px",
            borderLeft: `4px solid ${getVerdictColor(
              stressResults.psychologicalVerdict
            )}`,
          }}
        >
          <h3 style={{ marginBottom: "15px" }}>
            Current Strategy Analysis (20R)
          </h3>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: "20px",
              marginBottom: "20px",
            }}
          >
            <div>
              <div style={{ fontSize: "12px", opacity: 0.7 }}>
                Psychological Verdict
              </div>
              <div
                style={{
                  fontSize: "24px",
                  fontWeight: "bold",
                  color: getVerdictColor(stressResults.psychologicalVerdict),
                }}
              >
                {stressResults.psychologicalVerdict.replace(/_/g, " ")}
              </div>
            </div>

            <div>
              <div style={{ fontSize: "12px", opacity: 0.7 }}>
                Abandonment Risk
              </div>
              <div
                style={{ fontSize: "24px", fontWeight: "bold", color: T.red }}
              >
                {stressResults.abandonmentRisk.toFixed(1)}%
              </div>
            </div>

            <div>
              <div style={{ fontSize: "12px", opacity: 0.7 }}>
                Math Expectancy
              </div>
              <div
                style={{
                  fontSize: "24px",
                  fontWeight: "bold",
                  color: T.accent,
                }}
              >
                {(
                  stressResults.realizedExpectancy /
                  (1 - stressResults.abandonmentRisk / 100)
                ).toFixed(2)}
                R
              </div>
            </div>

            <div>
              <div style={{ fontSize: "12px", opacity: 0.7 }}>
                Realized Expectancy
              </div>
              <div
                style={{ fontSize: "24px", fontWeight: "bold", color: T.green }}
              >
                {stressResults.realizedExpectancy.toFixed(2)}R
              </div>
            </div>
          </div>

          {/* Risk Factor Breakdown */}
          <h4 style={{ marginBottom: "10px" }}>Risk Factor Breakdown</h4>
          <div
            style={{ display: "flex", flexDirection: "column", gap: "10px" }}
          >
            <RiskBar
              label="Drawdown Risk"
              value={stressResults.riskFactors.drawdownRisk}
              color={T.red}
              T={T}
            />
            <RiskBar
              label="Recency Bias Risk"
              value={stressResults.riskFactors.recencyRisk}
              color={T.orange}
              T={T}
            />
            <RiskBar
              label="Frequency Risk"
              value={stressResults.riskFactors.frequencyRisk}
              color={T.yellow}
              T={T}
            />
            <RiskBar
              label="Ego/Consecutive Loss Risk"
              value={stressResults.riskFactors.egoRisk}
              color={T.purple}
              T={T}
            />
          </div>
        </div>
      )}

      {/* Scenario Comparison */}
      <div
        style={{
          background: T.panel,
          padding: "20px",
          borderRadius: "8px",
          marginBottom: "20px",
        }}
      >
        <h3 style={{ marginBottom: "15px" }}>Scenario Comparison</h3>
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "13px",
            }}
          >
            <thead>
              <tr style={{ borderBottom: `2px solid ${T.panelAlt}` }}>
                <th style={{ textAlign: "left", padding: "10px" }}>Scenario</th>
                <th style={{ textAlign: "center", padding: "10px" }}>
                  TP Level
                </th>
                <th style={{ textAlign: "center", padding: "10px" }}>
                  Partials
                </th>
                <th style={{ textAlign: "center", padding: "10px" }}>
                  Abandonment Risk
                </th>
                <th style={{ textAlign: "center", padding: "10px" }}>
                  Realized Expectancy
                </th>
                <th style={{ textAlign: "center", padding: "10px" }}>
                  Verdict
                </th>
              </tr>
            </thead>
            <tbody>
              {scenarioComparison.map((scenario, idx) => (
                <tr
                  key={idx}
                  style={{
                    borderBottom: `1px solid ${T.panelAlt}`,
                    background: idx === 0 ? `${T.green}20` : "transparent",
                  }}
                >
                  <td
                    style={{
                      padding: "10px",
                      fontWeight: idx === 0 ? "bold" : "normal",
                    }}
                  >
                    {idx === 0 && "⭐ "}
                    {scenario.name}
                  </td>
                  <td style={{ textAlign: "center", padding: "10px" }}>
                    {scenario.config.tpLevel}R
                  </td>
                  <td style={{ textAlign: "center", padding: "10px" }}>
                    {(scenario.config.partialClose * 100).toFixed(0)}%
                  </td>
                  <td
                    style={{
                      textAlign: "center",
                      padding: "10px",
                      color: T.red,
                    }}
                  >
                    {scenario.abandonmentRisk.toFixed(1)}%
                  </td>
                  <td
                    style={{
                      textAlign: "center",
                      padding: "10px",
                      color: T.green,
                      fontWeight: "bold",
                    }}
                  >
                    {scenario.realizedExpectancy.toFixed(2)}R
                  </td>
                  <td style={{ textAlign: "center", padding: "10px" }}>
                    <span
                      style={{
                        color: getVerdictColor(scenario.verdict),
                        fontWeight: "bold",
                      }}
                    >
                      {scenario.verdict.replace(/_/g, " ")}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: "10px", fontSize: "12px", opacity: 0.7 }}>
          ⭐ = Best for your psychological profile (highest realized expectancy)
        </div>
      </div>

      {/* Recommendations */}
      {stressResults && stressResults.recommendations.length > 0 && (
        <div
          style={{ background: T.panel, padding: "20px", borderRadius: "8px" }}
        >
          <h3 style={{ marginBottom: "15px" }}>Personalized Recommendations</h3>
          <div
            style={{ display: "flex", flexDirection: "column", gap: "10px" }}
          >
            {stressResults.recommendations.map((rec, idx) => (
              <div
                key={idx}
                style={{
                  padding: "12px",
                  background: T.panelAlt,
                  borderRadius: "6px",
                  borderLeft: `3px solid ${
                    rec.type === "warning"
                      ? T.red
                      : rec.type === "success"
                      ? T.green
                      : rec.type === "optimization"
                      ? T.accent
                      : T.yellow
                  }`,
                }}
              >
                <div
                  style={{
                    fontSize: "11px",
                    opacity: 0.7,
                    marginBottom: "4px",
                  }}
                >
                  {rec.priority.toUpperCase()} PRIORITY • {rec.type}
                </div>
                <div>{rec.message}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RiskBar({ label, value, color, T }) {
  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: "5px",
          fontSize: "12px",
        }}
      >
        <span>{label}</span>
        <span style={{ color }}>{value.toFixed(0)}%</span>
      </div>
      <div
        style={{
          width: "100%",
          height: "8px",
          background: T.panelAlt,
          borderRadius: "4px",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${value}%`,
            height: "100%",
            background: color,
            borderRadius: "4px",
            transition: "width 0.5s ease",
          }}
        />
      </div>
    </div>
  );
}

export default { TabPortfolioSimulator, TabPsychologicalFit };
