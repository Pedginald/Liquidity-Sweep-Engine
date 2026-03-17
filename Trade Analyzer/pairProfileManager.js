/**
 * Pair Profile Manager v4.6
 * Manages per-currency-pair configurations with persistence
 */

import { simulateEquityCurve } from "./equitySimulator";

// Default pair configurations
const DEFAULT_PAIR_PROFILES = {
  AUDUSD: {
    pair: "AUDUSD",
    tpLevel: 1.0,
    partialClose: 0.6,
    trailingStop: 1.0,
    useBreakeven: true,
    breakevenTrigger: 0.5,
    breakevenOffset: 0.1,
    maxDailyTrades: 3,
    correlationGroup: "USD",
    notes: "Quick wins preferred - 1R target",
    optimal: false,
    lastUpdated: null,
    backtestData: null,
  },
  EURUSD: {
    pair: "EURUSD",
    tpLevel: 1.5,
    partialClose: 0.6,
    trailingStop: 1.5,
    useBreakeven: true,
    breakevenTrigger: 0.5,
    breakevenOffset: 0.1,
    maxDailyTrades: 2,
    correlationGroup: "EUR",
    notes: "1.5R balanced approach",
    optimal: false,
    lastUpdated: null,
    backtestData: null,
  },
  GBPUSD: {
    pair: "GBPUSD",
    tpLevel: 1.5,
    partialClose: 0.5,
    trailingStop: 2.0,
    useBreakeven: true,
    breakevenTrigger: 0.5,
    breakevenOffset: 0.1,
    maxDailyTrades: 2,
    correlationGroup: "USD",
    notes: "Volatile - use wider trailing stops",
    optimal: false,
    lastUpdated: null,
    backtestData: null,
  },
  USDJPY: {
    pair: "USDJPY",
    tpLevel: 2.0,
    partialClose: 0.5,
    trailingStop: 1.5,
    useBreakeven: true,
    breakevenTrigger: 0.5,
    breakevenOffset: 0.1,
    maxDailyTrades: 2,
    correlationGroup: "JPY",
    notes: "Trending - can hold longer",
    optimal: false,
    lastUpdated: null,
    backtestData: null,
  },
  USDCAD: {
    pair: "USDCAD",
    tpLevel: 1.5,
    partialClose: 0.6,
    trailingStop: 1.0,
    useBreakeven: true,
    breakevenTrigger: 0.5,
    breakevenOffset: 0.1,
    maxDailyTrades: 2,
    correlationGroup: "USD",
    notes: "Oil correlation - moderate targets",
    optimal: false,
    lastUpdated: null,
    backtestData: null,
  },
  NZDUSD: {
    pair: "NZDUSD",
    tpLevel: 1.0,
    partialClose: 0.6,
    trailingStop: 1.0,
    useBreakeven: true,
    breakevenTrigger: 0.5,
    breakevenOffset: 0.1,
    maxDailyTrades: 2,
    correlationGroup: "USD",
    notes: "Similar to AUD - quick wins",
    optimal: false,
    lastUpdated: null,
    backtestData: null,
  },
  EURGBP: {
    pair: "EURGBP",
    tpLevel: 2.0,
    partialClose: 0.5,
    trailingStop: 1.5,
    useBreakeven: true,
    breakevenTrigger: 0.5,
    breakevenOffset: 0.1,
    maxDailyTrades: 1,
    correlationGroup: "EUR",
    notes: "Cross pair - moderate volatility",
    optimal: false,
    lastUpdated: null,
    backtestData: null,
  },
  XAUUSD: {
    pair: "XAUUSD",
    tpLevel: 3.0,
    partialClose: 0.4,
    trailingStop: 2.0,
    useBreakeven: true,
    breakevenTrigger: 1.0,
    breakevenOffset: 0.2,
    maxDailyTrades: 2,
    correlationGroup: "METAL",
    notes: "Gold - volatile, needs wider stops",
    optimal: false,
    lastUpdated: null,
    backtestData: null,
  },
};

const STORAGE_KEY = "liquidity_sweep_pair_profiles_v4_6";

/**
 * Initialize or load pair profiles from localStorage
 */
export function initPairProfiles() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Merge with defaults to ensure new fields exist
      return { ...DEFAULT_PAIR_PROFILES, ...parsed };
    }
  } catch (e) {
    console.warn("Failed to load pair profiles:", e);
  }
  return { ...DEFAULT_PAIR_PROFILES };
}

/**
 * Save profiles to localStorage
 */
export function savePairProfiles(profiles) {
  try {
    console.log("Saving profiles:", Object.keys(profiles));
    const json = JSON.stringify(profiles);
    console.log("JSON length:", json.length);
    localStorage.setItem(STORAGE_KEY, json);
    console.log("Saved successfully");
    return true;
  } catch (e) {
    console.error("Failed to save pair profiles:", e);
    return false;
  }
}

/**
 * Get profile for specific pair
 */
export function getPairProfile(profiles, pair) {
  const normalizedPair = pair.toUpperCase().replace(/[^A-Z]/g, "");
  return profiles[normalizedPair] || createNewProfile(normalizedPair);
}

/**
 * Update profile for specific pair
 */
export function updatePairProfile(profiles, pair, updates) {
  const normalizedPair = pair.toUpperCase().replace(/[^A-Z]/g, "");
  const updated = {
    ...profiles[normalizedPair],
    ...updates,
    pair: normalizedPair,
    lastUpdated: new Date().toISOString(),
  };

  const newProfiles = {
    ...profiles,
    [normalizedPair]: updated,
  };

  savePairProfiles(newProfiles);
  return newProfiles;
}

/**
 * Create new profile for unknown pair
 */
function createNewProfile(pair) {
  return {
    pair: pair,
    tpLevel: 2.0,
    partialClose: 0.5,
    trailingStop: 1.5,
    useBreakeven: true,
    breakevenTrigger: 0.5,
    breakevenOffset: 0.1,
    maxDailyTrades: 2,
    correlationGroup: detectCorrelationGroup(pair),
    notes: "Auto-created profile",
    optimal: false,
    lastUpdated: new Date().toISOString(),
    backtestData: null,
  };
}

/**
 * Detect correlation group from pair name
 */
function detectCorrelationGroup(pair) {
  if (pair.includes("JPY")) return "JPY";
  if (pair.includes("USD")) return "USD";
  if (pair.includes("EUR")) return "EUR";
  if (pair.includes("GBP")) return "GBP";
  if (pair.includes("AUD") || pair.includes("NZD")) return "OCEANIA";
  if (pair.includes("CAD")) return "COMMODITY";
  if (pair.includes("XAU") || pair.includes("XAG")) return "METAL";
  return "OTHER";
}

/**
 * Import backtest results and auto-optimize profile
 */
export function importBacktestToProfile(profiles, pair, backtestTrades) {
  const normalizedPair = pair.toUpperCase().replace(/[^A-Z]/g, "");

  // Analyze backtest data
  const analysis = analyzeBacktest(backtestTrades);

  // Auto-suggest optimal settings
  const suggestion = generateOptimalSuggestion(analysis);

  const updated = {
    ...profiles[normalizedPair],
    tpLevel: suggestion.tpLevel,
    partialClose: suggestion.partialClose,
    trailingStop: suggestion.trailingStop,
    useBreakeven: suggestion.useBreakeven,
    optimal: true,
    lastUpdated: new Date().toISOString(),
    backtestData: {
      tradeCount: backtestTrades.length,
      analyzedAt: new Date().toISOString(),
      optimalTp: suggestion.tpLevel,
      winRate: analysis.winRate,
      expectancy: analysis.expectancy,
      avgMaxR: analysis.avgMaxR,
      volatility: analysis.volatility,
    },
  };

  const newProfiles = {
    ...profiles,
    [normalizedPair]: updated,
  };

  savePairProfiles(newProfiles);
  return { profiles: newProfiles, suggestion, analysis };
}

/**
 * Analyze backtest trades for a pair
 */
function analyzeBacktest(trades) {
  if (!trades || trades.length === 0) {
    return { winRate: 0, expectancy: 0, avgMaxR: 0, volatility: 0 };
  }

  const wins = trades.filter((t) => (t.ExitR || 0) > 0).length;
  const winRate = (wins / trades.length) * 100;
  const expectancy =
    trades.reduce((sum, t) => sum + (t.ExitR || 0), 0) / trades.length;
  const avgMaxR =
    trades.reduce((sum, t) => sum + (t.MaxR || 0), 0) / trades.length;

  // Calculate volatility (standard deviation of returns)
  const returns = trades.map((t) => t.ExitR || 0);
  const avg = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((sum, r) => sum + Math.pow(r - avg, 2), 0) / returns.length;
  const volatility = Math.sqrt(variance);

  return {
    winRate,
    expectancy,
    avgMaxR,
    volatility,
    tradeCount: trades.length,
  };
}

/**
 * Generate optimal suggestion based on analysis
 */
function generateOptimalSuggestion(analysis) {
  const { winRate, expectancy, avgMaxR, volatility } = analysis;

  // Determine optimal TP based on avg MaxR and win rate
  let tpLevel = 2.0;
  if (avgMaxR < 1.5) tpLevel = 1.0;
  else if (avgMaxR < 2.5) tpLevel = 1.5;
  else if (avgMaxR < 4.0) tpLevel = 2.0;
  else if (avgMaxR < 8.0) tpLevel = 3.0;
  else tpLevel = 5.0;

  // Adjust for volatility
  let partialClose = 0.5;
  if (volatility > 2.0) partialClose = 0.6; // High vol = more partials
  if (volatility > 3.0) partialClose = 0.7;

  // Trailing stop based on volatility
  let trailingStop = 1.5;
  if (volatility < 1.0) trailingStop = 1.0;
  if (volatility > 2.5) trailingStop = 2.0;

  return {
    tpLevel,
    partialClose,
    trailingStop,
    useBreakeven: true,
    breakevenTrigger: 0.5,
    breakevenOffset: 0.1,
    reasoning: `Based on avg MaxR of ${avgMaxR.toFixed(
      2
    )}R and volatility ${volatility.toFixed(2)}`,
  };
}

/**
 * Grid search optimization for a pair
 */
export function optimizePairProfile(
  profiles,
  pair,
  trades,
  psychologicalProfile
) {
  const normalizedPair = pair.toUpperCase().replace(/[^A-Z]/g, "");

  const tpLevels = [0.5, 1.0, 1.5, 2.0, 3.0, 5.0];
  const partials = [0.0, 0.3, 0.5, 0.6, 0.7];
  const trailings = [0, 0.5, 1.0, 1.5, 2.0];

  const results = [];

  for (const tp of tpLevels) {
    for (const partial of partials) {
      for (const trail of trailings) {
        // Quick simulation
        const simResult = quickSimulate(trades, {
          tpLevel: tp,
          partialClose: partial,
          trailingStop: trail,
          useBreakeven: true,
        });

        // Psychological score
        const psychScore = calculatePsychScore(simResult, psychologicalProfile);
        const totalScore =
          simResult.expectancy * 10 + psychScore - simResult.maxDD * 2;

        results.push({
          config: { tpLevel: tp, partialClose: partial, trailingStop: trail },
          expectancy: simResult.expectancy,
          winRate: simResult.winRate,
          maxDD: simResult.maxDD,
          psychScore,
          totalScore,
        });
      }
    }
  }

  // Sort by total score
  results.sort((a, b) => b.totalScore - a.totalScore);
  const best = results[0];

  // Update profile with best config
  const updated = updatePairProfile(profiles, normalizedPair, {
    ...best.config,
    optimal: true,
    optimizationScore: best.totalScore,
    optimizationDate: new Date().toISOString(),
  });

  return {
    profiles: updated,
    bestConfig: best,
    topResults: results.slice(0, 10),
  };
}

/**
 * Quick simulation for optimization
 */

function quickSimulate(trades, config) {
  // Use the REAL simulator, not the broken approximation
  const result = simulateEquityCurve(
    trades,
    {
      tpLevel: config.tpLevel,
      partialClose: config.partialClose,
      trailingStop: config.trailingStop,
      useBreakeven: true,
      breakevenTrigger: 0.5,
      breakevenOffset: 0.1,
    },
    10000, // initialBalance
    0.01, // riskPerTrade
    false // useCompounding (simpler for optimization)
  );

  return {
    expectancy: result.summary.expectancy,
    winRate: result.summary.winRate,
    maxDD: result.summary.maxDrawdownPercent,
  };
}

/**
 * Simulate single trade outcome
 */
function simulateOutcome(trade, config) {
  const { tpLevel, partialClose } = config;
  const maxR = trade.MaxR || 0;

  // Check if TP would be hit
  if (maxR >= tpLevel) {
    if (partialClose > 0) {
      // Partial close logic
      const partialProfit = tpLevel * partialClose;
      const runner = maxR > tpLevel ? (maxR - tpLevel) * 0.3 : 0; // Simplified runner
      return partialProfit + runner - (1 - partialClose); // Risk remaining on runner
    }
    return tpLevel;
  }

  // Check if SL hit (simplified)
  if (trade.WorstR <= -1) return -1;

  // Breakeven or small loss
  return -0.5;
}

/**
 * Calculate psychological compatibility score
 */
function calculatePsychScore(simResult, profile) {
  let score = 50;

  // Win rate bonus for conservative
  if (profile.name === "Conservative" && simResult.winRate > 50) score += 20;
  if (profile.name === "Conservative" && simResult.winRate < 40) score -= 20;

  // Drawdown penalty
  if (simResult.maxDD > 15) score -= 30;
  if (simResult.maxDD < 8) score += 20;

  return score;
}

/**
 * Export profiles to JSON
 */
export function exportProfiles(profiles) {
  return JSON.stringify(profiles, null, 2);
}

/**
 * Import profiles from JSON
 */
export function importProfiles(jsonString) {
  try {
    const parsed = JSON.parse(jsonString);
    savePairProfiles(parsed);
    return { success: true, profiles: parsed };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Get all pairs in a correlation group
 */
export function getCorrelationGroup(profiles, group) {
  return Object.values(profiles).filter((p) => p.correlationGroup === group);
}

/**
 * Reset all profiles to defaults
 */
export function resetProfiles() {
  localStorage.removeItem(STORAGE_KEY);
  return { ...DEFAULT_PAIR_PROFILES };
}

export default {
  initPairProfiles,
  savePairProfiles,
  getPairProfile,
  updatePairProfile,
  importBacktestToProfile,
  optimizePairProfile,
  exportProfiles,
  importProfiles,
  getCorrelationGroup,
  resetProfiles,
  DEFAULT_PAIR_PROFILES,
};
