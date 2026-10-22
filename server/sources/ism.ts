import { fetchJson, fetchText } from './http.js'
import type { IndicatorSeries, SeriesPoint } from './types.js'

type Obs = { date: string; value: number; sourceUrl?: string }
type Bundle = { observations: Obs[]; lastVerifiedAt?: string }

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
}

function mergeObs(...lists: Obs[][]): SeriesPoint[] {
  const map = new Map<string, number>()
  for (const list of lists) {
    for (const o of list) {
      if (typeof o.value === 'number' && !Number.isNaN(o.value)) {
        map.set(o.date.slice(0, 10), o.value)
      }
    }
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, value]) => ({ date, value }))
}

async function loadGithubBundle(name: string): Promise<Obs[]> {
  const url = `https://raw.githubusercontent.com/RealMaxPower/bellwether/main/data/${name}.json`
  const data = await fetchJson<Bundle>(url)
  return data.observations || []
}

async function scrapeLatestFromPrNewswire(): Promise<Obs[]> {
  try {
    const html = await fetchText(
      'https://www.prnewswire.com/search/news/?keyword=ISM%20Manufacturing%20PMI&page=1&pagesize=20',
    )
    const re =
      /Manufacturing PMI[^%]{0,30}?at\s*([0-9]+(?:\.[0-9]+)?)\s*%\s*;\s*([A-Za-z]+)\s+(\d{4})/gi
    const out: Obs[] = []
    const seen = new Set<string>()
    let m: RegExpExecArray | null
    while ((m = re.exec(html))) {
      const value = Number(m[1])
      const month = MONTHS[m[2].toLowerCase()]
      const year = Number(m[3])
      if (!month || !year) continue
      const date = `${year}-${String(month).padStart(2, '0')}-01`
      if (seen.has(date)) continue
      seen.add(date)
      out.push({ date, value })
    }
    return out
  } catch {
    return []
  }
}

export async function fetchIsm(): Promise<IndicatorSeries> {
  const [historical, wayback, curated, live] = await Promise.all([
    loadGithubBundle('pmi-historical'),
    loadGithubBundle('pmi-wayback'),
    loadGithubBundle('pmi-curated'),
    scrapeLatestFromPrNewswire(),
  ])

  const series = mergeObs(historical, wayback, curated, live)
  const latest = series.at(-1) ?? null
  const prev = series.at(-2)
  const change =
    latest && prev ? Number((latest.value - prev.value).toFixed(1)) : null

  return {
    id: 'ism',
    title: '美國 ISM 製造業指數',
    unit: '指數',
    frequency: 'monthly',
    latest,
    change,
    note: '50 為榮枯線；>50 擴張、＜50 緊縮',
    source: 'ISM Report on Business（Bellwether / PR Newswire）',
    series,
    meta: {
      threshold: 50,
    },
  }
}
