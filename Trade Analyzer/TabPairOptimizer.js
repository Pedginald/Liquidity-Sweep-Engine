import { useState, useEffect, useMemo, useCallback } from "react";
import { simulateEquityCurve } from "./equitySimulator";
import {
  psychologicalStressTest,
  PSYCHOLOGICAL_PROFILES,
} from "./psychologicalStressTest";
import {
  initPairProfiles,
  getPairProfile,
  updatePairProfile,
  savePairProfiles,
} from "./pairProfileManager";

// ============================================
// OPTIMIZER TAB COMPONENT
// ============================================

export function TabPairOptimizer({ trades, T }) {
  const [profiles, setProfiles] = useState(() => initPairProfiles());
  const [selectedPair, setSelectedPair] = useState("ALL");
  const [optimizationResults, setOptimizationResults] = useState(null);
  const [activeProfile, setActiveProfile] = useState(null);
  const [psychProfile, setPsychProfile] = useState("conservative");

  // Get unique pairs
  const availablePairs = useMemo(() => {
    const pairs = [...new Set(trades.map((t) => t._pair || "UNKNOWN"))];
    return ["ALL", ...pairs.sort()];
  }, [trades]);

  // Filter trades by pair
  const pairTrades = useMemo(() => {
    if (selectedPair === "ALL") return trades;
    return trades.filter((t) => t._pair === selectedPair);
  }, [trades, selectedPair]);

  // Run optimization
  const runOptimization = useCallback(() => {
    if (pairTrades.length < 10) return;

    const results = optimizeForHighWinRate(
      pairTrades,
      PSYCHOLOGICAL_PROFILES[psychProfile]
    );

    setOptimizationResults(results);

    // Auto-select best for this pair
    if (selectedPair !== "ALL") {
      const best = results[0];
      setActiveProfile(best);
    }
  }, [pairTrades, psychProfile, selectedPair]);

  // Save to profile
  const saveToProfile = () => {
    if (!activeProfile || selectedPair === "ALL") return;

    const newProfiles = updatePairProfile(profiles, selectedPair, {
      tpLevel: activeProfile.config.tpLevel,
      partialClose: activeProfile.config.partialClose,
      trailingStop: activeProfile.config.trailingStop,
      useBreakeven: activeProfile.config.useBreakeven,
      breakevenTrigger: 0.5,
      breakevenOffset: 0.1,
      optimal: true,
      optimizationScore: activeProfile.score,
      winRate: activeProfile.winRate,
      expectancy: activeProfile.expectancy,
      notes: `Optimized for ${psychProfile} profile - WR ${activeProfile.winRate.toFixed(
        1
      )}%`,
    });

    setProfiles(newProfiles);
    alert(
      `✅ Saved ${selectedPair} profile: ${
        activeProfile.config.tpLevel
      }R with ${activeProfile.winRate.toFixed(1)}% win rate`
    );
  };

  // Auto-run when pair changes
  useEffect(() => {
    if (pairTrades.length >= 10) {
      runOptimization();
    }
  }, [selectedPair, pairTrades]);

  return (
    <div style={{ padding: "20px", background: T.bg, color: T.text }}>
      <h2 style={{ color: T.accent, marginBottom: "20px" }}>
        🎯 Pair Profile Optimizer (High Win Rate Focus)
      </h2>

      {/* Controls */}
      <div
        style={{
          background: T.panel,
          padding: "20px",
          borderRadius: "8px",
          marginBottom: "20px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
          gap: "15px",
        }}
      >
        <div>
          <label
            style={{
              display: "block",
              marginBottom: "8px",
              fontSize: "12px",
              color: T.sub,
            }}
          >
            Select Pair to Optimize
          </label>
          <select
            value={selectedPair}
            onChange={(e) => setSelectedPair(e.target.value)}
            style={{
              width: "100%",
              padding: "10px",
              background: T.panelAlt,
              color: T.text,
              border: `1px solid ${T.border}`,
              borderRadius: "4px",
            }}
          >
            {availablePairs.map((p) => (
              <option key={p} value={p}>
                {p}{" "}
                {p !== "ALL" &&
                  `(${trades.filter((t) => t._pair === p).length} trades)`}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            style={{
              display: "block",
              marginBottom: "8px",
              fontSize: "12px",
              color: T.sub,
            }}
          >
            Psychological Profile
          </label>
          <div style={{ display: "flex", gap: "10px" }}>
            {Object.entries(PSYCHOLOGICAL_PROFILES).map(([key, prof]) => (
              <button
                key={key}
                onClick={() => setPsychProfile(key)}
                style={{
                  flex: 1,
                  padding: "10px",
                  background: psychProfile === key ? T.accent : T.panelAlt,
                  color: psychProfile === key ? T.bg : T.text,
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontSize: "12px",
                }}
              >
                {prof.name}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <button
            onClick={runOptimization}
            disabled={pairTrades.length < 10}
            style={{
              width: "100%",
              padding: "12px",
              background: pairTrades.length < 10 ? T.border : T.green,
              color: T.bg,
              border: "none",
              borderRadius: "4px",
              cursor: pairTrades.length < 10 ? "not-allowed" : "pointer",
              fontWeight: "bold",
            }}
          >
            {pairTrades.length < 10 ? "Need 10+ trades" : "🔍 Run Optimization"}
          </button>
        </div>
      </div>

      {/* Current vs Optimized */}
      {optimizationResults && optimizationResults.length > 0 && (
        <>
          {/* Best Result Highlight */}
          <div
            style={{
              background: T.panel,
              padding: "20px",
              borderRadius: "8px",
              marginBottom: "20px",
              borderLeft: `4px solid ${T.green}`,
            }}
          >
            <h3 style={{ marginBottom: "15px", color: T.green }}>
              🏆 Best Configuration for{" "}
              {selectedPair !== "ALL" ? selectedPair : "All Pairs"}
            </h3>

            {(() => {
              const best = optimizationResults[0];
              return (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                    gap: "15px",
                  }}
                >
                  <StatBox
                    label="TP Level"
                    value={`${best.config.tpLevel}R`}
                    color={T.accent}
                    T={T}
                  />
                  <StatBox
                    label="Win Rate"
                    value={`${best.winRate.toFixed(1)}%`}
                    color={T.green}
                    T={T}
                  />
                  <StatBox
                    label="Expectancy"
                    value={`+${best.expectancy.toFixed(3)}R`}
                    color={T.green}
                    T={T}
                  />
                  <StatBox
                    label="Profit Factor"
                    value={best.profitFactor.toFixed(2)}
                    color={T.accent}
                    T={T}
                  />
                  <StatBox
                    label="Max Drawdown"
                    value={`${best.maxDrawdown.toFixed(1)}%`}
                    color={T.yellow}
                    T={T}
                  />
                  <StatBox
                    label="Exit Strategy"
                    value={
                      best.config.partialClose > 0
                        ? `${(best.config.partialClose * 100).toFixed(
                            0
                          )}% Partial`
                        : "Full Hold"
                    }
                    color={T.purple}
                    T={T}
                  />
                  {best.config.useBreakeven && (
                    <StatBox
                      label="Breakeven"
                      value="After 0.5R"
                      color={T.yellow}
                      T={T}
                    />
                  )}
                </div>
              );
            })()}

            {selectedPair !== "ALL" && (
              <button
                onClick={saveToProfile}
                style={{
                  marginTop: "15px",
                  width: "100%",
                  padding: "12px",
                  background: T.accent,
                  color: T.bg,
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontWeight: "bold",
                  fontSize: "14px",
                }}
              >
                💾 Save This as {selectedPair} Profile
              </button>
            )}
          </div>

          {/* Comparison Table */}
          <div
            style={{
              background: T.panel,
              padding: "20px",
              borderRadius: "8px",
            }}
          >
            <h3 style={{ marginBottom: "15px" }}>
              📊 Top 10 Configurations (Ranked by Win Rate + Expectancy)
            </h3>
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: "12px",
                }}
              >
                <thead>
                  <tr style={{ borderBottom: `2px solid ${T.border}` }}>
                    <th
                      style={{
                        textAlign: "left",
                        padding: "10px",
                        color: T.sub,
                      }}
                    >
                      Rank
                    </th>
                    <th
                      style={{
                        textAlign: "center",
                        padding: "10px",
                        color: T.sub,
                      }}
                    >
                      TP
                    </th>
                    <th
                      style={{
                        textAlign: "center",
                        padding: "10px",
                        color: T.sub,
                      }}
                    >
                      Partials
                    </th>
                    <th
                      style={{
                        textAlign: "center",
                        padding: "10px",
                        color: T.sub,
                      }}
                    >
                      BE Stop
                    </th>
                    <th
                      style={{
                        textAlign: "center",
                        padding: "10px",
                        color: T.sub,
                      }}
                    >
                      Win Rate
                    </th>
                    <th
                      style={{
                        textAlign: "center",
                        padding: "10px",
                        color: T.sub,
                      }}
                    >
                      Expectancy
                    </th>
                    <th
                      style={{
                        textAlign: "center",
                        padding: "10px",
                        color: T.sub,
                      }}
                    >
                      PF
                    </th>
                    <th
                      style={{
                        textAlign: "center",
                        padding: "10px",
                        color: T.sub,
                      }}
                    >
                      Max DD
                    </th>
                    <th
                      style={{
                        textAlign: "center",
                        padding: "10px",
                        color: T.sub,
                      }}
                    >
                      Score
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {optimizationResults.slice(0, 10).map((result, idx) => (
                    <tr
                      key={idx}
                      style={{
                        borderBottom: `1px solid ${T.border}`,
                        background:
                          idx === 0 ? "rgba(52, 211, 153, 0.1)" : "transparent",
                      }}
                    >
                      <td
                        style={{
                          padding: "10px",
                          fontWeight: idx === 0 ? "bold" : "normal",
                        }}
                      >
                        {idx === 0
                          ? "🥇"
                          : idx === 1
                          ? "🥈"
                          : idx === 2
                          ? "🥉"
                          : `#${idx + 1}`}
                      </td>
                      <td
                        style={{
                          textAlign: "center",
                          padding: "10px",
                          color: T.accent,
                          fontWeight: "bold",
                        }}
                      >
                        {result.config.tpLevel}R
                      </td>
                      <td style={{ textAlign: "center", padding: "10px" }}>
                        {result.config.partialClose > 0
                          ? `${(result.config.partialClose * 100).toFixed(0)}%`
                          : "None"}
                      </td>
                      <td style={{ textAlign: "center", padding: "10px" }}>
                        {result.config.useBreakeven ? "✅" : "❌"}
                      </td>
                      <td
                        style={{
                          textAlign: "center",
                          padding: "10px",
                          color: T.green,
                          fontWeight: "bold",
                        }}
                      >
                        {result.winRate.toFixed(1)}%
                      </td>
                      <td
                        style={{
                          textAlign: "center",
                          padding: "10px",
                          color: result.expectancy > 0 ? T.green : T.red,
                        }}
                      >
                        +{result.expectancy.toFixed(3)}R
                      </td>
                      <td style={{ textAlign: "center", padding: "10px" }}>
                        {result.profitFactor.toFixed(2)}
                      </td>
                      <td
                        style={{
                          textAlign: "center",
                          padding: "10px",
                          color: T.yellow,
                        }}
                      >
                        {result.maxDrawdown.toFixed(1)}%
                      </td>
                      <td
                        style={{
                          textAlign: "center",
                          padding: "10px",
                          color: T.accent,
                        }}
                      >
                        {result.score.toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* All Pairs Summary */}
      {selectedPair === "ALL" && trades.length > 0 && (
        <AllPairsOptimizer trades={trades} psychProfile={psychProfile} T={T} />
      )}
    </div>
  );
}

// ============================================
// OPTIMIZATION ENGINE
// ============================================

function optimizeForHighWinRate(trades, psychProfile) {
  // Focus on 0.5R to 3R range for quick wins
  const tpLevels = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0];
  const partialOptions = [0, 0.3, 0.5, 0.6, 0.7]; // 0 = no partials
  const useBreakevenOptions = [true, false];
  const trailingOptions = [0, 0.5, 1.0]; // 0 = no trailing

  const results = [];

  for (const tp of tpLevels) {
    for (const partial of partialOptions) {
      for (const useBE of useBreakevenOptions) {
        for (const trail of trailingOptions) {
          const config = {
            tpLevel: tp,
            partialClose: partial,
            trailingStop: trail,
            useBreakeven: useBE,
            breakevenTrigger: 0.5,
            breakevenOffset: 0.1,
          };

          // Run simulation
          const sim = simulateEquityCurve(trades, config, 10000, 0.01, true);

          if (!sim || sim.error) continue;

          // Calculate score based on psych profile preferences
          const winRate = sim.summary.winRate;
          const expectancy = sim.summary.expectancy;
          const maxDD = sim.summary.maxDrawdownPercent;
          const pf = sim.summary.profitFactor;

          // Weighted score: Win Rate (40%) + Expectancy (40%) + Drawdown Penalty (20%)
          const winRateScore = (winRate / 100) * 40;
          const expScore = Math.max(0, expectancy) * 40;
          const ddPenalty = Math.max(
            0,
            (maxDD - psychProfile.maxDrawdownTolerance * 100) * 0.5
          );

          const score = winRateScore + expScore - ddPenalty;

          results.push({
            config,
            winRate,
            expectancy,
            maxDrawdown: maxDD,
            profitFactor: pf,
            totalReturn: sim.summary.totalReturn,
            finalBalance: sim.summary.finalBalance,
            score,
            exitDistribution: sim.exitDistribution,
            stressEvents: sim.stressAnalysis.stressEventCount,
          });
        }
      }
    }
  }

  // Sort by score descending
  return results.sort((a, b) => b.score - a.score);
}

// ============================================
// ALL PAIRS OPTIMIZER
// ============================================

function AllPairsOptimizer({ trades, psychProfile, T }) {
  const pairs = [...new Set(trades.map((t) => t._pair))];

  const pairResults = useMemo(() => {
    return pairs
      .map((pair) => {
        const pairTrades = trades.filter((t) => t._pair === pair);
        if (pairTrades.length < 10) return null;

        const optimized = optimizeForHighWinRate(pairTrades, psychProfile);
        const best = optimized[0];

        return {
          pair,
          tradeCount: pairTrades.length,
          bestTp: best.config.tpLevel,
          bestWinRate: best.winRate,
          bestExpectancy: best.expectancy,
          bestPartial: best.config.partialClose,
          useBE: best.config.useBreakeven,
          score: best.score,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);
  }, [trades, psychProfile]);

  return (
    <div
      style={{
        background: T.panel,
        padding: "20px",
        borderRadius: "8px",
        marginTop: "20px",
      }}
    >
      <h3 style={{ marginBottom: "15px" }}>🌍 All Pairs - Quick Reference</h3>
      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: "12px",
          }}
        >
          <thead>
            <tr style={{ borderBottom: `2px solid ${T.border}` }}>
              <th style={{ textAlign: "left", padding: "10px", color: T.sub }}>
                Pair
              </th>
              <th
                style={{ textAlign: "center", padding: "10px", color: T.sub }}
              >
                Trades
              </th>
              <th
                style={{ textAlign: "center", padding: "10px", color: T.sub }}
              >
                Optimal TP
              </th>
              <th
                style={{ textAlign: "center", padding: "10px", color: T.sub }}
              >
                Win Rate
              </th>
              <th
                style={{ textAlign: "center", padding: "10px", color: T.sub }}
              >
                Exp
              </th>
              <th
                style={{ textAlign: "center", padding: "10px", color: T.sub }}
              >
                Partials
              </th>
              <th
                style={{ textAlign: "center", padding: "10px", color: T.sub }}
              >
                BE Stop
              </th>
            </tr>
          </thead>
          <tbody>
            {pairResults.map((r, idx) => (
              <tr key={idx} style={{ borderBottom: `1px solid ${T.border}` }}>
                <td
                  style={{
                    padding: "10px",
                    fontWeight: "bold",
                    color: T.accent,
                  }}
                >
                  {r.pair}
                </td>
                <td style={{ textAlign: "center", padding: "10px" }}>
                  {r.tradeCount}
                </td>
                <td
                  style={{
                    textAlign: "center",
                    padding: "10px",
                    color: T.green,
                    fontWeight: "bold",
                  }}
                >
                  {r.bestTp}R
                </td>
                <td
                  style={{
                    textAlign: "center",
                    padding: "10px",
                    color: T.green,
                  }}
                >
                  {r.bestWinRate.toFixed(1)}%
                </td>
                <td style={{ textAlign: "center", padding: "10px" }}>
                  +{r.bestExpectancy.toFixed(3)}R
                </td>
                <td style={{ textAlign: "center", padding: "10px" }}>
                  {r.bestPartial > 0
                    ? `${(r.bestPartial * 100).toFixed(0)}%`
                    : "None"}
                </td>
                <td style={{ textAlign: "center", padding: "10px" }}>
                  {r.useBE ? "✅" : "❌"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatBox({ label, value, color, T }) {
  return (
    <div
      style={{
        background: T.panelAlt,
        padding: "15px",
        borderRadius: "6px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontSize: "11px",
          color: T.sub,
          marginBottom: "5px",
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: "20px", fontWeight: "bold", color }}>{value}</div>
    </div>
  );
}

export default TabPairOptimizer;
