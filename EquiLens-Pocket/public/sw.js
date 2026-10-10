// 衡析 Pocket Service Worker：只負責接收推播並顯示通知（不快取頁面，資料一律即時向電腦取得）。
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { title: '衡析', body: e.data?.text() || '' }; }
  e.waitUntil(self.registration.showNotification(d.title || '衡析', {
    body: d.body || '', tag: d.tag || undefined, renotify: !!d.tag, icon: '/icon-192.png', badge: '/badge-96.png', // badge：狀態列小圖示，Android 只取透明度，需為透明底單色剪影
    data: { url: d.url || '/' }, vibrate: [120, 60, 120],
    silent: false, // 使用 Android 通知類別設定的提示音（可在三星「設定 → 通知」替衡析指定內建音效）
    timestamp: Date.now(),
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/', self.location.origin).href;
  // 新聞通知帶的是外部原文網址：直接開啟原文
  if (new URL(url).origin !== self.location.origin) { e.waitUntil(self.clients.openWindow(url)); return; }
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if (new URL(c.url).origin === self.location.origin) { await c.focus(); c.postMessage({ type: 'open', url }); return; } }
    await self.clients.openWindow(url);
  })());
});
