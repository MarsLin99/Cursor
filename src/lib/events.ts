import type { HedgeChoice, MarketEvent } from '../types'

export const MARKET_EVENTS: MarketEvent[] = [
  {
    id: 'fed_hawk',
    title: '聯準會放鷹',
    narrative:
      '外資傳聞聯準會官員偏鷹發言，台股期貨夜盤重挫。你的持股帳面開始回吐，此刻要不要用選擇權止血？',
    severity: 'sharp',
    bias: 'down',
    choices: [
      {
        id: 'buy_put',
        label: '買進賣權（Protective Put）',
        hint: '付保費，下跌有保護，上漲最多虧權利金',
      },
      {
        id: 'collar',
        label: '做領口（買Put＋賣Call）',
        hint: '降保費，但上漲空間被封頂',
      },
      {
        id: 'do_nothing',
        label: '不避險，續抱現貨',
        hint: '零成本，但下跌全額曝險',
      },
      {
        id: 'add_long',
        label: '逢低加碼現貨',
        hint: '若判斷過度反應可加碼，錯了虧更多',
      },
    ],
  },
  {
    id: 'geo_risk',
    title: '地緣風險升溫',
    narrative:
      '盤中突傳地緣衝突消息，波動率瞬間抽升。選擇權權利金變貴，但現貨也可能急殺。',
    severity: 'crash',
    bias: 'down',
    choices: [
      {
        id: 'buy_put',
        label: '立即買Put避險',
        hint: '貴一點但可鎖住下行風險',
      },
      {
        id: 'collar',
        label: '快速領口避險',
        hint: '用賣Call補貼Put成本',
      },
      {
        id: 'sell_call',
        label: '只賣出買權賺權利金',
        hint: '若小跌可收租，但大跌保護不足',
      },
      {
        id: 'do_nothing',
        label: '觀望不動作',
        hint: '等消息明朗，可能已反應完畢',
      },
    ],
  },
  {
    id: 'earnings_miss',
    title: '財報不如預期',
    narrative:
      '公司指引下修的傳聞流出，股價已經開始鬆動。你手上有現貨部位，要怎麼處理選擇權？',
    severity: 'sharp',
    bias: 'down',
    choices: [
      {
        id: 'buy_put',
        label: '買Put鎖住跌幅',
        hint: '適合還想留著投票權／長線部位的人',
      },
      {
        id: 'collar',
        label: '領口保護',
        hint: '接受上檔受限換取較低成本',
      },
      {
        id: 'do_nothing',
        label: '相信長線，不避險',
        hint: '若只是短空可能熬過去，但短線痛',
      },
      {
        id: 'add_long',
        label: '逆向加碼',
        hint: '高風險高報酬，適合極有把握時',
      },
    ],
  },
  {
    id: 'ai_rally',
    title: 'AI 題材爆發',
    narrative:
      '供應鏈傳出超預期訂單，權值股夜盤大漲。你若先前做了空頭避險，現在可能被「保險」拖累。',
    severity: 'rally',
    bias: 'up',
    choices: [
      {
        id: 'buy_put',
        label: '仍買Put防回撤',
        hint: '追高後的保險，保費通常不便宜',
      },
      {
        id: 'collar',
        label: '領口鎖利',
        hint: '上漲已多時可鎖利並防回檔',
      },
      {
        id: 'sell_call',
        label: '賣Call賺權利金',
        hint: '偏盤整收租；若續漲會少賺',
      },
      {
        id: 'do_nothing',
        label: '不避險，讓獲利奔跑',
        hint: '趨勢行情常見選擇',
      },
    ],
  },
  {
    id: 'vol_spike',
    title: '波動率急升',
    narrative:
      '選擇權隱含波動率跳升，權利金全面變貴。這時避險成本高，但不避險又怕缺口。',
    severity: 'volatile',
    bias: 'volatile',
    choices: [
      {
        id: 'collar',
        label: '用領口降低淨保費',
        hint: '高IV時賣Call較有吸引力',
      },
      {
        id: 'buy_put',
        label: '咬牙買Put',
        hint: '成本高，但保護最直接',
      },
      {
        id: 'sell_call',
        label: '只賣Call收高權利金',
        hint: '賺IV，但下行幾乎裸露',
      },
      {
        id: 'do_nothing',
        label: '等IV回落再處理',
        hint: '可能買在最貴，也可能躲過假訊號',
      },
    ],
  },
  {
    id: 'foreign_sell',
    title: '外資連續賣超',
    narrative:
      '外資連五日賣超，技術面跌破月線。市場開始討論是否進入修正波。',
    severity: 'mild',
    bias: 'down',
    choices: [
      {
        id: 'buy_put',
        label: '買Put防守',
        hint: '修正初期常見動作',
      },
      {
        id: 'collar',
        label: '輕度領口',
        hint: '保留部分上漲空間',
      },
      {
        id: 'do_nothing',
        label: '當作洗盤',
        hint: '若之後V轉，避險保費會變沉沒成本',
      },
      {
        id: 'add_long',
        label: '提前佈局反彈',
        hint: '需要明確支撐與風險控管',
      },
    ],
  },
]

export function pickEventsForReplay(
  candleCount: number,
  warmUp = 40,
  count = 3,
): { triggerIndex: number; event: MarketEvent }[] {
  const usable = Math.max(0, candleCount - warmUp - 8)
  if (usable < 20) return []

  const slots: number[] = []
  const segment = Math.floor(usable / count)
  for (let i = 0; i < count; i++) {
    const start = warmUp + i * segment
    const end = i === count - 1 ? candleCount - 6 : start + segment - 1
    const mid = Math.floor((start + end) / 2)
    const jitter = Math.floor((Math.sin(i * 12.9898) * 10000) % 5)
    slots.push(Math.min(candleCount - 6, Math.max(warmUp, mid + jitter)))
  }

  return slots.map((triggerIndex, i) => ({
    triggerIndex,
    event: MARKET_EVENTS[i % MARKET_EVENTS.length],
  }))
}

export function scoreHedgeChoice(
  choice: HedgeChoice,
  movePct: number,
  eventBias: MarketEvent['bias'],
): { pnlPct: number; comment: string; grade: 'S' | 'A' | 'B' | 'C' } {
  // Approximate hedge P&L on a notional stock position (percentage of spot)
  const putCost = 0.015
  const callCredit = 0.012
  const collarNetCost = 0.004
  const putProtection = Math.max(0, -movePct) // protects downside
  const callCap = Math.max(0, movePct - 0.03) // upside given up beyond ~3%

  let pnlPct = movePct // baseline = naked stock
  let comment = ''

  switch (choice) {
    case 'buy_put': {
      pnlPct = movePct - putCost + putProtection * 0.85
      // if up, just lose premium
      if (movePct >= 0) pnlPct = movePct - putCost
      else pnlPct = movePct * 0.2 - putCost // most downside offset
      comment =
        movePct < -0.02
          ? '賣權發揮保險效果，大幅減少現貨回撤。'
          : '行情未大跌，權利金成為主要成本。'
      break
    }
    case 'collar': {
      if (movePct >= 0) pnlPct = Math.min(movePct, 0.03) - collarNetCost
      else pnlPct = movePct * 0.25 - collarNetCost
      comment =
        movePct > 0.04
          ? '大漲時領口會賣掉上檔；保護有餘、爆發不足。'
          : movePct < -0.02
            ? '下跌時領口有效降風險，淨保費也較低。'
            : '盤整時領口成本低，表現穩健。'
      break
    }
    case 'sell_call': {
      pnlPct = movePct + callCredit - callCap
      comment =
        movePct < -0.03
          ? '只賣Call在大跌時幾乎沒保護，現貨虧損仍在。'
          : movePct > 0.05
            ? '大漲時Call被指派，少賺一段行情。'
            : '震盪市收權利金有感。'
      break
    }
    case 'add_long': {
      pnlPct = movePct * 1.5
      comment =
        movePct > 0
          ? '判斷正確，加碼放大獲利。'
          : '加碼遇下跌，虧損放大，風險控管不足。'
      break
    }
    case 'do_nothing':
    default: {
      pnlPct = movePct
      comment =
        Math.abs(movePct) < 0.015
          ? '行情波動有限，不避險反而最省成本。'
          : movePct < 0
            ? '下跌波段裸抱現貨，回撤完全反映在帳戶。'
            : '上漲波段未避險，報酬保留完整。'
      break
    }
  }

  // Grade vs event bias
  let grade: 'S' | 'A' | 'B' | 'C' = 'B'
  const goodDefensive =
    (eventBias === 'down' || eventBias === 'volatile') &&
    (choice === 'buy_put' || choice === 'collar')
  const goodOffensive =
    eventBias === 'up' && (choice === 'do_nothing' || choice === 'sell_call')
  const bad =
    (eventBias === 'down' && choice === 'add_long') ||
    (eventBias === 'up' && choice === 'buy_put' && movePct > 0.04)

  if (goodDefensive && pnlPct > movePct + 0.01) grade = 'S'
  else if (goodOffensive) grade = 'A'
  else if (bad) grade = 'C'
  else if (pnlPct >= movePct) grade = 'A'
  else grade = 'B'

  return { pnlPct, comment, grade }
}
