// ----------------------------------------------------------------
// Byt ut mot ditt GitHub-användarnamn
// ----------------------------------------------------------------
const GITHUB_USER = 'jimmyv93';
const BASE_URL = `https://raw.githubusercontent.com/${GITHUB_USER}/garage-cache/main/data`;

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

  const GARAGE_KEYWORDS = [
  'parkeringshus', 'garage', 'p-hus', 'stockholmparkering',
  'ledig', 'lediga', 'platser', 'inomhus', 'ytparkering',
  'laddplats', 'hitta parkering', 'just nu', 'realtid',
  'johanneshov', 'globen', 'arenastan', 'södermalm',
  'östermalm', 'vasastan', 'kungsholmen', 'lidingö',
  'parkera nu', 'var kan jag parkera', 'finns det plats'
];

  const TILLATEN_KEYWORDS = [
    'tillåtet', 'tillåten', 'får man parkera', 'kan man parkera',
    'är det okej', 'parkera här', 'parkera på', 'var får man'
  ];

  const SERVICEDAG_KEYWORDS = [
    'servicedag', 'städdag', 'parkeringsförbud', 'förbjudet att parkera',
    'natt', 'natten', 'måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag',
    'när är det förbjudet', 'flytta bilen'
  ];

  const RORELSEHINDRAD_KEYWORDS = [
    'rörelsehindrad', 'handikapplats', 'handikapp', 'tillstånd',
    'rullstol', 'parkeringstillstånd', 'funktionsnedsättning'
  ];

  async function fetchJSON(url) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
      return await r.json();
    } catch {
      return null;
    }
  }

  const fetches = {};
  if (GARAGE_KEYWORDS.some(kw => lastUserMessage.includes(kw))) {
    fetches.garage = fetchJSON(`${BASE_URL}/garagedata.json`);
  }
  if (TILLATEN_KEYWORDS.some(kw => lastUserMessage.includes(kw))) {
    fetches.ptillaten = fetchJSON(`${BASE_URL}/ptillaten.json`);
  }
  if (SERVICEDAG_KEYWORDS.some(kw => lastUserMessage.includes(kw))) {
    fetches.servicedagar = fetchJSON(`${BASE_URL}/servicedagar.json`);
  }
  if (RORELSEHINDRAD_KEYWORDS.some(kw => lastUserMessage.includes(kw))) {
    fetches.prorelsehindrad = fetchJSON(`${BASE_URL}/prorelsehindrad.json`);
  }

  if (Object.keys(fetches).length === 0) {
    fetches.ptillaten = fetchJSON(`${BASE_URL}/ptillaten.json`);
  }

  const results = Object.fromEntries(
    await Promise.all(
      Object.entries(fetches).map(async ([k, p]) => [k, await p])
    )
  );

  const contextParts = [];

  if (results.garage?.length > 0) {
    const text = results.garage.slice(0, 50).map(a => {
      const namn = a.Namn || a.Adress || 'Okänd';
      const adress = a.Adress || '';
      const typ = a.Anlaggningstyp || '';
      const platser = a.AntalBesokPlatser ?? '?';
      const laddplatser = a.AntalLaddplatserBesokBil ?? 0;
      const rörelsehindrad = a.AntalBesokPlatserRorelsehindrad ?? 0;
      const taxa = a.BesokstaxaCollection?.[0]?.Anm || '';
      let rad = `${namn} (${adress}) — ${typ}: ${platser} platser`;
      if (laddplatser > 0) rad += `, ${laddplatser} laddplatser`;
      if (rörelsehindrad > 0) rad += `, ${rörelsehindrad} rörelsehindrade`;
      if (taxa) rad += `. Taxa: ${taxa}`;
      return rad;
    }).join('\n');
    contextParts.push(`--- Stockholm Parkering — anläggningar ---\n${text}`);
  }

  for (const [key, label] of [
    ['ptillaten', 'Trafikkontoret — tillåten parkering'],
    ['servicedagar', 'Trafikkontoret — servicedagar (parkeringsförbud)'],
    ['prorelsehindrad', 'Trafikkontoret — platser för rörelsehindrade'],
  ]) {
    if (results[key]) {
      const features = results[key].features || results[key] || [];
      const sample = features.slice(0, 40).map(f => {
        const p = f.properties || f;
        const gata = p.GATUNAMN || p.gatunamn || '';
        const foreskrift = p.FORESKRIFT || p.foreskrift || '';
        const tider = p.TILLATEN_TIDER || p.FORBJUDEN_TIDER || p.tider || '';
        let rad = gata;
        if (foreskrift) rad += `: ${foreskrift}`;
        if (tider) rad += ` (${tider})`;
        return rad;
      }).filter(Boolean).join('\n');
      if (sample) contextParts.push(`--- ${label} ---\n${sample}`);
    }
  }

  const sourceContext = contextParts.join('\n\n');

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
      keywords: ['boende', 'boendepark', 'tillstånd', 'ansök', 'ansökan', 'bosatt'],
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
      return { name: source.name, url: source.url, text: 'Kunde inte hämtas just nu.' };
    }
  }

  const fetchedSources = await Promise.all(
    relevantSources.slice(0, 3).map(fetchSource)
  );

  const fullContext = [
    sourceContext,
    ...fetchedSources.map(s => `--- ${s.name}\n${s.url}\n${s.text}`)
  ].filter(Boolean).join('\n\n');

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
        system: `Du är en hjälpsam parkeringsexpert för Stockholm. Du svarar kortfattat och praktiskt på svenska.

Nedan följer aktuell information hämtad från officiella källor. Prioritera denna framför din egen kunskap om priser och regler.

Stockholm Parkerings data innehåller anläggningar med kapacitet och taxor.
ALDRIG säg att du saknar realtidsdata eller lediga platser — det är inte vad
användaren frågar efter. Presentera direkt vilka anläggningar som finns i området
med antal platser och pris, och avsluta med att hänvisa till EasyPark eller
stockholmparkering.se för aktuell tillgänglighet.

${fullContext}

--- ALLMÄN KUNSKAP ---
- Det finns två typer av parkeringsavgifter:
  1. Felparkeringsavgift: på gatumark (kommunal). Betala ALLTID först, bestrida sedan hos Polisen.
  2. Kontrollavgift: på tomtmark (privat). Betala INTE innan du bestridit hos bolaget.
- Betalappar: EasyPark och Parkster (Betala P-appen lades ned september 2024)
- Nära Avicii Arena/Globen: parkera i Johanneshov eller ta tunnelbana röd linje
- Djurgården: mycket begränsat, rekommenderas spårvagn 7
- Gamla stan: nästan ingen gatuparkering, använd närliggande parkeringshus
- Arlanda: Arlanda Express är ofta billigare än långtidsparkering

Viktigt: Du är inte juridisk rådgivare. Vid tvister, hänvisa till Polisen, Transportstyrelsen eller Konsumentverket.

Formatera ALDRIG med markdown. Inga stjärnor, inga punktlistor, inga rubriker. Skriv enkel löptext med blanka rader mellan stycken om du delar upp svaret. Håll svaren under 4-5 meningar. Var konkret och ge specifika tips.`,
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
