export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://stockholmsparkering.se');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Ogiltig förfrågan' });
  }

  const lastUserMessage = [...messages]
    .reverse()
    .find(m => m.role === 'user')?.content?.toLowerCase() || '';

  // ----------------------------------------------------------------
  // Stockholm Parkering API — realtidsdata
  // ----------------------------------------------------------------
  const GARAGE_KEYWORDS = [
    'parkeringshus', 'garage', 'p-hus', 'stockholmparkering',
    'ledig', 'lediga', 'platser', 'inomhus', 'hitta parkering',
    'ytparkering', 'laddplats', 'handikapp', 'rörelsehindrad'
  ];

  let garageContext = '';
  if (GARAGE_KEYWORDS.some(kw => lastUserMessage.includes(kw))) {
    try {
      const apiRes = await fetch(
        'https://api.stockholmparkering.se:8084/SparkInfartsParkeringService.svc/GetAllAnlaggningParkeringsInfo',
        { signal: AbortSignal.timeout(5000) }
      );
      const anlaggningar = await apiRes.json();

      const sammanfattning = anlaggningar
        .slice(0, 50)
        .map(a => {
          const namn = a.Namn || a.Adress || 'Okänd';
          const adress = a.Adress || '';
          const typ = a.Anlaggningstyp || '';
          const platser = a.AntalBesokPlatser ?? '?';
          const laddplatser = a.AntalLaddplatserBesokBil ?? 0;
          const rörelsehindrad = a.AntalBesokPlatserRorelsehindrad ?? 0;

          // Plocka ut taxebeskrivning om den finns
          const taxa = a.BesokstaxaCollection?.[0]?.Anm || '';

          let rad = `${namn} (${adress}) — ${typ}: ${platser} platser`;
          if (laddplatser > 0) rad += `, ${laddplatser} laddplatser`;
          if (rörelsehindrad > 0) rad += `, ${rörelsehindrad} rörelsehindrade`;
          if (taxa) rad += `. Taxa: ${taxa}`;
          return rad;
        })
        .join('\n');

      garageContext = `--- Stockholm Parkering — realtidsdata (${new Date().toLocaleTimeString('sv-SE')}) ---
${sammanfattning}`;
    } catch (err) {
      console.error('Stockholm Parkering API-fel:', err.message);
      garageContext = '';
    }
  }

  // ----------------------------------------------------------------
  // Övriga webbkällor med selektiv RAG
  // ----------------------------------------------------------------
  const SOURCES = [
    {
      name: 'Stockholms stad — taxeområden och avgifter',
      url: 'https://parkering.stockholm/betala-parkering/taxeomraden-avgifter/',
      keywords: ['taxa', 'taxe', 'avgift', 'pris', 'kostar', 'kosta', 'betala', 'zon', 'gatuparkering', 'hur mycket', 'timme', 'kr/h'],
      maxChars: 6000,
    },
    {
      name: 'SL — P+R-platser',
      url: 'https://sl.se/reseplanering/p-och-res',
      keywords: ['p+r', 'p och r', 'park and ride', 'pendel', 'tunnelbana', 'pendeltåg', 'bredäng', 'vårby', 'haninge', 'täby', 'sollentuna'],
      maxChars: 2000,
    },
    {
      name: 'Stockholms stad — boendeparkering',
      url: 'https://parkering.stockholm/boendeparkering/',
      keywords: ['boende', 'boendepark', 'tillstånd', 'ansök', 'ansökan', 'bosatt', 'bo ', 'bor '],
      maxChars: 2000,
    },
    {
      name: 'EasyPark — betala parkering',
      url: 'https://easypark.se/sv/',
      keywords: ['easypark', 'app', 'mobilapp', 'parkster', 'betala med'],
      maxChars: 2000,
    },
    {
      name: 'Polisen — bestrida parkeringsanmärkning',
      url: 'https://polisen.se/lagar-och-regler/boter/parkeringsanmarkning/',
      keywords: ['bestrida', 'överklaga', 'anmärkning', 'p-bot', 'parkeringsbot', 'felpark', 'felparkering', 'polis'],
      maxChars: 2000,
    },
    {
      name: 'Transportstyrelsen — felparkeringsavgift',
      url: 'https://www.transportstyrelsen.se/sv/vagtrafik/fordon/skatter-och-avgifter/parkeringsanmarkning/',
      keywords: ['transportstyrelsen', 'betala bot', 'obetald', 'kronofogden', 'indrivning', 'felparkeringsavgift'],
      maxChars: 2000,
    },
    {
      name: 'Konsumentverket — parkeringsböter guide',
      url: 'https://www.konsumentverket.se/varar-och-tjanster/parkeringsboter/',
      keywords: ['kontrollavgift', 'privat mark', 'tomtmark', 'parkeringsbolag', 'p-bot', 'parkeringsbot', 'bestrida', 'överklaga'],
      maxChars: 2000,
    },
    {
      name: 'Riksdagen — lag om felparkeringsavgift (SFS 1976:206)',
      url: 'https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/lag-1976206-om-felparkeringsavgift_sfs-1976-206/',
      keywords: ['lag', 'lagtext', 'sfs', '1976', 'felparkeringsavgift', 'juridisk', 'lagstiftning', 'paragraf'],
      maxChars: 3000,
    },
    {
      name: 'Riksdagen — lag om kontrollavgift vid olovlig parkering (SFS 1984:318)',
      url: 'https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/lag-1984318-om-kontrollavgift-vid-olovlig_sfs-1984-318/',
      keywords: ['kontrollavgift', 'lag', 'lagtext', 'sfs', '1984', 'tomtmark', 'privat mark', 'juridisk', 'lagstiftning', 'paragraf'],
      maxChars: 3000,
    },
  ];

  const relevantSources = SOURCES.filter(source =>
    source.keywords.some(kw => lastUserMessage.includes(kw))
  );

  if (relevantSources.length === 0 && !garageContext) {
    relevantSources.push(SOURCES[0]);
  }

  async function fetchSource(source) {
    try {
      const response = await fetch(source.url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(4000),
      });
      const html = await response.text();
      const text = html
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, source.maxChars);
      return { name: source.name, url: source.url, text };
    } catch (err) {
      console.error(`Kunde inte hämta ${source.name}:`, err.message);
      return { name: source.name, url: source.url, text: 'Kunde inte hämtas just nu.' };
    }
  }

  const fetchedSources = await Promise.all(
    relevantSources.slice(0, 4).map(fetchSource)
  );

  const sourceContext = [
    garageContext,
    ...fetchedSources.map(s => `--- ${s.name}\n${s.url}\n${s.text}`)
  ].filter(Boolean).join('\n\n');

  // ----------------------------------------------------------------
  // Skicka till Claude
  // ----------------------------------------------------------------
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        system: `Du är en hjälpsam parkeringsexpert för Stockholm. Du svarar kortfattat
och praktiskt på svenska.

Nedan följer aktuell information hämtad direkt från relevanta källor.
Prioritera denna information framför din egen kunskap om priser och regler.
När du har realtidsdata från Stockholm Parkerings API, lyft gärna fram antal
platser och taxainformation från den.

${sourceContext}

--- ALLMÄN KUNSKAP ---
- Det finns två typer av parkeringsavgifter:
  1. Felparkeringsavgift: på gatumark (kommunal). Betala ALLTID först, bestrida sedan hos Polisen.
  2. Kontrollavgift: på tomtmark (privat parkeringsbolag). Betala INTE innan du bestridit hos bolaget.
- Betalappar: EasyPark och Parkster (Betala P-appen lades ned september 2024)
- Nära Avicii Arena/Globen: parkera i Johanneshov eller ta tunnelbana röd linje
- Djurgården: mycket begränsat, rekommenderas spårvagn 7
- Gamla stan: nästan ingen gatuparkering, använd närliggande parkeringshus
- Arlanda: långtidsparkering finns men Arlanda Express är ofta billigare

Viktigt: Du är inte juridisk rådgivare. Vid tvister om avgifter, hänvisa alltid
till Polisen, Transportstyrelsen eller Konsumentverket för officiell vägledning.

Formatera ALDRIG med markdown. Inga stjärnor, inga punktlistor, inga rubriker.
Skriv enkel löptext med blanka rader mellan stycken om du delar upp svaret.
Håll svaren under 4-5 meningar. Var konkret och ge specifika tips.`,
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

    if (!reply) return res.status(500).json({ error: 'Inget svar från API' });

    res.status(200).json({ reply });
  } catch (err) {
    console.error('Serverfel:', err);
    res.status(500).json({ error: 'Internt serverfel' });
  }
}
