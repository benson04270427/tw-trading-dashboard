// 框架化：市場規則、設定正規化、模型回覆解析，以及全新安裝時的設定 API（市場切換、資料源、推理模型、設定檔匯出入）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {marketProfile,tickSize,roundTick,limitPrices,limitNearPct,bucketEnd,elapsedTrading,liveWindow,localParts,clientMarket} from '../lib/markets.mjs';
import {normalizeConfig} from '../lib/config.mjs';
import {parseJSON} from '../lib/llm.mjs';
import {importGroups,removeStock,renameGroup,removeGroup,reorderGroups,EMPTY_SCOPE} from '../lib/scope.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

test('market rules: ticks, limits, sessions and lunch breaks',()=>{
  const tw=marketProfile('TW'),jp=marketProfile('JP'),us=marketProfile('US'),hk=marketProfile('HK');
  assert.equal(tickSize(tw,9.99),.01);assert.equal(tickSize(tw,52),.1);assert.equal(roundTick(tw,52.33,true),52.4);assert.equal(roundTick(tw,52.33,false),52.3);
  assert.deepEqual(limitPrices(tw,100),{up:110,down:90});assert.equal(limitNearPct(tw),9.5);
  assert.deepEqual(limitPrices(jp,500),{up:600,down:400});assert.equal(limitPrices(us,100),null);assert.equal(limitNearPct(us),null);
  assert.equal(elapsedTrading(jp,'13:00'),180);assert.equal(elapsedTrading(jp,'12:00'),150);assert.equal(elapsedTrading(tw,'14:00'),270);
  assert.equal(bucketEnd(jp,12*60+30),12*60+35,'afternoon open auction belongs to the afternoon session');assert.equal(bucketEnd(hk,12*60+3),12*60);
  assert.equal(liveWindow(tw,new Date('2026-10-08T02:00:00Z')),true);assert.equal(liveWindow(tw,new Date('2026-10-10T02:00:00Z')),false,'Saturday');
  assert.equal(liveWindow(us,new Date('2026-10-08T14:00:00Z')),true);assert.equal(localParts(us,new Date('2026-10-08T14:00:00Z')).hm,'10:00');
  assert.ok(us.symbolRe.test('BRK.B')&&!us.symbolRe.test('2330')&&tw.symbolRe.test('2330'));
  assert.equal(JSON.parse(JSON.stringify(clientMarket(tw))).ticks.at(-1)[0],null);
  assert.equal(marketProfile('CN').id,'TW','unsupported market falls back');
});
test('config normalization rejects unknown markets, languages and unsafe values',()=>{
  const c=normalizeConfig({market:'CN',language:'fr',providers:{enabled:['finmind','../x','finmind'],prefer:{snapshot:'fugle','bad key':'x'}},llm:{provider:'other',baseUrl:'javascript:alert(1)',effort:'max'},publicUrl:'ftp://x',upColor:'blue'});
  assert.equal(c.market,'TW');assert.equal(c.language,'zh-TW');assert.deepEqual(c.providers.enabled,['finmind']);assert.deepEqual(c.providers.prefer,{snapshot:'fugle'});
  assert.equal(c.llm.provider,'anthropic');assert.equal(c.llm.baseUrl,'');assert.equal(c.llm.effort,'high');assert.equal(c.publicUrl,'');assert.equal(c.upColor,'');
});
test('model replies: fenced or wrapped JSON is extracted',()=>{
  assert.deepEqual(parseJSON('```json\n{"a":1}\n```'),{a:1});assert.deepEqual(parseJSON('Sure: {"b":[1,2]} done'),{b:[1,2]});assert.throws(()=>parseJSON('no json'));
});
test('research groups: import merges by name, filters symbols; rename, remove and reorder',()=>{
  const us=marketProfile('US');
  let {scope,added,skipped}=importGroups(structuredClone(EMPTY_SCOPE),[{name:'AI',stockIds:['NVDA','AMD','2330']},{name:'ai',stockIds:['NVDA','MSFT']},{name:'Cloud',stockIds:[]}],[{id:'NVDA',name:'NVIDIA'}],us);
  assert.equal(scope.groups.length,2);assert.deepEqual(scope.groups[0].stockIds,['NVDA','AMD','MSFT']);assert.equal(added,3);assert.equal(skipped,1);assert.equal(scope.stockMetadata.find(s=>s.id==='NVDA').name,'NVIDIA');
  const ai=scope.groups[0].id,cloud=scope.groups[1].id;
  assert.throws(()=>renameGroup(scope,cloud,'AI'));scope=renameGroup(scope,cloud,'Cloud 2');assert.equal(scope.groups[1].name,'Cloud 2');
  scope=reorderGroups(scope,[cloud,ai]);assert.equal(scope.groups[0].id,cloud);assert.throws(()=>reorderGroups(scope,[ai]));
  const r=removeStock(scope,ai,'AMD');assert.equal(r.removed,true);assert.ok(!r.scope.stockMetadata.some(s=>s.id==='AMD'));
  scope=removeGroup(r.scope,ai);assert.equal(scope.groups.length,1);assert.equal(scope.stockMetadata.length,0);
});

test('fresh install: setup APIs switch markets without mixing data, keep keys out of responses',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'equilens-framework-'));
  const child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:'4398',EQUITY_DATA_DIR:directory,FINMIND_API_TOKEN:'',ANTHROPIC_API_KEY:'',OPENAI_API_KEY:''},windowsHide:true,stdio:['ignore','pipe','pipe']});
  try{
    await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',c=>reject(new Error(`Server exited ${c}`)));setTimeout(()=>reject(new Error('Server startup timeout')),10000).unref();});
    const base='http://127.0.0.1:4398/api/',get=async p=>(await fetch(base+p)).json();
    const s=await get('state'),headers={'Content-Type':'application/json','X-CSRF-Token':s.csrf},post=(p,b)=>fetch(base+p,{method:'POST',headers,body:JSON.stringify(b)});
    assert.equal(s.config.setupDone,false);assert.equal(s.config.market,'TW');assert.deepEqual(s.groups,[],'no personal default groups');assert.equal(s.dataConfigured,false);
    let c=await get('config');assert.ok(c.providers.some(p=>p.id==='twse'&&p.key==='none'));assert.equal(c.capabilities.daily,null);
    assert.equal((await post('providers',{enabled:['twse','nope']})).status,400);
    c=await(await post('providers',{enabled:['twse'],prefer:{}})).json();assert.equal(c.capabilities.daily,'twse');assert.equal(c.capabilities.snapshot,null);
    assert.equal((await post('provider-key',{id:'twse',key:'whatever-key'})).status,400,'keyless provider');
    assert.equal((await post('provider-key',{id:'finmind',key:'short'})).status,400);
    // 推理模型：OpenAI 相容端點（本機模型）可不設金鑰；模型名稱不可含空白
    assert.equal((await post('llm',{provider:'openai',model:'bad model'})).status,400);
    const l=await(await post('llm',{provider:'compatible',baseUrl:'http://127.0.0.1:9/v1',model:'local-model'})).json();assert.equal(l.llm.configured,true);
    assert.equal((await get('state')).llmConfigured,true);
    // 切換到美股：台股資料收進 markets/TW，美股從空白開始
    await post('groups',{name:'台股族群'});assert.equal((await get('state')).groups.length,1);
    let r=await(await post('config',{market:'US'})).json();assert.equal(r.market.id,'US');assert.equal(r.config.market,'US');
    assert.ok(fs.existsSync(path.join(directory,'markets','TW','groups.json')));
    let st=await get('state');assert.equal(st.marketProfile.id,'US');assert.deepEqual(st.groups,[]);
    const g=await(await post('groups',{name:'Tech'})).json();
    assert.equal((await post('group-stocks',{groupId:g.group.id,stockId:'2330'})).status,400,'TW symbol rejected in US market');
    r=await post('group-stocks',{groupId:g.group.id,stockId:'AAPL',name:'Apple'});assert.equal(r.status,200,'unlisted symbol allowed without a universe provider');
    assert.equal((await fetch(base+'chart?id=2330')).status,400);
    // 匯出設定檔：不含金鑰；匯入其他市場的設定檔時族群不匯入
    const bundle=await get('export');assert.equal(bundle.app,'equilens');assert.deepEqual(bundle.groups,[{name:'Tech',stockIds:['AAPL']}]);assert.ok(!JSON.stringify(bundle).match(/key"\s*:\s*"[^"]+/i));
    const res=await(await post('import',{bundle:{...bundle,market:'JP',groups:[{name:'X',stockIds:['7203']}]},parts:['groups']})).json();assert.equal(res.result.groups.skipped,true);
    // 切回台股：台股族群回來，美股收進 markets/US
    r=await(await post('config',{market:'TW'})).json();assert.equal(r.config.market,'TW');
    st=await get('state');assert.deepEqual(st.groups.map(x=>x.name),['台股族群']);assert.ok(fs.existsSync(path.join(directory,'markets','US','groups.json')));
    await post('config',{market:'US'});st=await get('state');assert.deepEqual(st.groups.map(x=>x.name),['Tech']);assert.deepEqual(st.groups[0].stockIds,['AAPL']);
    assert.equal((await post('config',{market:'CN'})).status,400);assert.equal((await post('config',{language:'fr'})).status,400);
    assert.equal((await post('config',{publicUrl:'http://insecure.example'})).status,400);
    assert.equal((await fetch('http://127.0.0.1:4398/locales/../server.mjs')).status,404);
    const cfg=JSON.parse(fs.readFileSync(path.join(directory,'config.json'),'utf8'));assert.equal(cfg.market,'US');assert.equal(cfg.llm.provider,'compatible');
  }finally{child.kill();await new Promise(r=>child.once('close',r));fs.rmSync(directory,{recursive:true,force:true});}
});
