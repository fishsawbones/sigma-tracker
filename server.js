import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());

// Proxy endpoint for Yahoo Finance historical data
app.get('/api/history/:ticker', async (req, res) => {
  const { ticker } = req.params;
  const { period1, period2, interval } = req.query;

  // Default: 3 years of daily data
  const now = Math.floor(Date.now() / 1000);
  const threeYearsAgo = now - 3 * 365 * 24 * 60 * 60;

  const p1 = period1 || threeYearsAgo;
  const p2 = period2 || now;
  const int = interval || '1d';

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${p1}&period2=${p2}&interval=${int}&includePrePost=false`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `Yahoo Finance returned ${response.status}` });
    }

    const data = await response.json();
    const result = data?.chart?.result?.[0];

    if (!result) {
      return res.status(404).json({ error: 'Ticker not found or no data available' });
    }

    const timestamps = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];
    const meta = result.meta || {};

    // Build clean array of { date, close } filtering out nulls
    const prices = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (closes[i] != null) {
        prices.push({
          date: new Date(timestamps[i] * 1000).toISOString().split('T')[0],
          close: closes[i]
        });
      }
    }

    res.json({
      ticker: meta.symbol || ticker,
      currency: meta.currency || 'USD',
      exchange: meta.exchangeName || '',
      name: meta.shortName || meta.longName || ticker,
      prices
    });
  } catch (err) {
    console.error('Yahoo Finance fetch error:', err.message);
    res.status(500).json({ error: 'Failed to fetch data from Yahoo Finance' });
  }
});

// Search / autocomplete endpoint
app.get('/api/search/:query', async (req, res) => {
  const { query } = req.params;
  const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    const data = await response.json();
    const quotes = (data.quotes || []).map(q => ({
      symbol: q.symbol,
      name: q.shortname || q.longname || q.symbol,
      type: q.quoteType,
      exchange: q.exchDisp || q.exchange
    }));
    res.json(quotes);
  } catch (err) {
    res.status(500).json({ error: 'Search failed' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`σ Tracker API server running on http://localhost:${PORT}`);
});
