const number=v=>v!==''&&v!=null&&Number.isFinite(Number(v))?Number(v):null;
const delta=(a,b)=>a!=null&&b!=null?a-b:null;
export function buildOptions(date,institutions=[],daily=[]){
 const valid=institutions.filter(r=>(r.option_id||r.name)==='TXO'&&r.date<=date);
 const positions=['外資','自營商'].flatMap(investor=>['買權','賣權'].map(side=>{
  const rows=[...new Map(valid.filter(r=>r.institutional_investors===investor&&r.call_put===side).map(r=>[r.date,r])).values()].sort((a,b)=>a.date.localeCompare(b.date));
  const now=rows.find(r=>r.date===date),prev=rows.filter(r=>r.date<date).at(-1);
  const long=number(now?.long_open_interest_balance_volume),short=number(now?.short_open_interest_balance_volume),net=delta(long,short),before=delta(number(prev?.long_open_interest_balance_volume),number(prev?.short_open_interest_balance_volume));
  return {investor,side,long,short,net,netChange:delta(net,before),previousDate:before!=null?prev.date:null};
 }));
 const rows=[...new Map(daily.filter(r=>r.option_id==='TXO'&&r.trading_session==='position'&&r.date<=date&&['call','put'].includes(r.call_put)&&/^\d{6}(W\d+)?$/.test(r.contract_date)&&number(r.strike_price)>0&&number(r.open_interest)!==null&&number(r.open_interest)>=0).map(r=>[[r.date,r.contract_date,r.strike_price,r.call_put].join('|'),r])).values()];
 const contracts=[...new Set(rows.filter(r=>r.date===date).map(r=>r.contract_date))].sort().map(contract=>{
  const now=rows.filter(r=>r.contract_date===contract&&r.date===date),previousDate=rows.filter(r=>r.contract_date===contract&&r.date<date).map(r=>r.date).sort().at(-1)||null;
  const before=new Map(rows.filter(r=>r.contract_date===contract&&r.date===previousDate).map(r=>[r.strike_price+'|'+r.call_put,number(r.open_interest)]));
  const strikes=[...new Set(now.map(r=>Number(r.strike_price)))].sort((a,b)=>a-b).map(strike=>{const get=side=>number(now.find(r=>Number(r.strike_price)===strike&&r.call_put===side)?.open_interest);const call=get('call'),put=get('put');return {strike,call,put,callChange:delta(call,before.get(strike+'|call')),putChange:delta(put,before.get(strike+'|put'))};});
  const peak=key=>strikes.filter(r=>r[key]>0).sort((a,b)=>b[key]-a[key]||a.strike-b.strike)[0]?.strike??null;
  return {contract,previousDate,strikes,callPeak:peak('call'),putPeak:peak('put'),totalOI:strikes.reduce((sum,r)=>sum+(r.call??0)+(r.put??0),0)};
 });
 return {available:positions.slice(0,2).every(r=>r.net!=null),positions,contracts,defaultContract:contracts.find(c=>/^\d{6}$/.test(c.contract)&&c.totalOI>0)?.contract||contracts.find(c=>c.totalOI>0)?.contract||contracts[0]?.contract||null};
}
