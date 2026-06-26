export default async function handler(req, res) {
  // Tillåt anrop från din domän (byt ut mot din riktiga domän)
  res.setHeader('Access-Control-Allow-Origin', 'https://dindomän.se');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Hanterar preflight-anrop från webbläsaren
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { messages } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Ogiltig förfrågan' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY, // Ligger säkert i Vercel
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        system: `Du är en hjälpsam parkeringsexpert för Stockholm. Du svarar kortfattat
och praktiskt på svenska.

Du känner till:
- Stockholms fem taxeområden (taxa 1 är dyrast ~60 kr/h centralt; taxa 5 billigast/gratis i utkanten)
- P+R-platser: Bredäng, Vårby, Haninge, Täby, Sollentuna m.fl. — parkera gratis och ta tunnelbana/pendeltåg
- Gratis parkering: finns på söndagar i vissa zoner och ytterområden. Kontrollera alltid skyltning
- Parkeringshus: Q-Park, Apcoa, Stockholm Parkering, Indigo
- Betalappar: EasyPark och Parkster (Betala P-appen lades ned september 2024)
- Nära Avicii Arena/Globen: parkera i Johanneshov eller ta tunnelbana röd linje
- Djurgården: mycket begränsat, rekommenderas spårvagn 7
- Gamla stan: nästan ingen gatuparkering, använd närliggande parkeringshus
- Arlanda: långtidsparkering finns men Arlanda Express är ofta billigare

Håll svaren under 4–5 meningar. Var konkret och ge specifika tips.`,
        messages,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('Anthropic API-fel:', error);
      return res.status(500).json({ error: 'API-anrop misslyckades' });
    }

    const data = await response.json();
    const reply = data.content?.[0]?.text;

    if (!reply) {
      return res.status(500).json({ error: 'Inget svar från API' });
    }

    res.status(200).json({ reply });
  } catch (err) {
    console.error('Serverfel:', err);
    res.status(500).json({ error: 'Internt serverfel' });
  }
}
