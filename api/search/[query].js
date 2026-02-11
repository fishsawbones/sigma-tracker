export default async function handler(req, res) {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: 'Missing query' });
  const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0`;
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const data = await response.json();
    const quotes = (data.quotes || []).map(q => ({ symbol: q.symbol, name: q.shortname || q.longname || q.symbol, type: q.quoteType, exchange: q.exchDisp || q.exchange }));
    res.setHeader('Cache-Control', 's-maxage=3600');
    res.json(quotes);
  } catch (err) { res.status(500).json({ error: 'Search failed' }); }
}
