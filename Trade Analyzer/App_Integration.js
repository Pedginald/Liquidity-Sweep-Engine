// App.js Integration Instructions v4.6
// ============================================

// STEP 1: Add imports at top of App.js
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

// STEP 2: Add to TABS array (around line 50-70 where other tabs are defined)
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
];

// STEP 3: Add tab content rendering (in your main render/switch statement)
// Find where you render tabs based on activeTab state, add:

{
  tab === 7 && <TabPortfolioSimulator trades={filteredTrades} T={T} />;
}

{
  tab === 8 && <TabPsychologicalFit trades={filteredTrades} T={T} />;
}

// STEP 4: Optional - Add pair profile state to App.js for persistence
// In your component state:
const [pairProfiles, setPairProfiles] = useState(() => initPairProfiles());

// STEP 5: Optional - Auto-import backtest data to profiles when CSV loads
// In your CSV load handler:
useEffect(() => {
  if (trades.length > 0) {
    // Group trades by pair and auto-import
    const byPair = groupBy(trades, "Pair");
    Object.entries(byPair).forEach(([pair, pairTrades]) => {
      if (pairTrades.length >= 10) {
        importBacktestToProfile(pairProfiles, pair, pairTrades);
      }
    });
  }
}, [trades]);
