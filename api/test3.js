export default async function handler(req, res) {
  const url = 'https://raw.githubusercontent.com/jimmyv93/garage-cache/main/data/garagedata.json';
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
    const data = await r.json();
    res.status(200).json({
      antal: data?.length,
      forsta: data?.[0],
      johanneshov: data?.filter(a => 
        JSON.stringify(a).toLowerCase().includes('johanneshov')
      )
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
