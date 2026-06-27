export default async function handler(req, res) {
  const start = Date.now();
  try {
    const apiRes = await fetch(
      'https://api.stockholmparkering.se:8084/SparkInfartsParkeringService.svc/GetAllAnlaggningParkeringsInfo',
      { signal: AbortSignal.timeout(10000) } // 10 sekunder
    );
    const data = await apiRes.json();
    const elapsed = Date.now() - start;

    res.status(200).json({
      ok: true,
      elapsed_ms: elapsed,
      antal: data.length,
      forsta: data[0], // Hela första objektet så vi ser alla fält
    });
  } catch (err) {
    const elapsed = Date.now() - start;
    res.status(500).json({
      ok: false,
      elapsed_ms: elapsed,
      error: err.message,
      type: err.name,
    });
  }
}
