/**
 * Psychological Stress Test Engine v4.6
 * Calculates abandonment risk and psychological fit for trading strategies
 */

// Behavioral finance constants based on research
const BEHAVIORAL_CONSTANTS = {
  LOSS_AVERSION_MULTIPLIER: 2.25, // Kahneman/Tversky - losses hurt 2.25x more than gains feel good
  RECENCY_DECAY_DAYS: 30, // Recent trades weighted more heavily
  MAX_DRAWDOWN_PAIN_THRESHOLD: 0.15, // 15% DD is where most retail traders quit
  CONSECUTIVE_LOSS_LIMIT: 5, // Psychological breaking point
  FREQUENCY_PREFERENCE_DAYS: 7, // Traders prefer at least 1 trade per week
};

// Psychological profile templates
export const PSYCHOLOGICAL_PROFILES = {
  conservative: {
    name: "Conservative",
    maxDrawdownTolerance: 0.1, // 10% max DD
    lossAversionFactor: 2.5, // Very high loss aversion
    preferredTradeFrequency: "high", // Needs frequent feedback
    needsFrequentFeedback: true,
    recoveryStyle: "gradual", // Slow and steady
    partialClosePreference: 0.6, // 60% partials preferred
    description:
      "Prefers frequent small wins, tight risk control, cannot tolerate long drawdowns",
  },
  balanced: {
    name: "Balanced",
    maxDrawdownTolerance: 0.15,
    lossAversionFactor: 2.0,
    preferredTradeFrequency: "medium",
    needsFrequentFeedback: true,
    recoveryStyle: "moderate",
    partialClosePreference: 0.5,
    description:
      "Accepts moderate risk for better returns, can handle short drawdowns",
  },
  aggressive: {
    name: "Aggressive",
    maxDrawdownTolerance: 0.25,
    lossAversionFactor: 1.5,
    preferredTradeFrequency: "low",
    needsFrequentFeedback: false,
    recoveryStyle: "aggressive",
    partialClosePreference: 0.3,
    description:
      "Focuses on maximum returns, can tolerate significant drawdowns for home runs",
  },
};

/**
 * Calculate psychological stress test for a strategy
 * @param {Array} trades - Array of trade objects with ExitR, Date, etc.
 * @param {Object} profile - Psychological profile (conservative/balanced/aggressive)
 * @param {Object} strategyConfig - { tpLevel, partialClose, trailingStop, useBreakeven }
 * @returns {Object} Complete stress test results
 */
export function psychologicalStressTest(trades, profile, strategyConfig) {
  if (!trades || trades.length === 0) {
    return { error: "No trades provided" };
  }

  const results = {
    profile: profile,
    strategyConfig: strategyConfig,
    tradeCount: trades.length,

    // Risk factors (0-100 scale)
    riskFactors: {
      drawdownRisk: 0,
      recencyRisk: 0,
      frequencyRisk: 0,
      egoRisk: 0,
    },

    // Calculated metrics
    abandonmentRisk: 0, // 0-100% chance of quitting
    realizedExpectancy: 0, // Math expectancy × (1 - abandonment risk)
    psychologicalVerdict: "", // SUSTAINABLE / STRESSFUL / LIKELY_ABANDON

    // Detailed analysis
    maxDrawdown: 0,
    maxConsecutiveLosses: 0,
    avgTradesPerWeek: 0,
    worstTrade: 0,
    recoveryTimeAvg: 0,

    // Recommendations
    recommendations: [],
  };

  // 1. Calculate Drawdown Risk (35% weight)
  results.maxDrawdown = calculateMaxDrawdown(trades);
  const ddRatio = results.maxDrawdown / profile.maxDrawdownTolerance;
  results.riskFactors.drawdownRisk = Math.min(100, ddRatio * 70); // Exponential penalty

  if (results.maxDrawdown > profile.maxDrawdownTolerance * 1.5) {
    results.riskFactors.drawdownRisk = 95; // Near-certain abandonment
  }

  // 2. Calculate Recency Risk (25% weight)
  results.riskFactors.recencyRisk = calculateRecencyRisk(trades, profile);

  // 3. Calculate Frequency Risk (20% weight)
  results.avgTradesPerWeek = calculateTradeFrequency(trades);
  const freqPreference =
    profile.preferredTradeFrequency === "high"
      ? 3
      : profile.preferredTradeFrequency === "medium"
      ? 1.5
      : 0.5;

  if (results.avgTradesPerWeek < freqPreference * 0.5) {
    results.riskFactors.frequencyRisk = 80; // Too few trades = boredom/impulse trading
  } else if (results.avgTradesPerWeek < freqPreference) {
    results.riskFactors.frequencyRisk = 50;
  } else {
    results.riskFactors.frequencyRisk = 10;
  }

  // 4. Calculate Ego Risk (20% weight)
  results.maxConsecutiveLosses = calculateMaxConsecutiveLosses(trades);
  results.worstTrade = Math.min(...trades.map((t) => t.ExitR || 0));

  const consecPenalty =
    results.maxConsecutiveLosses > BEHAVIORAL_CONSTANTS.CONSECUTIVE_LOSS_LIMIT
      ? (results.maxConsecutiveLosses -
          BEHAVIORAL_CONSTANTS.CONSECUTIVE_LOSS_LIMIT) *
        15
      : 0;

  const worstTradePenalty =
    results.worstTrade < -2 ? Math.abs(results.worstTrade) * 10 : 0;
  results.riskFactors.egoRisk = Math.min(
    100,
    consecPenalty + worstTradePenalty
  );

  // Calculate weighted abandonment risk
  results.abandonmentRisk =
    results.riskFactors.drawdownRisk * 0.35 +
    results.riskFactors.recencyRisk * 0.25 +
    results.riskFactors.frequencyRisk * 0.2 +
    results.riskFactors.egoRisk * 0.2;

  // Calculate realized expectancy
  const mathExpectancy =
    trades.reduce((sum, t) => sum + (t.ExitR || 0), 0) / trades.length;
  results.realizedExpectancy =
    mathExpectancy * (1 - results.abandonmentRisk / 100);

  // Generate verdict
  if (results.abandonmentRisk < 30) {
    results.psychologicalVerdict = "SUSTAINABLE";
  } else if (results.abandonmentRisk < 60) {
    results.psychologicalVerdict = "STRESSFUL";
  } else {
    results.psychologicalVerdict = "LIKELY_TO_ABANDON";
  }

  // Generate personalized recommendations
  results.recommendations = generateRecommendations(
    results,
    profile,
    strategyConfig
  );

  return results;
}

/**
 * Calculate maximum drawdown from equity curve
 */
function calculateMaxDrawdown(trades) {
  let peak = 0;
  let maxDD = 0;
  let runningPnl = 0;

  for (const trade of trades) {
    runningPnl += trade.ExitR || 0;
    if (runningPnl > peak) peak = runningPnl;
    const dd = peak - runningPnl;
    if (dd > maxDD) maxDD = dd;
  }

  return maxDD;
}

/**
 * Calculate recency-weighted risk (recent losses hurt more)
 */
function calculateRecencyRisk(trades, profile) {
  const now = new Date();
  const recentTrades = trades.slice(-20); // Last 20 trades

  let weightedLosses = 0;
  let totalWeight = 0;

  recentTrades.forEach((trade, idx) => {
    const daysAgo = (now - new Date(trade.Date)) / (1000 * 60 * 60 * 24);
    const weight = Math.exp(-daysAgo / BEHAVIORAL_CONSTANTS.RECENCY_DECAY_DAYS);

    if ((trade.ExitR || 0) < 0) {
      weightedLosses +=
        Math.abs(trade.ExitR) * weight * profile.lossAversionFactor;
    }
    totalWeight += weight;
  });

  const recencyScore =
    totalWeight > 0 ? (weightedLosses / totalWeight) * 20 : 0;
  return Math.min(100, recencyScore);
}

/**
 * Calculate average trades per week
 */
function calculateTradeFrequency(trades) {
  if (trades.length < 2) return 0;

  const dates = trades.map((t) => new Date(t.Date)).sort((a, b) => a - b);
  const firstDate = dates[0];
  const lastDate = dates[dates.length - 1];
  const weeks = (lastDate - firstDate) / (1000 * 60 * 60 * 24 * 7);

  return weeks > 0 ? trades.length / weeks : trades.length;
}

/**
 * Calculate maximum consecutive losses
 */
function calculateMaxConsecutiveLosses(trades) {
  let maxConsec = 0;
  let currentConsec = 0;

  for (const trade of trades) {
    if ((trade.ExitR || 0) < 0) {
      currentConsec++;
      maxConsec = Math.max(maxConsec, currentConsec);
    } else {
      currentConsec = 0;
    }
  }

  return maxConsec;
}

/**
 * Generate personalized recommendations
 */
function generateRecommendations(results, profile, config) {
  const recs = [];

  // Drawdown recommendations
  if (results.riskFactors.drawdownRisk > 50) {
    recs.push({
      type: "warning",
      priority: "high",
      message: `Max drawdown (${results.maxDrawdown.toFixed(
        2
      )}R) exceeds your ${(profile.maxDrawdownTolerance * 100).toFixed(
        0
      )}% tolerance. Consider reducing position size or using partial closes.`,
    });
  }

  // Frequency recommendations
  if (results.riskFactors.frequencyRisk > 50 && profile.needsFrequentFeedback) {
    recs.push({
      type: "suggestion",
      priority: "medium",
      message: `Only ${results.avgTradesPerWeek.toFixed(
        1
      )} trades/week may cause boredom. Consider adding correlated pairs or lowering TP for more frequent feedback.`,
    });
  }

  // Partial close recommendations
  if (
    config.partialClose < profile.partialClosePreference &&
    results.riskFactors.drawdownRisk > 40
  ) {
    recs.push({
      type: "optimization",
      priority: "high",
      message: `Increase partial closes to ${(
        profile.partialClosePreference * 100
      ).toFixed(0)}% to lock in profits and reduce drawdown anxiety.`,
    });
  }

  // Breakeven recommendations
  if (!config.useBreakeven && results.maxConsecutiveLosses > 3) {
    recs.push({
      type: "psychology",
      priority: "medium",
      message:
        "Consider breakeven stops after +0.5R to protect against giving back profits - reduces regret significantly.",
    });
  }

  // TP level recommendations
  if (config.tpLevel > 3 && profile.name === "Conservative") {
    recs.push({
      type: "psychology",
      priority: "high",
      message: `${config.tpLevel}R targets may be too ambitious for your profile. Try 1R-1.5R for more frequent wins and better psychological sustainability.`,
    });
  }

  // Consecutive loss handling
  if (
    results.maxConsecutiveLosses > BEHAVIORAL_CONSTANTS.CONSECUTIVE_LOSS_LIMIT
  ) {
    recs.push({
      type: "warning",
      priority: "high",
      message: `${results.maxConsecutiveLosses} consecutive losses detected. This tests emotional limits. Consider reducing risk per trade or taking a break protocol.`,
    });
  }

  // Positive reinforcement
  if (results.abandonmentRisk < 30) {
    recs.push({
      type: "success",
      priority: "low",
      message:
        "This configuration matches your psychological profile well. You're likely to stick with it through drawdowns.",
    });
  }

  return recs;
}

/**
 * Compare multiple scenarios side by side
 */
export function compareScenarios(trades, profile, scenarios) {
  return scenarios
    .map((scenario) => {
      const result = psychologicalStressTest(trades, profile, scenario);
      return {
        name: scenario.name,
        config: scenario,
        abandonmentRisk: result.abandonmentRisk,
        realizedExpectancy: result.realizedExpectancy,
        verdict: result.psychologicalVerdict,
        riskFactors: result.riskFactors,
      };
    })
    .sort((a, b) => b.realizedExpectancy - a.realizedExpectancy);
}

/**
 * Get optimal configuration for psychological profile
 */
export function getOptimalPsychologicalConfig(profile, pair = "GENERIC") {
  const configs = {
    conservative: {
      tpLevel: 1.0,
      partialClose: 0.6,
      trailingStop: 1.0,
      useBreakeven: true,
      breakevenTrigger: 0.5,
      breakevenOffset: 0.1,
    },
    balanced: {
      tpLevel: 2.0,
      partialClose: 0.5,
      trailingStop: 1.5,
      useBreakeven: true,
      breakevenTrigger: 0.5,
      breakevenOffset: 0.1,
    },
    aggressive: {
      tpLevel: 5.0,
      partialClose: 0.3,
      trailingStop: 2.0,
      useBreakeven: false,
      breakevenTrigger: 1.0,
      breakevenOffset: 0.0,
    },
  };

  return configs[profile.name.toLowerCase()] || configs.balanced;
}

export default psychologicalStressTest;
