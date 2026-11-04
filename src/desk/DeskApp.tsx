import { useLayoutEffect, useRef, useState } from 'react'
import App from '../App'
import { AnalysisPage } from './AnalysisPage'
import { WatchPage } from './WatchPage'
import './desk.css'

type Tab = 'watch' | 'analysis' | 'dojo'

export type DeskSlots = { left: HTMLElement; right: HTMLElement }

export function DeskApp() {
  const [tab, setTab] = useState<Tab>('watch')
  const [analysisReady, setAnalysisReady] = useState(false)
  const [dojoReady, setDojoReady] = useState(false)
  const leftRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)
  const [slots, setSlots] = useState<DeskSlots | null>(null)

  useLayoutEffect(() => {
    if (leftRef.current && rightRef.current) {
      setSlots({ left: leftRef.current, right: rightRef.current })
    }
  }, [])

  const open = (next: Tab) => {
    if (next === 'analysis') setAnalysisReady(true)
    if (next === 'dojo') setDojoReady(true)
    setTab(next)
  }

  return (
    <div className="desk">
      <header className="desk-bar">
        <div className="desk-bar-left" ref={leftRef} />
        <div className="desk-switch" role="tablist" aria-label="頁面">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'watch'}
            className={tab === 'watch' ? 'on' : ''}
            onClick={() => open('watch')}
          >
            看盤
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'analysis'}
            className={tab === 'analysis' ? 'on' : ''}
            onClick={() => open('analysis')}
          >
            分析
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'dojo'}
            className={tab === 'dojo' ? 'on' : ''}
            onClick={() => open('dojo')}
          >
            走圖道場
          </button>
        </div>
        <div className="desk-bar-right" ref={rightRef} />
      </header>
      {tab === 'watch' ? <WatchPage slots={slots} /> : null}
      {analysisReady ? (
        <div className={tab === 'analysis' ? 'desk-pane' : 'desk-pane hidden'}>
          <AnalysisPage slots={tab === 'analysis' ? slots : null} />
        </div>
      ) : null}
      {dojoReady ? (
        <div className={tab === 'dojo' ? 'dojo-host' : 'dojo-host hidden'}>
          <App slots={tab === 'dojo' ? slots : null} />
        </div>
      ) : null}
    </div>
  )
}
