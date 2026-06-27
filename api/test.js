export default async function handler(req, res) {
  try {
    const r = await fetch(
      'https://api.stockholmparkering.se:8084/SparkInfartsParkeringService.svc/GetAllAnlaggningParkeringsInfo'
    );
    const text = await r.text();
    res.status(200).send(text.slice(0, 500));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
