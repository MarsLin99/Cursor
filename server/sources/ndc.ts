import JSZip from 'jszip'
import type { IndicatorSeries, SeriesPoint } from './types.js'

const NDC_ZIP_URL =
  'https://ws.ndc.gov.tw/Download.ashx?u=LzAwMS9hZG1pbmlzdHJhdG9yLzEwL3JlbGZpbGUvNTc4MS82MzkyL2VhMjM1YmQ5LWQwNTItNGE2OS1hYmZjLWQ1Yzc4NWQzZDBlMi56aXA%3d&n=5pmv5rCj5oyH5qiZ5Y%2bK54eI6JmfLnppcA%3d%3d&icon=.zip'

const SIGNAL_NAME: Record<string, string> = {
  藍: '藍燈（低迷）',
  黃藍: '黃藍燈（轉向）',
  綠: '綠燈（穩定）',
  黃紅: '黃紅燈（轉向）',
  紅: '紅燈（熱絡）',
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') {
        inQuotes = false
      } else {
        cell += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else if (ch !== '\r') {
      cell += ch
    }
  }
  if (cell.length || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

function yyyymmToDate(yyyymm: string): string {
  return `${yyyymm.slice(0, 4)}-${yyyymm.slice(4, 6)}-01`
}

let ndcZipPromise: Promise<JSZip> | null = null

async function loadNdcZip(): Promise<JSZip> {
  if (!ndcZipPromise) {
    ndcZipPromise = (async () => {
      const bin = await (await fetch(NDC_ZIP_URL)).arrayBuffer()
      return JSZip.loadAsync(bin)
    })().catch((err) => {
      ndcZipPromise = null
      throw err
    })
  }
  return ndcZipPromise
}

async function loadNdcCsv(fileName: string): Promise<string[][]> {
  const zip = await loadNdcZip()
  const file = zip.file(fileName)
  if (!file) {
    const names = Object.keys(zip.files).join(', ')
    throw new Error(`ZIP 中找不到 ${fileName}（現有：${names}）`)
  }
  const text = (await file.async('string')).replace(/^\uFEFF/, '')
  return parseCsv(text)
}

export async function fetchBusinessSignal(): Promise<IndicatorSeries> {
  const rows = await loadNdcCsv('景氣指標與燈號.csv')
  const header = rows[0]
  const scoreIdx = header.indexOf('景氣對策信號綜合分數')
  const signalIdx = header.indexOf('景氣對策信號')
  const dateIdx = header.indexOf('Date')

  const series: SeriesPoint[] = []
  for (const r of rows.slice(1)) {
    const rawDate = r[dateIdx]
    const score = r[scoreIdx]
    const signal = r[signalIdx]
    if (!rawDate || !score || score === '-') continue
    series.push({
      date: yyyymmToDate(rawDate),
      value: Number(score),
      label: signal,
    })
  }

  const latest = series.at(-1) ?? null
  const prev = series.at(-2)
  const change =
    latest && prev ? Number((latest.value - prev.value).toFixed(1)) : null

  return {
    id: 'business-signal',
    title: '景氣燈號',
    unit: '綜合分數',
    frequency: 'monthly',
    latest: latest
      ? {
          ...latest,
          label: SIGNAL_NAME[latest.label || ''] || latest.label,
        }
      : null,
    change,
    note: '藍≤22、黃藍23–31、綠32–37、黃紅38–44、紅≥45',
    source: '國發會景氣指標及燈號（data.gov.tw / NDC）',
    series,
    meta: {
      signal: latest?.label || null,
      signalName: latest
        ? SIGNAL_NAME[latest.label || ''] || latest.label || null
        : null,
    },
  }
}

export async function fetchExportYoy(): Promise<IndicatorSeries> {
  const rows = await loadNdcCsv('景氣對策信號構成項目.csv')
  const header = rows[0]
  const dateIdx = header.indexOf('Date')
  const exportIdx = header.indexOf('海關出口值(十億元)')

  const levels: SeriesPoint[] = []
  for (const r of rows.slice(1)) {
    const rawDate = r[dateIdx]
    const val = r[exportIdx]
    if (!rawDate || !val || val === '-') continue
    levels.push({ date: yyyymmToDate(rawDate), value: Number(val) })
  }

  const byDate = new Map(levels.map((p) => [p.date, p.value]))
  const series: SeriesPoint[] = []
  for (const p of levels) {
    const [y, m] = p.date.split('-')
    const prev = `${Number(y) - 1}-${m}-01`
    const base = byDate.get(prev)
    if (base == null || base === 0) continue
    series.push({
      date: p.date,
      value: Number((((p.value / base) - 1) * 100).toFixed(2)),
    })
  }

  const latest = series.at(-1) ?? null
  const prev = series.at(-2)
  const change =
    latest && prev ? Number((latest.value - prev.value).toFixed(2)) : null

  return {
    id: 'export-yoy',
    title: '台灣出口年增率',
    unit: '%',
    frequency: 'monthly',
    latest,
    change,
    note: '以國發會公布之海關出口值計算同比年增率',
    source: '國發會景氣對策信號構成項目（海關出口值）',
    series,
    meta: {
      exportLevelBillionNtd: levels.at(-1)?.value ?? null,
    },
  }
}
