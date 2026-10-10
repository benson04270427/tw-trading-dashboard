// 自選分組：使用者自訂的分組名稱；每檔自選股屬於一個分組，沒指定的歸在「未分組」。電腦版與手機版共用同一份。
// 檔案 .local/watch-groups.json：{ groups: [{ id: 'w1', name: '核心持股' }], assign: { '2330': 'w1' } }
export const MAX_WATCH_GROUPS = 30, MAX_GROUP_NAME = 20;

export function normalizeWatchGroups(v, watchlist = []) {
  const seen = new Set(), groups = [];
  for (const g of Array.isArray(v?.groups) ? v.groups : []) {
    const name = typeof g?.name === 'string' ? g.name.trim().slice(0, MAX_GROUP_NAME) : '';
    if (!/^w\d{1,4}$/.test(g?.id || '') || !name || seen.has(g.id) || groups.length >= MAX_WATCH_GROUPS) continue;
    seen.add(g.id); groups.push({ id: g.id, name });
  }
  const inList = new Set(watchlist);
  const assign = Object.fromEntries(Object.entries(v?.assign || {}).filter(([id, gid]) => inList.has(id) && seen.has(gid)));
  return { groups, assign };
}

// 分組清單編輯（新增、改名、刪除、排序）：list 為 [{ id?, name }]，保留既有 id；被刪掉的分組，成員回到「未分組」
export function editWatchGroups(cur, list, watchlist = []) {
  if (!Array.isArray(list) || list.length > MAX_WATCH_GROUPS) throw new Error(`分組最多 ${MAX_WATCH_GROUPS} 個`);
  const names = new Set(), groups = [], keep = new Set(cur.groups.map(g => g.id));
  // 新分組不重用目前任何分組或指派中出現過的代號，避免刪掉的舊分組成員被帶到新分組
  const used = new Set([...cur.groups.map(g => g.id), ...Object.values(cur.assign || {})]);
  let n = 1;
  for (const g of list) {
    const name = String(g?.name ?? '').trim();
    if (!name || name.length > MAX_GROUP_NAME) throw new Error(`分組名稱需為 1–${MAX_GROUP_NAME} 個字`);
    if (names.has(name)) throw new Error(`分組名稱重複：${name}`);
    names.add(name);
    let id = keep.has(g?.id) && !groups.some(x => x.id === g.id) ? g.id : null;
    if (!id) { while (used.has(`w${n}`)) n++; id = `w${n}`; used.add(id); }
    groups.push({ id, name });
  }
  return normalizeWatchGroups({ groups, assign: cur.assign }, watchlist);
}

// 加入／移除單一自選股並指定分組：group 為 undefined 表示不改分組，'' 表示未分組
export function setWatch({ watchlist, groups }, id, on, group) {
  let list = watchlist.filter(x => x !== id), assign = { ...groups.assign };
  if (on) {
    list = watchlist.includes(id) ? watchlist.slice() : [...watchlist, id];
    if (group !== undefined) {
      if (group && !groups.groups.some(g => g.id === group)) throw new Error('找不到這個自選分組，請重新整理');
      if (group) assign[id] = group; else delete assign[id];
    }
  } else delete assign[id];
  return { watchlist: list, groups: normalizeWatchGroups({ groups: groups.groups, assign }, list) };
}
