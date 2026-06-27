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

  // ----------------------------------------------------------------
  // Källor och nyckelord som triggar dem
  // ----------------------------------------------------------------
  const SOURCES = [
    {
      name: 'Stockholms stad — taxeområden och avgifter',
      url: 'https://parkering.stockholm/betala-parkering/taxeomraden-avgifter/',
      keywords: ['taxa', 'taxe', 'avgift', 'pris', 'kostar', 'kosta', 'betala', 'zon', 'gatuparkering', 'hur mycket'],
    },
    {
      name: 'Stockholm Parkering — parkeringshus',
      url: 'https://www.stockholmparkering.se/hitta-parkering/',
      keywords: ['stockholmparkering', 'parkeringshus', 'garage', 'inomhus', 'p-hus'],
    },
    {
      name: 'Q-Park Stockholm',
      url: 'https://www.qpark.se/hitta-parkering/stockholm/',
      keywords: ['qpark', 'q-park', 'garage', 'parkeringshus'],
    },
    {
      name: 'Apcoa Stockholm',
      url: 'https://www.apcoa.se/parkering-i/stockholm/',
      keywords: ['apcoa', 'garage', 'parkeringshus'],
    },
    {
      name: 'SL — P+R-platser',
      url: 'https://sl.se/reseplanering/p-och-res',
      keywords: ['p+r', 'p och r', 'park and ride', 'pendel', 'tunnelbana', 'pendeltåg', 'bredäng', 'vårby', 'haninge', 'täby', 'sollentuna'],
    },
    {
      name: 'Stockholms stad — boendeparkering',
      url: 'https://parkering.stockholm/boendeparkering/',
      keywords: ['boende', 'boendepark', 'tillstånd', 'ansök', 'ansökan', 'bosatt', 'bo ', 'bor '],
    },
    {
      name: 'EasyPark — betala parkering',
      url: 'https://easypark.se/sv/',
      keywords: ['easypark', 'app', 'mobilapp', 'parkster', 'betala med'],
    },
    {
      name: 'Polisen — bestrida parkeringsanmärkning',
      url: 'https://polisen.se/lagar-och-regler/boter/parkeringsanmarkning/',
      keywords: ['bestrida', 'överklaga', 'anmärkning', 'p-bot', 'parkeringsbot', 'felpark', 'felparkering', 'betalningsansvar', 'rättelse', 'polis'],
    },
    {
      name: 'Transportstyrelsen — felparkeringsavgift',
      url: 'https://www.transportstyrelsen.se/sv/vagtrafik/fordon/skatter-och-avgifter/parkeringsanmarkning/',
      keywords: ['transportstyrelsen', 'betala bot', 'obetald', 'kronofogden', 'indrivning', 'erinran', 'åläggande', 'felparkeringsavgift'],
    },
    {
      name: 'Konsumentverket — parkeringsböter guide',
      url: 'https://www.konsumentverket.se/varar-och-tjanster/parkeringsboter/',
      keywords: ['kontrollavgift', 'privat mark', 'tomtmark', 'parkeringsbolag', 'p-bot', 'parkeringsbot', 'bestrida', 'överklaga'],
    },
    {
      name: 'Riksdagen — lag om felparkeringsavgift (SFS 1976:206)',
      url: 'https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/lag-1976206-om-felparkeringsavgift_sfs-1976-206/',
      keywords: ['lag', 'lagtext', 'sfs', '1976', 'felparkeringsavgift', 'juridisk', 'lagstiftning', 'paragraf'],
    },
    {
      name: 'Riksdagen — lag om kontrollavgift vid olovlig parkering (SFS 1984:318)',
      url: 'https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/lag-1984318-om-kontrollavgift-vid-olovlig_sfs-1984-318/',
      keywords: ['kontrollavgift', 'lag', 'lagtext', 'sfs', '1984', 'tomtmark', 'privat mark', 'juridisk', 'lagstiftning', 'paragraf'],
    },
  ];

  // ----------------------------------------------------------------
  // Avgör relevanta källor baserat på senaste frågan
  // ----------------------------------------------------------------
  const lastUserMessage = [...messages]
    .reverse()
    .find(m => m.role === 'user')?.content?.toLowerCase() || '';

  const relevantSources = SOURCES.filter(source =>
    source.keywords.some(kw => lastUserMessage.includes(kw))
  );

  // Alltid inkludera taxekällan som bas om inga specifika träffar
  if (relevantSources.length === 0) {
    relevantSources.push(SOURCES[0]);
  }

  // Max 4 källor per anrop för att hålla nere kostnad och latens
  const sourcesToFetch = relevantSources.slice(0, 4);

  // ----------------------------------------------------------------
  // Hämta och rensa HTML från valda källor parallellt
  // ----------------------------------------------------------------
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
        .slice(0, 2000);
      return { name: source.name, url: source.url, text };
    } catch (err) {
      console.error(`Kunde inte hämta ${source.name}:`, err.message);
      return { name: source.name, url: source.url, text: 'Kunde inte hämtas just nu.' };
    }
  }

  const fetchedSources = await Promise.all(sourcesToFetch.map(fetchSource));

  const sourceContext = fetchedSources
    .map(s => `--- ${s.name}\n${s.url}\n${s.text}`)
    .join('\n\n');

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

Nedan följer aktuell information hämtad direkt från relevanta webbplatser.
Prioritera denna information framför din egen kunskap om priser och regler.
Hänvisa gärna till källan när det är relevant.

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

    if (!reply) return res.status(500).json({ error: 'Inget svar från API' });

    res.status(200).json({ reply });
  } catch (err) {
    console.error('Serverfel:', err);
    res.status(500).json({ error: 'Internt serverfel' });
  }
}
