import { test } from 'node:test'
import assert from 'node:assert/strict'
import { yahooForceSeries as series } from '../server/yahooForce.ts'

test('Yahoo running totals and minute differences, independent of Taishin', () => {
 for (const [samples, want, out, inn] of [
  [{ '09:09': [2317,3291], '09:10': [2458,3422] }, -964, 141, 131],
  [{ '09:09': [1453,881], '09:10': [1485,934] }, 551, 32, 53],
 ] as const) {
  const r = series(samples, new Map([[549,9999],[550,-10000]]), 550)
  const p = r.flow.at(-1)!
  assert.equal(p.cum,want); assert.equal(p.out,out); assert.equal(p.inn,inn)
  assert.equal(p.net,out-inn); assert.equal(p.src,'yahoo')
 }
})

test('gaps and the latest minute use the last Yahoo poll, never candle estimates', () => {
 const r=series({'09:00':[100,90],'09:02':[130,100]},new Map([[541,9999],[543,-9999]]),543)
 assert.deepEqual(r.flow.map(p=>p.cum),[10,10,30,30])
 assert.deepEqual(r.flow.map(p=>p.net),[10,0,20,0])
 assert.equal(series({'09:00':[101,90]},new Map(),540).cum,11)
})

test('pre-recorder Taishin shape joins the first Yahoo sample continuously', () => {
 const r=series({'09:02':[500,300]},new Map([[540,10],[541,-5],[542,7]]),543)
 assert.deepEqual(r.flow.map(p=>p.cum),[198,193,200,200])
 assert.equal(r.flow[0].src,'est');assert.equal(r.flow[2].src,'yahoo')
 assert.equal(r.flow[2].out,null);assert.equal(r.flow[2].inn,null)
})

test('13:25 trial matches and the closing auction cannot change force', () => {
 const r=series({'13:24':[900,700],'13:25':[1000,700],'13:30':[1500,700]},new Map(),810)
 assert.equal(r.flow.find(p=>p.t==='13:24:00')?.cum,200)
 assert.equal(r.flow.at(-1)?.cum,200);assert.equal(r.flow.at(-1)?.net,0)
 assert.equal(r.yahooAt,'13:24:00')
})

test('no Yahoo is explicitly provisional; no source produces no fabricated series', () => {
 const r=series({},new Map([[540,7],[541,-2]]),542)
 assert.deepEqual(r.flow.map(p=>p.cum),[7,5,5]);assert(r.flow.every(p=>p.src==='est'))
 assert.equal(series({},new Map(),542).flow.length,0)
})
