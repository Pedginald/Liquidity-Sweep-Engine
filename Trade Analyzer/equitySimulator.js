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
  let expiredHits = 0;

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

      // Close partial at TP - this is locked in profit
      const partialR = tpLevel * partialSize;
      const partialPnL = partialR * rValue;

      // Runner continues - calculate ADDITIONAL profit/loss beyond partial TP
      const runnerAdditionalR = simulateRunnerAdditional(
        trade,
        tpLevel,
        trailingStop,
        trailingActivation,
        runnerSize // Pass runner size for correct SL calculation
      );

      // Runner profit/loss is the ADDITIONAL R beyond tpLevel, scaled by runner size
      const runnerR = runnerAdditionalR * runnerSize;
      const runnerPnL = runnerR * rValue;

      // Total return combines partial (at tpLevel) + runner (additional beyond tpLevel)
      rReturn = partialR + runnerR;
      pnl = partialPnL + runnerPnL;

      exitType = `Partial(${Math.round(
        partialClose * 100
      )}%) + ${runnerAdditionalR.toFixed(1)}R runner`;
      partialTPhits++;

      // Determine if this was a net win, loss, or breakeven
      if (rReturn > 0.1) {
        winningTrades++;
        consecutiveLosses = 0;
      } else if (rReturn < -0.1) {
        losingTrades++;
        consecutiveLosses++;
      } else {
        // Breakeven on total position
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
    } else if (outcome.type === "EXPIRED") {
      // Trade expired - use MaxR or 0 if no profit achieved
      const expiredR = Math.max(0, Math.min(trade.MaxR || 0, tpLevel));
      pnl = expiredR * rValue;
      rReturn = expiredR;
      exitType = `Expired(${expiredR.toFixed(1)}R)`;
      expiredHits++;

      if (expiredR > 0.1) {
        winningTrades++;
        consecutiveLosses = 0;
      } else if (expiredR < -0.1) {
        losingTrades++;
        consecutiveLosses++;
      } else {
        breakevenTrades++;
        consecutiveLosses = 0;
      }
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
      expired: expiredHits,
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

  // Parse key values
  const exitR = parseFloat(trade.ExitR);
  const maxR = parseFloat(trade.MaxR) || 0;
  const worstR = parseFloat(trade.WorstR) || 0;

  // Check if we have valid ExitR data
  const hasValidExitR = !isNaN(exitR) && exitR !== null;

  if (hasValidExitR) {
    // Check for full TP hit (within small tolerance for floating point)
    if (exitR >= tpLevel - 0.01) {
      return {
        type: partialClose > 0 ? "PARTIAL_TP" : "FULL_TP",
        tpLevel,
      };
    }

    // Check for stop loss (at or beyond -1R)
    if (exitR <= -0.99) {
      return { type: "SL" };
    }

    // Check for breakeven (small positive exit, triggered BE level was hit)
    if (
      useBreakeven &&
      exitR >= 0 &&
      exitR < breakevenOffset * 2 && // Reasonable BE range
      maxR >= breakevenTrigger
    ) {
      return { type: "BREAKEVEN", offset: exitR };
    }

    // Check for trailing stop result (positive but less than TP)
    if (exitR > 0 && exitR < tpLevel && maxR >= trailingActivation) {
      return { type: "TRAILING_STOP", exitR };
    }

    // Small loss but not full SL (partial trailing stop or early exit)
    if (exitR > -1 && exitR < 0) {
      return { type: "TRAILING_STOP", exitR };
    }

    // Expired with some profit
    if (exitR >= 0 && exitR < tpLevel) {
      return { type: "EXPIRED", exitR };
    }
  }

  // Fallback to milestone data analysis
  return determineOutcomeFromMilestones(
    trade,
    tpLevel,
    partialClose,
    {
      useBreakeven,
      breakevenTrigger,
      breakevenOffset,
      trailingStop,
      trailingActivation,
    },
    maxR,
    worstR
  );
}

/**
 * Determine outcome using milestone columns when ExitR is not available
 */
function determineOutcomeFromMilestones(
  trade,
  tpLevel,
  partialClose,
  config,
  maxR,
  worstR
) {
  const {
    useBreakeven,
    breakevenTrigger,
    breakevenOffset,
    trailingStop,
    trailingActivation,
  } = config;

  // Check if TP level was hit
  const tpTimeCol = `TimeTo${tpLevel}R`;
  const tpTime =
    trade[tpTimeCol] || trade[`TimeTo${tpLevel.toFixed(1)}R`] || null;
  const slTime = trade.TimeToSL || null;

  const rHit = tpTime && tpTime !== "Expired" && tpTime !== "";
  const slHit = slTime && slTime !== "Expired" && slTime !== "";

  // Check for time-based expiration
  const isExpired = tpTime === "Expired" || slTime === "Expired";

  if (rHit && !slHit) {
    // TP hit, no SL
    return {
      type: partialClose > 0 ? "PARTIAL_TP" : "FULL_TP",
      tpLevel,
    };
  }

  if (!rHit && slHit) {
    // SL hit, no TP
    return { type: "SL" };
  }

  if (rHit && slHit) {
    // Both hit - need to determine which came first
    // This is a simplification; ideally we'd parse the datetime strings
    // For now, assume TP if both exist (conservative for backtesting)
    return {
      type: partialClose > 0 ? "PARTIAL_TP" : "FULL_TP",
      tpLevel,
    };
  }

  // Neither TP nor SL hit - check other exit conditions

  // Check for trailing stop (price went beyond activation then pulled back)
  if (trailingStop > 0 && maxR >= trailingActivation) {
    // Trailing stop would execute at maxR - trailingStop, but not less than BE
    const trailExit = Math.max(breakevenOffset, maxR - trailingStop);
    return { type: "TRAILING_STOP", exitR: trailExit };
  }

  // Check for breakeven (hit trigger but no TP)
  if (useBreakeven && maxR >= breakevenTrigger) {
    return { type: "BREAKEVEN", offset: breakevenOffset };
  }

  // Expired trade
  if (isExpired) {
    return { type: "EXPIRED", exitR: Math.max(0, maxR) };
  }

  // Check if we at least made some profit
  if (maxR > 0.5) {
    return { type: "TRAILING_STOP", exitR: Math.min(maxR, tpLevel) };
  }

  // Default to SL if WorstR suggests we hit stop
  if (worstR <= -0.9) {
    return { type: "SL" };
  }

  // Unknown outcome - assume breakeven/small loss
  return { type: "TRAILING_STOP", exitR: Math.max(0, maxR) };
}

/**
 * Calculate ADDITIONAL R profit/loss for runner beyond the partial TP level
 *
 * CRITICAL FIX: This now correctly handles the runner's position size
 * and computes returns relative to the entry price, not the partial TP level.
 *
 * @param {Object} trade - Trade data
 * @param {number} tpLevel - The R level where partial close occurred
 * @param {number} trailingStop - Trailing stop distance in R
 * @param {number} trailingActivation - Level where trailing stop activates
 * @param {number} runnerSize - Size of runner position (0-1)
 * @returns {number} Additional R return for the runner portion
 */
function simulateRunnerAdditional(
  trade,
  tpLevel,
  trailingStop,
  trailingActivation,
  runnerSize
) {
  const maxR = parseFloat(trade.MaxR) || 0;
  const exitR = parseFloat(trade.ExitR);
  const hasExitR = !isNaN(exitR);

  // Check if runner hit higher TP levels (2R, 3R, etc.)
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

  // Check if we have explicit ExitR data for the runner
  if (hasExitR && exitR > tpLevel) {
    // Runner exited above partial TP level
    return exitR - tpLevel;
  }

  // Check trailing stop on runner
  if (trailingStop > 0 && maxR >= trailingActivation) {
    // Trailing stop executes at maxR - trailingStop
    const trailExit = Math.max(tpLevel, maxR - trailingStop);
    return trailExit - tpLevel; // ADDITIONAL profit beyond tpLevel
  }

  // Check if SL was hit on runner
  // CRITICAL FIX: If SL is hit, the runner loses from entry to SL (-1R total)
  // But we already banked tpLevel from the partial
  // So the runner's contribution is: (partialClose * tpLevel) + (runnerSize * -1) = total
  // We want the runner's ADDITIONAL return beyond tpLevel
  // Since runner goes to SL (-1R), and we already counted tpLevel for partial
  // The runner's additional return is: -1 - tpLevel (relative to entry)
  // But wait - that's wrong too because it double counts

  // CORRECT MATH:
  // Partial: 60% @ 2R = 1.2R contribution to total
  // Runner: 40% @ -1R = -0.4R contribution to total
  // Total: 0.8R
  //
  // This function returns the runner's return PER UNIT OF RUNNER SIZE
  // So if runner hits SL, it returns -1 (the R value for that portion)
  // The caller multiplies by runnerSize

  const slTime = trade.TimeToSL;
  if (slTime && slTime !== "Expired" && slTime !== "") {
    // Runner hit SL - returns -1R (full loss on that portion)
    return -1;
  }

  // Check if runner was stopped out at breakeven or small profit/loss
  if (hasExitR && exitR < tpLevel && exitR > -1) {
    // Runner exited somewhere between BE and TP
    // Return is relative to entry, so just return exitR
    // But since we want ADDITIONAL beyond tpLevel, and exitR < tpLevel
    // This is actually a loss on the runner portion
    return exitR; // This will be negative or small positive
  }

  // Expired or unknown - runner made no additional profit beyond tpLevel
  // Return whatever maxR achieved beyond tpLevel, or 0 if never got there
  if (maxR > tpLevel) {
    // Made some profit but didn't hit next milestone
    // Assume we captured some portion of the move
    const capture = Math.min(maxR - tpLevel, 0.5); // Conservative: max 0.5R extra
    return capture;
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

/**
 * Compare multiple TP scenarios side by side
 */
export function compareTPscenarios(
  trades,
  scenarios,
  initialBalance = 10000,
  riskPerTrade = 0.01,
  useCompounding = true
) {
  return scenarios.map((scenario) => {
    const result = simulateEquityCurve(
      trades,
      scenario,
      initialBalance,
      riskPerTrade,
      useCompounding
    );
    return {
      name: scenario.name || `${scenario.tpLevel}R`,
      config: scenario,
      summary: result.summary,
      exitDistribution: result.exitDistribution,
      chartData: result.chartData,
    };
  });
}

export default simulateEquityCurve;
