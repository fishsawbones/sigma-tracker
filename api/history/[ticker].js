export default async function handler(req, res) {
  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: 'Missing ticker' });
  const now = Math.floor(Date.now() / 1000);
  const threeYearsAgo = now - 3 * 365 * 24 * 60 * 60;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${threeYearsAgo}&period2=${now}&interval=1d&includePrePost=false`;
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!response.ok) return res.status(response.status).json({ error: `Yahoo returned ${response.status}` });
    const data = await response.json();
    const result = data?.chart?.result?.[0];
    if (!result) return res.status(404).json({ error: 'Ticker not found' });
    const timestamps = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];
    const meta = result.meta || {};
    const prices = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (closes[i] != null) prices.push({ date: new Date(timestamps[i] * 1000).toISOString().split('T')[0], close: closes[i] });
    }
    res.setHeader('Cache-Control', 's-maxage=300');
    res.json({ ticker: meta.symbol || ticker, currency: meta.currency || 'USD', exchange: meta.exchangeName || '', name: meta.shortName || meta.longName || ticker, prices });
  } catch (err) { res.status(500).json({ error: 'Failed to fetch data' }); }
}
