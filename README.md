# σ Tracker — Stock Deviation Monitor

A personal tool for visualizing when stocks, ETFs, crypto, or commodities make statistically unusual moves (beyond N standard deviations from their mean return).

Inspired by the kind of regime-shift / volatility visualization tools used in macro analysis.

## Features

- **Any ticker**: Stocks (AAPL, TSLA), ETFs (SPY, QQQ), crypto (BTC-USD), commodities (GC=F for gold, CL=F for crude oil)
- **Green/red deviation bars**: Green bars up for positive moves, red bars down for negative — centered on a zero line
- **Adjustable threshold**: Slide between 1σ and 4σ to change what counts as a "signal"
- **Timeframe toggle**: Daily, Weekly, or Monthly returns
- **Date range**: Pick any date window or use quick presets (3M, 6M, 1Y, All)
- **Date axis**: Full date labels along the x-axis
- **Hover tooltips**: See exact date, z-score, and % return for any bar
- **Signal list**: All deviation events listed with dates and magnitudes

## Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/YOUR_USERNAME/sigma-tracker.git
cd sigma-tracker

# 2. Install dependencies
npm install

# 3. Start the dev server
npm run dev
```

Open http://localhost:5173 in your browser.

## Deploy to Vercel (free)

1. Push this repo to GitHub
2. Go to https://vercel.com and sign in with GitHub
3. Click "Import Project" → select this repo
4. Click "Deploy" — done!

You'll get a URL like `sigma-tracker.vercel.app` that works on any device.

## Ticker Examples

| What | Ticker |
|------|--------|
| Apple | AAPL |
| S&P 500 ETF | SPY |
| Nasdaq ETF | QQQ |
| Bitcoin | BTC-USD |
| Gold futures | GC=F |
| Crude oil | CL=F |
| Silver | SI=F |
| 10Y Treasury ETF | TLT |
| Russell 2000 | IWM |

## How It Works

1. Fetches historical price data from Yahoo Finance
2. Computes period returns (daily, weekly, or monthly)
3. Calculates mean and standard deviation of those returns
4. Converts each return to a z-score (how many σ from the mean)
5. Plots bars centered on zero — bright green/red for moves beyond your threshold

## Tech Stack

- React + Vite
- Yahoo Finance API (via a lightweight server proxy to handle CORS)
- No API key required
