import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('local API persists watchlist/evidence, validates settings, blocks cross-origin writes and leaks',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'equilens-test-'));
  fs.writeFileSync(path.join(directory,'universe.json'),JSON.stringify([{id:'2330',name:'台積電',sector:'半導體業',market:'上市'}]));
  fs.writeFileSync(path.join(directory,'groups.json'),JSON.stringify({version:1,groups:[{id:'test',name:'測試族群',stockIds:['2330']}],stockMetadata:[]}));
  const catalog=JSON.parse(fs.readFileSync(path.join(directory,'universe.json'),'utf8'));catalog.push({id:'2454',name:'聯發科',sector:'半導體業',market:'上市'});fs.writeFileSync(path.join(directory,'universe.json'),JSON.stringify(catalog));
  const fixture=JSON.parse(fs.readFileSync(path.join(root,'tests/pattern-fixtures.json'),'utf8'))[0];const fixtureToday=new Date().toISOString().slice(0,10),shift=Date.parse(fixtureToday)-Date.parse(fixture.price.at(-1).date);for(const key of ['price','adjusted'])fixture[key]=fixture[key].map(r=>({...r,date:new Date(Date.parse(r.date)+shift).toISOString().slice(0,10)}));catalog.push(fixture.stock);fs.writeFileSync(path.join(directory,'universe.json'),JSON.stringify(catalog));fs.mkdirSync(path.join(directory,'stocks'),{recursive:true});fs.writeFileSync(path.join(directory,'stocks',fixture.stock.id+'.json'),JSON.stringify(fixture));
  const child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:'4399',EQUITY_DATA_DIR:directory,FINMIND_API_TOKEN:''},windowsHide:true,stdio:['ignore','pipe','pipe']});
  try{
    await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',c=>reject(new Error(`Server exited ${c}`)));setTimeout(()=>reject(new Error('Server startup timeout')),10000).unref();});
    const base='http://127.0.0.1:4399/api/';
    const s=await (await fetch(base+'state')).json();assert.equal(s.tokenConfigured,false);assert(s.csrf);assert.equal(s.stocks[0].price,null);
    let r=await fetch(base+'watchlist',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"ids":[]}'});assert.equal(r.status,403);
    const headers={'Content-Type':'application/json','X-CSRF-Token':s.csrf};
    assert.equal((await fetch(base+'flows?date=../../secret')).status,400);
    assert.equal((await fetch(base+'flows/query',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
    assert.equal((await fetch(base+'flows/query',{method:'POST',headers,body:'{"date":"2026-02-30"}'})).status,400);
    assert.equal((await (await fetch(base+'flows?date=2026-09-01')).json()).data,null);
    r=await fetch(base+'watchlist',{method:'POST',headers:{...headers,Origin:'https://evil.example'},body:'{"ids":[]}'});assert.equal(r.status,403);
    r=await fetch(base+'watchlist',{method:'POST',headers,body:'{"ids":["2330"]}'});assert.equal(r.status,200);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory,'watchlist.json'),'utf8')),['2330']);
    r=await fetch(base+'settings',{method:'POST',headers,body:JSON.stringify({weights:{technical:100,chips:100,topic:0,industry:0},updateTime:'19:30',interval:7000,autoUpdate:false,autoScope:'all'})});assert.equal(r.status,400);
    assert.equal(s.stocks.length,1);
    const patterns=await(await fetch(base+'patterns')).json();assert.equal(patterns.universe,3);assert.equal(patterns.matched,1);assert.equal(patterns.stocks[0].id,fixture.stock.id);assert.equal(patterns.stocks[0].bars,undefined);
    assert.equal((await fetch(base+'pattern-detail?id='+fixture.stock.id)).status,200);assert.equal((await fetch(base+'detail?id='+fixture.stock.id)).status,404);
    assert.equal((await fetch(base+'pattern-update',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
    assert.equal((await fetch(base+'detail?id=2454')).status,404);
    for(const endpoint of ['watchlist','news','update']){const body=endpoint==='watchlist'?{ids:['9998']}:endpoint==='news'?{stockId:'2454'}:{scope:'selected',ids:['2454']};const blocked=await fetch(base+endpoint,{method:'POST',headers,body:JSON.stringify(body)});assert.equal(blocked.status,400,endpoint);}
    // 自選可加入研究名單以外、但在股票清單中的股票（例如型態選股挑到的），並可指定自訂分組
    r=await fetch(base+'watchlist',{method:'POST',headers,body:'{"ids":["2330","2454"]}'});assert.equal(r.status,200);
    const wg=await(await fetch(base+'watch/groups',{method:'POST',headers,body:JSON.stringify({groups:[{name:'核心持股'},{name:'觀察'}]})})).json();assert.deepEqual(wg.watchGroups.groups.map(g=>g.name),['核心持股','觀察']);
    assert.equal((await fetch(base+'watch/groups',{method:'POST',headers,body:JSON.stringify({groups:[{name:'重複'},{name:'重複'}]})})).status,400);
    const core=wg.watchGroups.groups[0].id;let ws=await(await fetch(base+'watch/set',{method:'POST',headers,body:JSON.stringify({id:'2454',on:true,group:core})})).json();assert.equal(ws.watchGroups.assign['2454'],core);
    assert.equal((await fetch(base+'watch/set',{method:'POST',headers,body:JSON.stringify({id:'2454',on:true,group:'w99'})})).status,400,'unknown group');
    const st=await(await fetch(base+'state')).json();assert.deepEqual(st.watchlist,['2330','2454']);assert.deepEqual(st.watchExtra.map(x=>[x.id,x.name]),[['2454','聯發科']]);assert.equal(st.watchGroups.assign['2454'],core);
    ws=await(await fetch(base+'watch/set',{method:'POST',headers,body:JSON.stringify({id:'2454',on:false})})).json();assert.deepEqual(ws.watchlist,['2330']);assert.equal(ws.watchGroups.assign['2454'],undefined);
    let created=await fetch(base+'groups',{method:'POST',headers,body:JSON.stringify({name:'新族群'})});assert.equal(created.status,201);
    const saved=JSON.parse(fs.readFileSync(path.join(directory,'groups.json'),'utf8'));const gid=saved.groups.at(-1).id;
    assert.equal((await fetch(base+'groups',{method:'POST',headers,body:JSON.stringify({name:'新族群'})})).status,400);
    for(const groupId of ['test',gid]){assert.equal((await fetch(base+'group-stocks',{method:'POST',headers,body:JSON.stringify({groupId,stockId:'2454'})})).status,200);}
    const after=await (await fetch(base+'state')).json();assert.equal(after.stocks.length,2);assert.equal(after.stocks.find(x=>x.id==='2454').groupIds.length,2);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'groups.json'),'utf8')).groups.at(-1).stockIds[0],'2454');
    const event={stockId:'2330',title:'測試事件請勿交易',url:'https://example.com/evidence',date:'2026-09-18',direction:'neutral',stage:'watch'};
    r=await fetch(base+'evidence',{method:'POST',headers,body:JSON.stringify({...event,url:'javascript:alert(1)'})});assert.equal(r.status,400);
    r=await fetch(base+'evidence',{method:'POST',headers,body:JSON.stringify(event)});assert.equal(r.status,200);
    const d=await (await fetch(base+'detail?id=2330')).json();assert.equal(d.evidence.length,1);assert.equal(d.topic.score,50);
    r=await fetch(base+'evidence',{method:'POST',headers,body:JSON.stringify({deleteId:d.evidence[0].id})});assert.equal(r.status,200);
    assert.equal((await fetch('http://127.0.0.1:4399/.local/finmind.dpapi')).status,404);
    const heat=await(await fetch(base+'heatmap')).json();assert.equal(heat.data,null);assert.deepEqual(heat.dates,[]);
    assert.equal((await fetch(base+'heatmap?date=../../x')).status,400);
    assert.equal((await fetch(base+'heatmap/query',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"date":"2026-09-21"}'})).status,403);
    assert.equal((await fetch(base+'heatmap/query',{method:'POST',headers,body:'{"date":"2026-02-30"}'})).status,400);
    assert.equal((await fetch('http://127.0.0.1:4399/heatmap.js')).status,200);assert.equal((await fetch('http://127.0.0.1:4399/hud.css')).status,200);assert.equal((await fetch('http://127.0.0.1:4399/style.css')).status,404);
    assert.equal((await(await fetch(base+'health')).json()).app,'equilens-nexus');
    assert.equal((await fetch(base+'detail?id=999999')).status,404);
  }finally{child.kill();await new Promise(r=>child.once('close',r));fs.rmSync(directory,{recursive:true,force:true});}
});
test('Windows credential encryption round trip uses isolated test directory',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'equilens-secret-test-'));
  const run=code=>new Promise((resolve,reject)=>{const c=spawn(process.execPath,['--input-type=module','-e',code],{cwd:root,env:{...process.env,EQUITY_DATA_DIR:directory,FINMIND_API_TOKEN:''},windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';c.stdout.on('data',x=>output+=x);c.on('close',n=>n===0?resolve(output):reject(new Error('Credential test failed')));c.on('error',reject);});
  try{await run("import {saveSecret} from './lib/secrets.mjs';await saveSecret('finmind','test-credential-only');");const ciphertext=fs.readFileSync(path.join(directory,'finmind.dpapi'),'utf8');assert(!ciphertext.includes('test-credential-only'));assert.equal(await run("import {getSecret,secretConfigured} from './lib/secrets.mjs';console.log((await getSecret('finmind','FINMIND_API_TOKEN'))==='test-credential-only'&&secretConfigured('finmind','FINMIND_API_TOKEN'));"),'true\n');
    await run("import {deleteSecret,secretConfigured} from './lib/secrets.mjs';await deleteSecret('finmind');if(secretConfigured('finmind'))process.exit(1);");assert(!fs.existsSync(path.join(directory,'finmind.dpapi')));}finally{fs.rmSync(directory,{recursive:true,force:true});}
});
