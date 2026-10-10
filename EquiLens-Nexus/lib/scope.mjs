import crypto from 'node:crypto';
import { activeMarket } from './config.mjs';
import { UserError } from './i18n.mjs';

export const EMPTY_SCOPE = Object.freeze({ version: 1, groups: [], stockMetadata: [] });
const symbolOk = (id, market) => typeof id === 'string' && market.symbolRe.test(id);
export function scopeIds(scope) {
  return [...new Set(scope.groups.flatMap(g => g.stockIds))];
}
export function validateScope(scope, market = activeMarket()) {
  if (!scope || scope.version !== 1 || !Array.isArray(scope.groups)) throw new UserError('族群設定格式錯誤');
  const ids = new Set();
  for (const g of scope.groups) {
    if (typeof g.id !== 'string' || ids.has(g.id) || typeof g.name !== 'string' || !g.name.trim() || !Array.isArray(g.stockIds) || !g.stockIds.every(id => symbolOk(id, market)) || new Set(g.stockIds).size !== g.stockIds.length) throw new UserError('族群設定格式錯誤或包含重複成員');
    ids.add(g.id);
  }
  return scope;
}
export function resolveScope(scope, catalog) {
  const metadata = new Map([...(scope.stockMetadata || []), ...catalog].map(s => [s.id,s]));
  return scopeIds(scope).map(id => ({
    ...(metadata.get(id) || {id,name:id,sector:'未分類',market:'待確認',listingNote:'股票基本資料待確認'}),
    groupIds:scope.groups.filter(g=>g.stockIds.includes(id)).map(g=>g.id),
    groupNames:scope.groups.filter(g=>g.stockIds.includes(id)).map(g=>g.name),
  }));
}
const cleanName = name => {
  if(typeof name!=='string')throw new UserError('請輸入族群名稱');
  const cleaned=name.trim();
  if(!cleaned || cleaned.length>40 || /[\u0000-\u001f\u007f]/.test(cleaned))throw new UserError('族群名稱須為 1–40 個字，不可包含控制字元');
  return cleaned;
};
const sameName = (a, b) => a.normalize('NFKC').toLocaleLowerCase() === b.normalize('NFKC').toLocaleLowerCase();
export function addGroup(scope,name) {
  const cleaned=cleanName(name);
  if(scope.groups.some(g=>sameName(g.name,cleaned)))throw new UserError('族群名稱已存在');
  const group={id:crypto.randomUUID(),name:cleaned,stockIds:[],createdAt:new Date().toISOString()};
  return {scope:{...scope,groups:[...scope.groups,group]},group};
}
export function renameGroup(scope,groupId,name) {
  const cleaned=cleanName(name);
  if(!scope.groups.some(g=>g.id===groupId))throw new UserError('找不到指定族群');
  if(scope.groups.some(g=>g.id!==groupId&&sameName(g.name,cleaned)))throw new UserError('族群名稱已存在');
  return {...scope,groups:scope.groups.map(g=>g.id===groupId?{...g,name:cleaned}:g)};
}
export function removeGroup(scope,groupId) {
  if(!scope.groups.some(g=>g.id===groupId))throw new UserError('找不到指定族群');
  const groups=scope.groups.filter(g=>g.id!==groupId),keep=new Set(groups.flatMap(g=>g.stockIds));
  return {...scope,groups,stockMetadata:(scope.stockMetadata||[]).filter(s=>keep.has(s.id))};
}
// 族群排序：ids 為全部族群代號的新順序
export function reorderGroups(scope,ids) {
  if(!Array.isArray(ids)||ids.length!==scope.groups.length||new Set(ids).size!==ids.length||!ids.every(id=>scope.groups.some(g=>g.id===id)))throw new UserError('族群排序資料錯誤');
  return {...scope,groups:ids.map(id=>scope.groups.find(g=>g.id===id))};
}
export function addStock(scope,groupId,stockId,catalog,market=activeMarket()) {
  const group=scope.groups.find(g=>g.id===groupId);
  if(!group)throw new UserError('找不到指定族群');
  if(!symbolOk(stockId,market))throw new UserError('股票代碼格式錯誤');
  const metadata=catalog.find(s=>s.id===stockId)||(scope.stockMetadata||[]).find(s=>s.id===stockId);
  if(!metadata)throw new UserError('查無可新增的股票，請先更新股票基本資料');
  if(group.stockIds.includes(stockId))return {scope,added:false};
  return {scope:{...scope,groups:scope.groups.map(g=>g.id===groupId?{...g,stockIds:[...g.stockIds,stockId]}:g),stockMetadata:[...(scope.stockMetadata||[]).filter(s=>s.id!==stockId),metadata]},added:true};
}
export function removeStock(scope,groupId,stockId) {
  const group=scope.groups.find(g=>g.id===groupId);
  if(!group)throw new UserError('找不到指定族群');
  if(!group.stockIds.includes(stockId))return {scope,removed:false};
  const groups=scope.groups.map(g=>g.id===groupId?{...g,stockIds:g.stockIds.filter(id=>id!==stockId)}:g),keep=new Set(groups.flatMap(g=>g.stockIds));
  return {scope:{...scope,groups,stockMetadata:(scope.stockMetadata||[]).filter(s=>keep.has(s.id))},removed:true};
}
// 匯入族群（設定檔匯出入、範本）：名稱相同的族群合併成分股，其餘新增；只接受目前市場格式的代號
export function importGroups(scope,list,catalog=[],market=activeMarket()) {
  if(!Array.isArray(list)||list.length>200)throw new UserError('族群設定格式錯誤');
  let next={...scope,groups:[...scope.groups],stockMetadata:[...(scope.stockMetadata||[])]},added=0,skipped=0;
  const meta=new Map([...next.stockMetadata,...catalog].map(s=>[s.id,s]));
  for(const g of list){
    const name=cleanName(g?.name),ids=[...new Set(Array.isArray(g?.stockIds)?g.stockIds:[])].filter(id=>{const ok=symbolOk(id,market);if(!ok)skipped++;return ok;}).slice(0,500);
    let target=next.groups.find(x=>sameName(x.name,name));
    if(!target){target={id:crypto.randomUUID(),name,stockIds:[],createdAt:new Date().toISOString()};next.groups.push(target);}
    const merged=[...new Set([...target.stockIds,...ids])];added+=merged.length-target.stockIds.length;
    next.groups=next.groups.map(x=>x.id===target.id?{...x,stockIds:merged}:x);
    for(const id of ids)if(!next.stockMetadata.some(s=>s.id===id))next.stockMetadata.push(meta.get(id)||{id,name:id,sector:'',market:''});
  }
  return {scope:validateScope(next,market),added,skipped};
}
export function selectedUpdateIds(scope,kind,ids=[],watchlist=[]) {
  const allowed=new Set(scopeIds(scope));
  if(kind==='all')return [...allowed];
  if(kind==='watchlist')return [...new Set(watchlist)].filter(id=>allowed.has(id));
  if(kind==='universe')return [];
  if(kind!=='selected'||!Array.isArray(ids)||!ids.every(id=>allowed.has(id)))throw new UserError('股票不在研究範圍內，請先加入族群');
  return [...new Set(ids)];
}
