/**
 * Equity Curve Simulator v4.6 - CORRECTED
 * Fixed bugs in position sizing, PnL calculation, and runner logic
 */

export function simulateEquityCurve(
  trades,
  config,
  initialBalance = 10000,
  riskPerTrade = 0.01,
  useCompounding = true
) {
  if (!trades || trades.length === 0) {
    return { error: "No trades provided" };
  }

  const {
    tpLevel = 2.0,
    partialClose = 0.0,
    trailingStop = 0,
    useBreakeven = false,
    breakevenTrigger = 0.5,
    breakevenOffset = 0.1,
    trailingActivation = 1.0,
  } = config;

  let balance = initialBalance;
  let peakBalance = initialBalance;
  let maxDrawdown = 0;
  let maxDrawdownPercent = 0;

  const equityCurve = [
    {
      trade: 0,
      balance: initialBalance,
      drawdown: 0,
      date: trades[0]?.Date || new Date().toISOString(),
    },
  ];

  let totalR = 0;
  let winningTrades = 0;
  let losingTrades = 0;
  let breakevenTrades = 0;

  // Track exit types
  let fullTPhits = 0;
  let partialTPhits = 0;
  let SLhits = 0;
  let BEhits = 0;
  let trailingHits = 0;

  // Stress tracking
  let consecutiveLosses = 0;
  let maxConsecutiveLosses = 0;
  let stressEvents = [];

  for (let i = 0; i < trades.length; i++) {
    const trade = trades[i];

    // Calculate risk amount in currency
    const currentRiskAmount = useCompounding
      ? balance * riskPerTrade
      : initialBalance * riskPerTrade;

    // This is what 1R represents in currency
    const rValue = currentRiskAmount;

    // Determine trade outcome
    const outcome = determineOutcome(trade, tpLevel, partialClose, {
      useBreakeven,
      breakevenTrigger,
      breakevenOffset,
      trailingStop,
      trailingActivation,
    });

    // Calculate PnL in currency
    let pnl = 0;
    let exitType = "";
    let rReturn = 0;

    if (outcome.type === "FULL_TP") {
      // Full position hit TP
      pnl = tpLevel * rValue;
      rReturn = tpLevel;
      exitType = "Full TP";
      fullTPhits++;
      winningTrades++;
      consecutiveLosses = 0;
    } else if (outcome.type === "PARTIAL_TP") {
      // Partial close at TP, runner continues
      const partialSize = partialClose;
      const runnerSize = 1 - partialClose;

      // Close partial at TP
      const partialPnL = tpLevel * rValue * partialSize;
      const partialR = tpLevel * partialSize;

      // Runner continues - calculate ADDITIONAL profit beyond partial TP
      const runnerAdditionalR = simulateRunnerAdditional(
        trade,
        tpLevel,
        trailingStop,
        trailingActivation
      );

      // Runner profit is the ADDITIONAL R beyond where we took partial
      const runnerPnL = runnerAdditionalR * rValue * runnerSize;
      const runnerR = runnerAdditionalR * runnerSize;

      pnl = partialPnL + runnerPnL;
      rReturn = partialR + runnerR;

      exitType = `Partial(${Math.round(
        partialClose * 100
      )}%) + ${runnerAdditionalR.toFixed(1)}R runner`;
      partialTPhits++;

      if (runnerAdditionalR > 0) {
        winningTrades++;
        consecutiveLosses = 0;
      } else if (runnerAdditionalR < 0) {
        losingTrades++;
        consecutiveLosses++;
      } else {
        // Breakeven on runner
        breakevenTrades++;
        consecutiveLosses = 0;
      }
    } else if (outcome.type === "BREAKEVEN") {
      // Moved to BE, small profit on full position
      pnl = breakevenOffset * rValue;
      rReturn = breakevenOffset;
      exitType = "Breakeven";
      BEhits++;
      breakevenTrades++;
      consecutiveLosses = 0;
    } else if (outcome.type === "TRAILING_STOP") {
      // Trailing stop exit on full position
      pnl = outcome.exitR * rValue;
      rReturn = outcome.exitR;
      exitType = `Trailing(${outcome.exitR.toFixed(1)}R)`;
      trailingHits++;

      if (pnl > 0) {
        winningTrades++;
        consecutiveLosses = 0;
      } else {
        losingTrades++;
        consecutiveLosses++;
      }
    } else if (outcome.type === "SL") {
      // Full stop loss
      pnl = -1 * rValue;
      rReturn = -1;
      exitType = "Stop Loss";
      SLhits++;
      losingTrades++;
      consecutiveLosses++;
    }

    // Update consecutive losses tracking
    maxConsecutiveLosses = Math.max(maxConsecutiveLosses, consecutiveLosses);

    // Stress event detection
    if (consecutiveLosses >= 3) {
      stressEvents.push({
        trade: i + 1,
        type: "CONSECUTIVE_LOSSES",
        count: consecutiveLosses,
        balance: balance,
      });
    }

    // Update balance
    balance += pnl;
    totalR += rReturn;

    // Drawdown calculation
    if (balance > peakBalance) {
      peakBalance = balance;
    }
    const currentDD = peakBalance - balance;
    const currentDDpercent = (currentDD / peakBalance) * 100;

    if (currentDD > maxDrawdown) {
      maxDrawdown = currentDD;
      maxDrawdownPercent = currentDDpercent;

      if (currentDDpercent > 10) {
        stressEvents.push({
          trade: i + 1,
          type: "MAJOR_DRAWDOWN",
          drawdown: currentDDpercent,
          balance: balance,
        });
      }
    }

    // Record equity point
    equityCurve.push({
      trade: i + 1,
      balance: balance,
      drawdown: currentDDpercent,
      date: trade.Date,
      pnl: pnl,
      rReturn: rReturn,
      exitType: exitType,
      riskAmount: rValue,
    });
  }

  // Calculate final metrics
  const totalReturn = ((balance - initialBalance) / initialBalance) * 100;
  const totalTrades = trades.length;
  const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
  const expectancy = totalTrades > 0 ? totalR / totalTrades : 0;

  // Profit factor
  const grossProfit = equityCurve
    .filter((e) => e.pnl > 0)
    .reduce((sum, e) => sum + e.pnl, 0);
  const grossLoss = Math.abs(
    equityCurve.filter((e) => e.pnl < 0).reduce((sum, e) => sum + e.pnl, 0)
  );
  const profitFactor =
    grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  // Sharpe Ratio calculation
  const sharpeRatio = calculateSharpeRatio(equityCurve);
  const recoveryFactor = maxDrawdown > 0 ? totalR / maxDrawdown : 0;

  return {
    summary: {
      initialBalance,
      finalBalance: balance,
      totalReturn,
      totalR,
      maxDrawdown,
      maxDrawdownPercent,
      tradeCount: totalTrades,
      winningTrades,
      losingTrades,
      breakevenTrades,
      winRate,
      profitFactor,
      expectancy,
      maxConsecutiveLosses,
      sharpeRatio,
      recoveryFactor,
    },

    exitDistribution: {
      fullTP: fullTPhits,
      partialTP: partialTPhits,
      breakeven: BEhits,
      trailingStop: trailingHits,
      stopLoss: SLhits,
    },

    stressAnalysis: {
      maxConsecutiveLosses,
      stressEventCount: stressEvents.length,
      stressEvents: stressEvents.slice(0, 10),
    },

    equityCurve,

    chartData: {
      labels: equityCurve.map((e) => e.trade),
      balances: equityCurve.map((e) => e.balance),
      drawdowns: equityCurve.map((e) => e.drawdown),
    },
  };
}

function determineOutcome(trade, tpLevel, partialClose, config) {
  const {
    useBreakeven,
    breakevenTrigger,
    breakevenOffset,
    trailingStop,
    trailingActivation,
  } = config;

  // Check if TP level was hit using milestone columns or ExitR
  const exitR = parseFloat(trade.ExitR) || null;
  const maxR = parseFloat(trade.MaxR) || 0;

  // If we have actual ExitR data, use that for accuracy
  if (exitR !== null && !isNaN(exitR)) {
    // Check for full TP hit
    if (exitR >= tpLevel - 0.01) {
      return {
        type: partialClose > 0 ? "PARTIAL_TP" : "FULL_TP",
        tpLevel,
      };
    }

    // Check for stop loss
    if (exitR <= -0.99) {
      return { type: "SL" };
    }

    // Check for breakeven (small positive exit)
    if (
      useBreakeven &&
      exitR > 0 &&
      exitR < tpLevel &&
      exitR >= breakevenOffset
    ) {
      // Check if we hit breakeven trigger level during trade
      if (maxR >= breakevenTrigger) {
        return { type: "BREAKEVEN", offset: exitR };
      }
    }

    // Small profit/loss - treat as trailing stop result
    if (exitR > -1 && exitR < tpLevel) {
      return { type: "TRAILING_STOP", exitR };
    }
  }

  // Fallback to milestone data
  const tpTimeCol = `TimeTo${tpLevel}R`;
  const tpTime =
    trade[tpTimeCol] || trade[`TimeTo${tpLevel.toFixed(1)}R`] || null;
  const slTime = trade.TimeToSL || null;

  const rHit = tpTime && tpTime !== "Expired" && tpTime !== "";
  const slHit = slTime && slTime !== "Expired" && slTime !== "";

  if (rHit && slHit) {
    // Both hit - check which came first (simplified: assume TP if both exist)
    return {
      type: partialClose > 0 ? "PARTIAL_TP" : "FULL_TP",
      tpLevel,
    };
  }

  if (rHit && !slHit) {
    return {
      type: partialClose > 0 ? "PARTIAL_TP" : "FULL_TP",
      tpLevel,
    };
  }

  if (!rHit && slHit) {
    return { type: "SL" };
  }

  // Neither hit - check for trailing stop opportunity
  if (trailingStop > 0 && maxR >= trailingActivation + trailingStop) {
    const trailExit = Math.max(0.5, maxR - trailingStop);
    return { type: "TRAILING_STOP", exitR: trailExit };
  }

  // Check if we at least made some profit for breakeven
  if (useBreakeven && maxR >= breakevenTrigger) {
    return { type: "BREAKEVEN", offset: breakevenOffset };
  }

  // Expired or unknown - check MaxR for any profit
  if (maxR > 0.5) {
    return { type: "TRAILING_STOP", exitR: Math.min(maxR, tpLevel) };
  }

  // Default to SL
  return { type: "SL" };
}

/**
 * Calculate ADDITIONAL R profit for runner beyond the partial TP level
 * Returns the R value ABOVE tpLevel (not absolute)
 */
function simulateRunnerAdditional(
  trade,
  tpLevel,
  trailingStop,
  trailingActivation
) {
  const maxR = parseFloat(trade.MaxR) || 0;

  // Check if runner hit higher TP levels
  for (let r = tpLevel + 0.5; r <= 20; r += 0.5) {
    const timeCol = `TimeTo${r}R`;
    if (
      trade[timeCol] &&
      trade[timeCol] !== "Expired" &&
      trade[timeCol] !== ""
    ) {
      // Hit higher TP - return ADDITIONAL R beyond our partial level
      return r - tpLevel;
    }
  }

  // Check trailing stop - runner was trailed out
  if (trailingStop > 0 && maxR >= trailingActivation + trailingStop) {
    // Trailing stop executes at maxR - trailingStop
    const trailExit = Math.max(tpLevel, maxR - trailingStop);
    return trailExit - tpLevel; // ADDITIONAL profit beyond tpLevel
  }

  // Check if SL was hit on runner
  if (trade.TimeToSL && trade.TimeToSL !== "Expired") {
    // Runner hit SL - we lose the remaining runner portion
    // But we already banked partial at tpLevel, so runner goes to -1R relative to entry
    // However, since we took partial at tpLevel, the runner loss is from that point
    // Actually, if SL is hit, the runner loses 1R + whatever tpLevel was
    // But we need to think of it as: partial gave us tpLevel, runner gives us -1 (relative to entry)
    // So net for runner portion is: -1 - tpLevel? No that's wrong too.

    // Correct: Runner is stopped out at -1R (full SL)
    // But we need return RELATIVE to the partial profit level
    // If we took 60% at 2R, and runner hits SL, we get 40% * (-1R - 2R) = 40% * -3R? No...

    // Actually simpler: The runner is a new position with entry at 0 (breakeven after partial)
    // If it hits SL, it loses 1R relative to original entry, but we already have 2R from partial
    // So the runner contributes: -1R (it goes to SL)
    return -1;
  }

  // Expired or unknown - runner made no additional profit
  // Return whatever maxR achieved beyond tpLevel, or 0 if never got there
  if (maxR > tpLevel) {
    // Made some profit but didn't hit next milestone
    return Math.min(maxR - tpLevel, trailingStop > 0 ? trailingStop : 0.5);
  }

  // Runner never exceeded tpLevel
  return 0;
}

function calculateSharpeRatio(equityCurve) {
  if (!equityCurve || equityCurve.length < 2) return 0;

  const returns = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const current = equityCurve[i].balance;
    const previous = equityCurve[i - 1].balance;
    const returnPct =
      previous > 0 ? ((current - previous) / previous) * 100 : 0;
    returns.push(returnPct);
  }

  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) /
    returns.length;
  const stdDev = Math.sqrt(variance);

  return stdDev > 0 ? avgReturn / stdDev : 0;
}

export default simulateEquityCurve;
