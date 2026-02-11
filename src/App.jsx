import { useState, useMemo, useRef, useEffect, useCallback } from "react";

// ── Data fetching ──────────────────────────────────────────
async function fetchHistory(ticker) {
  const res = await fetch(`/api/history/${encodeURIComponent(ticker)}`);
  if (!res.ok) throw new Error(`Failed to fetch ${ticker}`);
  return res.json();
}

async function searchTickers(query) {
  if (!query || query.length < 1) return [];
  const res = await fetch(`/api/search/${encodeURIComponent(query)}`);
  if (!res.ok) return [];
  return res.json();
}

// ── Stats helpers ──────────────────────────────────────────
function computeReturns(prices, period) {
  const step = period === "daily" ? 1 : period === "weekly" ? 5 : 21;
  const returns = [];
  for (let i = step; i < prices.length; i += step) {
    returns.push({
      ret: (prices[i].close - prices[i - step].close) / prices[i - step].close,
      date: prices[i].date,
    });
  }
  return returns;
}

// Full-sample: one mean & std for the entire range
function computeStatsFullSample(returns) {
  const n = returns.length;
  if (n === 0) return { mean: 0, std: 0, data: [] };
  const vals = returns.map((r) => r.ret);
  const mean = vals.reduce((a, b) => a + b, 0) / n;
  const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1 || 1);
  const std = Math.sqrt(variance);
  return {
    mean, std,
    data: returns.map((r) => ({ ...r, z: std === 0 ? 0 : (r.ret - mean) / std })),
  };
}

// Rolling window: each bar's z-score is relative to the prior `window` periods
function computeStatsRolling(returns, windowSize) {
  const data = [];
  let totalMean = 0;
  let totalStd = 0;
  let validCount = 0;

  for (let i = 0; i < returns.length; i++) {
    if (i < windowSize) {
      const slice = returns.slice(0, i + 1).map((r) => r.ret);
      const n = slice.length;
      const mean = slice.reduce((a, b) => a + b, 0) / n;
      const variance = n > 1 ? slice.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
      const std = Math.sqrt(variance);
      const z = std === 0 ? 0 : (returns[i].ret - mean) / std;
      data.push({ ...returns[i], z, localMean: mean, localStd: std });
      totalMean += mean;
      totalStd += std;
      validCount++;
    } else {
      const slice = returns.slice(i - windowSize, i).map((r) => r.ret);
      const n = slice.length;
      const mean = slice.reduce((a, b) => a + b, 0) / n;
      const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1 || 1);
      const std = Math.sqrt(variance);
      const z = std === 0 ? 0 : (returns[i].ret - mean) / std;
      data.push({ ...returns[i], z, localMean: mean, localStd: std });
      totalMean += mean;
      totalStd += std;
      validCount++;
    }
  }

  const mean = validCount > 0 ? totalMean / validCount : 0;
  const std = validCount > 0 ? totalStd / validCount : 0;
  return { mean, std, data };
}

function formatDate(dateStr, period) {
  const d = new Date(dateStr + "T00:00:00");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  if (period === "monthly") return `${months[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`;
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

const PERIODS = [
  { key: "daily", label: "D", full: "Daily" },
  { key: "weekly", label: "W", full: "Weekly" },
  { key: "monthly", label: "M", full: "Monthly" },
];

const SIGMA_MODES = [
  { key: "full", label: "Full Sample", desc: "σ computed across entire date range" },
  { key: "rolling", label: "Rolling Window", desc: "σ computed from prior N periods — better for detecting regime changes" },
];

const ROLLING_WINDOWS = [
  { key: 20, label: "20" },
  { key: 60, label: "60" },
  { key: 120, label: "120" },
  { key: 252, label: "252" },
];

const CHART_HEIGHT = 480;
const PAD_L = 56;
const PAD_R = 16;
const PAD_T = 40;
const PAD_B = 72;
const MAX_SIGMA_SCALE = 5;

export default function App() {
  const [ticker, setTicker] = useState("SPY");
  const [inputVal, setInputVal] = useState("SPY");
  const [period, setPeriod] = useState("daily");
  const [threshold, setThreshold] = useState(2.0);
  const [sigmaMode, setSigmaMode] = useState("rolling");
  const [rollingWindow, setRollingWindow] = useState(60);
  const [priceData, setPriceData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchResults, setSearchResults] = useState([]);
  const [showSearch, setShowSearch] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [hoveredBar, setHoveredBar] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const searchTimeout = useRef(null);
  const inputRef = useRef(null);

  const loadTicker = useCallback(async (sym) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchHistory(sym);
      setPriceData(data);
      setTicker(sym);
      if (data.prices.length > 0) {
        setStartDate(data.prices[0].date);
        setEndDate(data.prices[data.prices.length - 1].date);
      }
    } catch (err) {
      setError(`Could not load "${sym}". Check the ticker and try again.`);
      setPriceData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadTicker("SPY"); }, []);

  const handleInputChange = (val) => {
    setInputVal(val.toUpperCase());
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (val.length >= 1) {
      searchTimeout.current = setTimeout(async () => {
        const results = await searchTickers(val);
        setSearchResults(results);
        setShowSearch(true);
      }, 300);
    } else {
      setSearchResults([]);
      setShowSearch(false);
    }
  };

  const selectTicker = (sym) => {
    setInputVal(sym);
    setShowSearch(false);
    setSearchResults([]);
    loadTicker(sym);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      setShowSearch(false);
      loadTicker(inputVal);
    }
  };

  const returns = useMemo(() => {
    if (!priceData?.prices) return [];
    return computeReturns(priceData.prices, period);
  }, [priceData, period]);

  const { mean, std, data: allData } = useMemo(() => {
    if (sigmaMode === "rolling") return computeStatsRolling(returns, rollingWindow);
    return computeStatsFullSample(returns);
  }, [returns, sigmaMode, rollingWindow]);

  const filteredData = useMemo(() => {
    if (!startDate || !endDate) return allData;
    return allData.filter((d) => d.date >= startDate && d.date <= endDate);
  }, [allData, startDate, endDate]);

  const drawH = CHART_HEIGHT - PAD_T - PAD_B;
  const midY = PAD_T + drawH / 2;
  const maxAbs = MAX_SIGMA_SCALE;

  const beyondThreshold = filteredData.filter((d) => Math.abs(d.z) >= threshold).length;
  const pctBeyond = filteredData.length > 0 ? ((beyondThreshold / filteredData.length) * 100).toFixed(1) : "0.0";
  const clippedBars = filteredData.filter((d) => Math.abs(d.z) > MAX_SIGMA_SCALE).length;

  const barWidth = useMemo(() => {
    const c = filteredData.length;
    if (c <= 15) return 28; if (c <= 30) return 18; if (c <= 60) return 10;
    if (c <= 120) return 6; if (c <= 250) return 3.5;
    return Math.max(1.5, 800 / c);
  }, [filteredData]);

  const gap = Math.max(1, barWidth * 0.2);
  const chartWidth = Math.max(700, PAD_L + filteredData.length * (barWidth + gap) + PAD_R);

  const labelInterval = useMemo(() => {
    const c = filteredData.length;
    if (c <= 20) return 1; if (c <= 50) return 5; if (c <= 100) return 10;
    if (c <= 200) return 20; return Math.ceil(c / 15);
  }, [filteredData]);

  const setPreset = (months) => {
    if (!priceData?.prices?.length) return;
    const last = priceData.prices[priceData.prices.length - 1].date;
    const first = priceData.prices[0].date;
    if (months === 999) { setStartDate(first); setEndDate(last); return; }
    const end = new Date(last + "T00:00:00");
    const start = new Date(end);
    start.setMonth(start.getMonth() - months);
    const startStr = start.toISOString().split("T")[0];
    setStartDate(startStr < first ? first : startStr);
    setEndDate(last);
  };

  const handleBarHover = (d, i, e) => {
    const svgRect = e.currentTarget.closest("svg").getBoundingClientRect();
    const barRect = e.currentTarget.getBoundingClientRect();
    setHoveredBar({ ...d, index: i });
    const clampedZ = Math.min(Math.abs(d.z), maxAbs);
    const barH = clampedZ / maxAbs * (drawH / 2);
    setTooltipPos({
      x: barRect.left - svgRect.left + barWidth / 2,
      y: d.z >= 0 ? midY - barH - 16 : midY + barH + 16,
    });
  };

  const s = {
    label: { fontSize: 9, letterSpacing: 2, color: "#555", textTransform: "uppercase", marginBottom: 4 },
    input: {
      background: "#0f0f18", border: "1px solid #1e1e2a", borderRadius: 5,
      color: "#d4d0c8", padding: "6px 10px", fontSize: 13, fontFamily: "inherit", outline: "none",
    },
    btn: (active) => ({
      background: active ? "#1a1a2e" : "transparent",
      border: active ? "1px solid #444" : "1px solid #1a1a24",
      borderRadius: 4, color: active ? "#d4d0c8" : "#555",
      padding: "6px 12px", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
      fontWeight: active ? 700 : 400, transition: "all 0.15s",
    }),
    presetBtn: {
      background: "transparent", border: "1px solid #1a1a24", borderRadius: 4,
      color: "#666", padding: "6px 8px", fontSize: 10, cursor: "pointer", fontFamily: "inherit",
    },
  };

  return (
    <div style={{ minHeight: "100vh", background: "#08080c", color: "#d4d0c8", fontFamily: "'JetBrains Mono', monospace" }}>
      <div style={{
        position: "fixed", inset: 0, opacity: 0.025,
        backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)",
        backgroundSize: "48px 48px", pointerEvents: "none",
      }} />

      <div style={{ position: "relative", zIndex: 1, maxWidth: 1100, margin: "0 auto", padding: "28px 20px" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 16 }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: 5, color: "#444", textTransform: "uppercase", marginBottom: 4 }}>
              Statistical Deviation Monitor
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
              <h1 style={{
                fontSize: 32, fontWeight: 800, margin: 0,
                background: "linear-gradient(135deg, #d4d0c8 0%, #777 100%)",
                WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
              }}>σ Tracker</h1>
              {priceData && (
                <span style={{ fontSize: 13, color: "#666" }}>
                  {priceData.name || priceData.ticker} · {priceData.exchange}
                </span>
              )}
            </div>
          </div>

          {priceData && !loading && (
            <div style={{ display: "flex", gap: 28 }}>
              <div style={{ textAlign: "right" }}>
                <div style={s.label}>μ Return ({PERIODS.find(p=>p.key===period)?.full})</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: mean >= 0 ? "#00c853" : "#ff1744" }}>
                  {mean >= 0 ? "+" : ""}{(mean * 100).toFixed(3)}%
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={s.label}>{sigmaMode === "rolling" ? "Avg σ" : "σ"}</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{(std * 100).toFixed(3)}%</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={s.label}>≥{threshold}σ Signals</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#ff9100" }}>
                  {beyondThreshold}<span style={{ fontSize: 11, color: "#555" }}> ({pctBeyond}%)</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Controls Row 1 */}
        <div style={{ display: "flex", gap: 16, marginBottom: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ position: "relative" }}>
            <div style={s.label}>Ticker</div>
            <input ref={inputRef} type="text" value={inputVal}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => { if (searchResults.length) setShowSearch(true); }}
              onBlur={() => setTimeout(() => setShowSearch(false), 200)}
              style={{ ...s.input, width: 120, fontWeight: 700 }}
            />
            {showSearch && searchResults.length > 0 && (
              <div style={{
                position: "absolute", top: "100%", left: 0, width: 300, zIndex: 20,
                background: "#0f0f18", border: "1px solid #1e1e2a", borderRadius: 5,
                marginTop: 2, maxHeight: 260, overflowY: "auto",
              }}>
                {searchResults.map((r, i) => (
                  <div key={i} onMouseDown={() => selectTicker(r.symbol)}
                    style={{ padding: "7px 10px", cursor: "pointer", display: "flex", justifyContent: "space-between", borderBottom: "1px solid #111" }}
                    onMouseEnter={(e) => e.currentTarget.style.background = "#16162a"}
                    onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                  >
                    <span style={{ fontSize: 12, fontWeight: 600, color: "#d4d0c8" }}>{r.symbol}</span>
                    <span style={{ fontSize: 10, color: "#666", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.name} · {r.type}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <div style={s.label}>Timeframe</div>
            <div style={{ display: "flex", gap: 2 }}>
              {PERIODS.map((p) => (
                <button key={p.key} onClick={() => setPeriod(p.key)} style={s.btn(period === p.key)}>{p.label}</button>
              ))}
            </div>
          </div>

          <div>
            <div style={s.label}>Threshold: {threshold.toFixed(1)}σ</div>
            <input type="range" min="1" max="5" step="0.1" value={threshold}
              onChange={(e) => setThreshold(parseFloat(e.target.value))}
              style={{ width: 100, accentColor: "#ff9100" }}
            />
          </div>

          <div>
            <div style={s.label}>σ Calculation</div>
            <div style={{ display: "flex", gap: 2 }}>
              {SIGMA_MODES.map((m) => (
                <button key={m.key} onClick={() => setSigmaMode(m.key)} style={s.btn(sigmaMode === m.key)} title={m.desc}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {sigmaMode === "rolling" && (
            <div>
              <div style={s.label}>Window (periods)</div>
              <div style={{ display: "flex", gap: 2 }}>
                {ROLLING_WINDOWS.map((w) => (
                  <button key={w.key} onClick={() => setRollingWindow(w.key)} style={s.btn(rollingWindow === w.key)}>{w.label}</button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Controls Row 2 */}
        <div style={{ display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <div>
              <div style={s.label}>From</div>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                style={{ ...s.input, fontSize: 11, padding: "5px 8px", colorScheme: "dark" }}
              />
            </div>
            <div>
              <div style={s.label}>To</div>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
                style={{ ...s.input, fontSize: 11, padding: "5px 8px", colorScheme: "dark" }}
              />
            </div>
          </div>
          <div>
            <div style={s.label}>Range</div>
            <div style={{ display: "flex", gap: 2 }}>
              {[{ l: "3M", m: 3 }, { l: "6M", m: 6 }, { l: "1Y", m: 12 }, { l: "2Y", m: 24 }, { l: "All", m: 999 }].map((p) => (
                <button key={p.l} onClick={() => setPreset(p.m)} style={s.presetBtn}>{p.l}</button>
              ))}
            </div>
          </div>
          <div style={{ fontSize: 10, color: "#555", maxWidth: 340, lineHeight: 1.4, paddingBottom: 2 }}>
            {sigmaMode === "rolling"
              ? `Each bar measured against the prior ${rollingWindow} periods. Sudden moves after calm periods register as larger deviations.`
              : "Each bar measured against the mean & std dev of the entire selected range."
            }
          </div>
        </div>

        {/* Loading / Error */}
        {loading && (
          <div style={{ padding: 60, textAlign: "center", color: "#555", fontSize: 14, background: "#0b0b14", borderRadius: 10, border: "1px solid #151522" }}>
            <div style={{ animation: "pulse 1.5s infinite", fontSize: 24, marginBottom: 8 }}>σ</div>
            Loading {inputVal}...
            <style>{`@keyframes pulse { 0%,100% { opacity:0.3 } 50% { opacity:1 } }`}</style>
          </div>
        )}

        {error && (
          <div style={{ padding: 40, textAlign: "center", color: "#ff5252", fontSize: 13, background: "#0b0b14", borderRadius: 10, border: "1px solid #2a1515" }}>
            {error}
          </div>
        )}

        {/* Chart */}
        {!loading && !error && filteredData.length > 0 && (
          <>
            <div style={{ background: "#0b0b14", border: "1px solid #151522", borderRadius: 10, position: "relative", overflow: "hidden" }}>
              <div style={{
                position: "absolute", right: 20, top: 20, fontSize: 56, fontWeight: 800,
                color: "#0e0e1a", zIndex: 0, userSelect: "none", letterSpacing: -2, WebkitTextStroke: "1px #13131f",
              }}>{ticker}</div>

              <div style={{ overflowX: "auto", overflowY: "hidden" }}>
                <svg width={chartWidth} height={CHART_HEIGHT} style={{ display: "block" }}>
                  {/* Threshold zone fills */}
                  <rect x={PAD_L} y={midY - (threshold / maxAbs) * (drawH / 2)}
                    width={chartWidth - PAD_L - PAD_R} height={(threshold / maxAbs) * (drawH / 2)} fill="#00c85305"
                  />
                  <rect x={PAD_L} y={midY}
                    width={chartWidth - PAD_L - PAD_R} height={(threshold / maxAbs) * (drawH / 2)} fill="#ff174405"
                  />

                  {/* Gridlines + Y labels: ±5σ */}
                  {Array.from({ length: MAX_SIGMA_SCALE * 2 + 1 }, (_, i) => {
                    const val = MAX_SIGMA_SCALE - i;
                    const y = midY - (val / maxAbs) * (drawH / 2);
                    return (
                      <g key={`g${val}`}>
                        <line x1={PAD_L} y1={y} x2={chartWidth - PAD_R} y2={y}
                          stroke={val === 0 ? "#2a2a3a" : "#111120"} strokeWidth={val === 0 ? 1.5 : 1}
                        />
                        <text x={PAD_L - 6} y={y + 3.5} textAnchor="end"
                          fill={Math.abs(val) >= threshold ? "#ff9100aa" : "#3a3a4a"}
                          fontSize={10} fontFamily="inherit" fontWeight={Math.abs(val) >= threshold ? 600 : 400}
                        >{val > 0 ? `+${val}σ` : val === 0 ? "0" : `${val}σ`}</text>
                      </g>
                    );
                  })}

                  {/* Threshold dashed lines */}
                  {[threshold, -threshold].map((t) => (
                    <line key={t} x1={PAD_L} y1={midY - (t / maxAbs) * (drawH / 2)}
                      x2={chartWidth - PAD_R} y2={midY - (t / maxAbs) * (drawH / 2)}
                      stroke="#ff910044" strokeWidth={1} strokeDasharray="4 4"
                    />
                  ))}

                  <line x1={PAD_L} y1={midY} x2={chartWidth - PAD_R} y2={midY} stroke="#3a3a4a" strokeWidth={1.5} />

                  {/* Bars */}
                  {filteredData.map((d, i) => {
                    const x = PAD_L + i * (barWidth + gap);
                    const clampedZ = Math.min(Math.abs(d.z), maxAbs);
                    const barH = clampedZ / maxAbs * (drawH / 2);
                    const isSignal = Math.abs(d.z) >= threshold;
                    const isPos = d.z >= 0;
                    const isHov = hoveredBar?.index === i;
                    const isClipped = Math.abs(d.z) > maxAbs;
                    const green = isSignal ? "#00c853" : "#00c85355";
                    const red = isSignal ? "#ff1744" : "#ff174455";
                    const color = isPos ? green : red;

                    return (
                      <g key={i}
                        onMouseEnter={(e) => handleBarHover(d, i, e)}
                        onMouseLeave={() => setHoveredBar(null)}
                        style={{ cursor: "crosshair" }}
                      >
                        {isSignal && (
                          <rect x={x - 1} y={isPos ? midY - barH - 1 : midY - 1}
                            width={barWidth + 2} height={barH + 2}
                            fill="none" stroke={isPos ? "#00c853" : "#ff1744"}
                            strokeWidth={isHov ? 2 : 0.8} opacity={isHov ? 0.7 : 0.25} rx={1}
                          />
                        )}
                        {isClipped && barWidth >= 4 && (
                          <text x={x + barWidth / 2} y={isPos ? PAD_T + 8 : CHART_HEIGHT - PAD_B - 4}
                            textAnchor="middle" fill={isPos ? "#00c853" : "#ff1744"} fontSize={8}
                          >{isPos ? "▲" : "▼"}</text>
                        )}
                        <rect x={x} y={isPos ? midY - barH : midY}
                          width={barWidth} height={Math.max(0.5, barH)}
                          fill={color} rx={barWidth > 6 ? 1.5 : 0.5}
                          opacity={isHov ? 1 : isSignal ? 0.9 : 0.5}
                        />
                        {/* Date labels — BRIGHTER */}
                        {i % labelInterval === 0 && (
                          <g>
                            <line x1={x + barWidth / 2} y1={midY + drawH / 2 + 4}
                              x2={x + barWidth / 2} y2={midY + drawH / 2 + 10} stroke="#444" strokeWidth={1}
                            />
                            <text x={x + barWidth / 2} y={midY + drawH / 2 + 23}
                              textAnchor="middle" fill="#999" fontSize={barWidth > 10 ? 10 : 9} fontFamily="inherit"
                            >{formatDate(d.date, period)}</text>
                            {period !== "monthly" && (
                              <text x={x + barWidth / 2} y={midY + drawH / 2 + 36}
                                textAnchor="middle" fill="#666" fontSize={8} fontFamily="inherit"
                              >{new Date(d.date + "T00:00:00").getFullYear()}</text>
                            )}
                          </g>
                        )}
                      </g>
                    );
                  })}

                  {/* Tooltip */}
                  {hoveredBar && (() => {
                    const tipW = 175;
                    const tipH = hoveredBar.localStd != null ? 56 : 48;
                    const tipX = Math.max(PAD_L, Math.min(tooltipPos.x - tipW / 2, chartWidth - tipW - 4));
                    const tipY = hoveredBar.z >= 0
                      ? Math.max(4, tooltipPos.y - tipH - 8)
                      : Math.min(CHART_HEIGHT - tipH - 4, tooltipPos.y + 8);
                    return (
                      <g style={{ pointerEvents: "none" }}>
                        <rect x={tipX} y={tipY} width={tipW} height={tipH} rx={5}
                          fill="#111122ee" stroke="#3a3a4a" strokeWidth={1}
                        />
                        <text x={tipX + tipW / 2} y={tipY + 18}
                          textAnchor="middle" fill="#d4d0c8" fontSize={12} fontFamily="inherit" fontWeight={700}
                        >
                          {hoveredBar.z >= 0 ? "+" : ""}{hoveredBar.z.toFixed(2)}σ  ({hoveredBar.ret >= 0 ? "+" : ""}{(hoveredBar.ret * 100).toFixed(2)}%)
                        </text>
                        <text x={tipX + tipW / 2} y={tipY + 34}
                          textAnchor="middle" fill="#999" fontSize={10} fontFamily="inherit"
                        >
                          {new Date(hoveredBar.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </text>
                        {hoveredBar.localStd != null && (
                          <text x={tipX + tipW / 2} y={tipY + 48}
                            textAnchor="middle" fill="#666" fontSize={9} fontFamily="inherit"
                          >
                            local σ: {(hoveredBar.localStd * 100).toFixed(2)}%
                          </text>
                        )}
                      </g>
                    );
                  })()}
                </svg>
              </div>

              {clippedBars > 0 && (
                <div style={{ padding: "4px 16px 8px", fontSize: 9, color: "#666" }}>
                  ▲▼ {clippedBars} bar{clippedBars > 1 ? "s" : ""} exceed{clippedBars === 1 ? "s" : ""} ±{MAX_SIGMA_SCALE}σ scale — hover to see actual values
                </div>
              )}
            </div>

            {/* Legend */}
            <div style={{ display: "flex", gap: 20, justifyContent: "center", marginTop: 12, fontSize: 10, color: "#666" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <div style={{ width: 10, height: 10, background: "#00c853", borderRadius: 2 }} /> Positive ≥ {threshold}σ
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <div style={{ width: 10, height: 10, background: "#ff1744", borderRadius: 2 }} /> Negative ≥ {threshold}σ
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <div style={{ width: 10, height: 10, background: "#00c85355", borderRadius: 2 }} /> Within normal
              </div>
              {sigmaMode === "rolling" && (
                <div style={{ color: "#555" }}>◯ Rolling {rollingWindow}-period window</div>
              )}
            </div>

            {/* Signal list — sorted by magnitude */}
            {beyondThreshold > 0 && (
              <div style={{
                marginTop: 20, background: "#0b0b14", border: "1px solid #151522",
                borderRadius: 10, padding: 16, maxHeight: 260, overflowY: "auto",
              }}>
                <div style={{ fontSize: 9, letterSpacing: 2, color: "#555", textTransform: "uppercase", marginBottom: 10 }}>
                  Deviation Signals — {beyondThreshold} events ({pctBeyond}%) — sorted by magnitude
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 6 }}>
                  {filteredData
                    .filter((d) => Math.abs(d.z) >= threshold)
                    .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
                    .map((d, i) => {
                      const isPos = d.z >= 0;
                      return (
                        <div key={i} style={{
                          display: "flex", alignItems: "center", gap: 10,
                          padding: "6px 10px", background: "#0f0f1a", borderRadius: 5,
                          borderLeft: `3px solid ${isPos ? "#00c853" : "#ff1744"}`,
                        }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: isPos ? "#00c853" : "#ff1744", minWidth: 52 }}>
                            {d.z >= 0 ? "+" : ""}{d.z.toFixed(2)}σ
                          </div>
                          <div>
                            <div style={{ fontSize: 11, color: "#999" }}>
                              {new Date(d.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                            </div>
                            <div style={{ fontSize: 10, color: "#666" }}>
                              {d.ret >= 0 ? "+" : ""}{(d.ret * 100).toFixed(2)}% return
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
          </>
        )}

        {!loading && !error && filteredData.length === 0 && priceData && (
          <div style={{ padding: 60, textAlign: "center", color: "#555", fontSize: 13, background: "#0b0b14", borderRadius: 10, border: "1px solid #151522" }}>
            No data in selected date range. Try adjusting dates or timeframe.
          </div>
        )}

        <div style={{ marginTop: 16, fontSize: 9, color: "#2a2a34", textAlign: "center", letterSpacing: 1 }}>
          Data via Yahoo Finance · Hover bars for details · {filteredData.length} periods shown
        </div>
      </div>
    </div>
  );
}
