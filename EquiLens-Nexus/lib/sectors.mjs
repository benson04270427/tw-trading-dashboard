// 產業（板塊）名稱整理：台股上市與上櫃的產業名稱略有差異（例如「其他電子業／其他電子類」），合併成同一板塊；
// 其他市場的產業名稱原樣使用，沒有產業資料時歸為「未分類」。
const SECTOR_ALIAS = { '創新版股票': '創新板股票', '其他電子': '其他電子業', '觀光事業': '觀光餐旅' };
export function normalizeSector(name) {
  const raw = String(name || '').trim();
  if (!raw || raw === '未分類') return '未分類';
  const base = raw.length > 2 && /[一-鿿]類$/.test(raw) ? raw.replace(/類$/, '') : raw;
  return SECTOR_ALIAS[base] || base;
}
