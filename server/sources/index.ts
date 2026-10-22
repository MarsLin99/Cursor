import { fetchBdi } from './bdi.js'
import { fetchIsm } from './ism.js'
import { fetchBusinessSignal, fetchExportYoy } from './ndc.js'
import { fetchSahm } from './sahm.js'
import { fetchTwseSummary } from './twse.js'
import type { IndicatorSeries, IndicatorsPayload } from './types.js'

async function settle<T>(
  label: string,
  p: Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await p }
  } catch (err) {
    console.error(`[${label}]`, err)
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function fetchAllIndicators(): Promise<IndicatorsPayload> {
  const [ism, sahm, signal, exp, bdi, stock] = await Promise.all([
    settle('ism', fetchIsm()),
    settle('sahm', fetchSahm()),
    settle('signal', fetchBusinessSignal()),
    settle('export', fetchExportYoy()),
    settle('bdi', fetchBdi()),
    settle('stock', fetchTwseSummary()),
  ])

  const fixed: IndicatorSeries[] = []
  const wanted = [
    { key: ism, id: 'ism', title: '美國 ISM 製造業指數' },
    { key: sahm, id: 'sahm', title: '薩姆規則衰退指標' },
    { key: signal, id: 'business-signal', title: '景氣燈號' },
    { key: exp, id: 'export-yoy', title: '台灣出口年增率' },
    { key: bdi, id: 'bdi', title: '波羅的海乾散貨指數（BDI）' },
  ] as const

  for (const w of wanted) {
    if (w.key.ok) fixed.push(w.key.value)
    else {
      fixed.push({
        id: w.id,
        title: w.title,
        unit: '',
        frequency: w.id === 'bdi' ? 'daily' : 'monthly',
        latest: null,
        source: '取得失敗',
        series: [],
        note: w.key.error,
      })
    }
  }

  return {
    updatedAt: new Date().toISOString(),
    indicators: fixed,
    stock: stock.ok ? stock.value : null,
  }
}
