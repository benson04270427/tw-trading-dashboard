import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {fetchStock,blockingJobErrors} from '../lib/research.mjs';import {screenPatterns,detectPatterns} from '../lib/patterns.mjs';
// 模擬資料源：日成交（含還原）、法人、營收、估值四項
const mockSources=fn=>[{keys:['price','adjusted'],label:'daily',fetch:async()=>{const r=await fn();return {price:r,adjusted:r};}},...['institutions','revenue','valuation'].map(k=>({keys:[k],label:k,fetch:fn}))];
const fixture=JSON.parse(fs.readFileSync(new URL('./pattern-fixtures.json',import.meta.url),'utf8'))[0];
test('empty provider response retains old rows without marking success; same-day retry recovers',async()=>{let calls=0;const previous={price:[{date:'2026-09-17',close:10}]};const failed=await fetchStock('2330',previous,{cutoff:'2026-09-18',sources:mockSources(async()=>{calls++;return [];})});assert.equal(calls,4);assert.deepEqual(failed.price,previous.price);assert.equal(failed.checked.price,undefined);calls=0;const recovered=await fetchStock('2330',failed,{cutoff:'2026-09-18',sources:mockSources(async()=>{calls++;return [{date:'2026-09-18',close:11}];})});assert.equal(calls,4);assert.equal(recovered.checked.price,'2026-09-18');assert.equal(recovered.errors.price,undefined);calls=0;const again=await fetchStock('2330',recovered,{cutoff:'2026-09-18',sources:mockSources(async()=>{calls++;return [];})});assert.equal(calls,0);assert.deepEqual(again.price,recovered.price);});
test('fatal provider error keeps partial progress for resume',async()=>{const e=Object.assign(new Error('quota'),{fatal:true});await assert.rejects(fetchStock('2330',{},{cutoff:'2026-09-18',sources:[{keys:['price'],label:'daily',fetch:async()=>[{date:'2026-09-18',close:1}]},{keys:['revenue'],label:'revenue',fetch:async()=>{throw e;}}]}),err=>err.partial.checked.price==='2026-09-18'&&err.partial.errors.revenue==='quota');});
test('saved old calendar cannot hide a newer market session',()=>{const calendar=fixture.price.map(x=>x.date),date='2026-09-21';const raw={[fixture.stock.id]:{price:[...fixture.price,{...fixture.price.at(-1),date}],adjusted:fixture.adjusted}};const result=screenPatterns([fixture.stock],raw,date,calendar);assert.equal(result.asOf,date);assert.equal(result.eligible,0);});
test('first-day volume breakout does not satisfy next-day confirmation',()=>{const fixtures=JSON.parse(fs.readFileSync(new URL('./pattern-fixtures.json',import.meta.url),'utf8'));let checked=0;for(const f of fixtures){const p=structuredClone(f.adjusted),raw=structuredClone(f.price);for(const m of detectPatterns(p,raw)){if(m.breakoutDate===p.at(-1).date){assert.notEqual(m.status,'量價確認');checked++;}}}assert(checked>0,'regression set must include a latest-day breakout');});

test('emerging (興櫃) stocks in the research list keep a daily close from the TPEx emerging quote table instead of failing every update', async () => {
  const { esbRaw } = await import('../lib/research.mjs');
  const { summarize } = await import('../lib/engine.mjs');
  const q = { name: '凌嘉科', close: 412, prev: 400 };
  let raw = esbRaw({}, q, '2026-11-06');
  assert.deepEqual(raw.errors, {});
  assert.equal(raw.price.length, 1);
  raw = esbRaw(raw, { ...q, close: 420 }, '2026-11-09');
  raw = esbRaw(raw, { ...q, close: 425 }, '2026-11-09');
  assert.deepEqual(raw.price.map(r => [r.date, r.close]), [['2026-11-06', 412], ['2026-11-09', 425]]);
  assert.equal(raw.esb.name, '凌嘉科');
  const s = summarize({ id: '3644', name: '凌嘉科', sector: '興櫃' }, raw, [], '2026-11-09', 1000);
  assert.equal(s.price, 425);
  assert.equal(s.asOf, '2026-11-09');
  assert.equal(s.stale, false);
  assert.equal(s.change, 3.16);
});
test('a stock without revenue (foreign issuer) does not block the daily update; all empty or other errors still do',()=>{const none='本次未回傳資料；既有資料保留原日期',e=(id,dataset='revenue',message=none)=>({id,dataset,message});assert.deepEqual(blockingJobErrors([e('NBIS')],6),[]);assert.equal(blockingJobErrors([e('A'),e('B')],2).length,2);assert.equal(blockingJobErrors([e('NBIS'),e('INTC','price','timeout')],6).length,1);assert.equal(blockingJobErrors([e('INTC','revenue','HTTP 500')],6).length,1);});
