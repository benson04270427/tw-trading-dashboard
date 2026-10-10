// 圖卡存檔（電腦版與手機版共用，兩邊各放一份相同檔案）。
// iPhone／iPad 的 <a download> 只會存到「檔案」或在主畫面 App 中沒有反應：改為顯示圖片預覽，
// 按「儲存到照片」開分享選單選「儲存影像」，或長按圖片「加入照片」。其他裝置直接下載 PNG。
export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const toDataURL = blob => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error('圖片讀取失敗')); r.readAsDataURL(blob); });

// 回傳 'download'（已下載）或 'sheet'（已顯示 iOS 儲存預覽）
export async function saveImage(blob, filename) {
  if (!isIOS()) {
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 3000);
    return 'download';
  }
  const file = new File([blob], filename, { type: blob.type || 'image/png' }), canShare = !!navigator.canShare?.({ files: [file] });
  const src = await toDataURL(blob); // 用 data: 網址（兩個 App 的安全政策都允許）
  document.getElementById('ios-save')?.remove();
  const box = document.createElement('div');
  box.id = 'ios-save'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', '儲存圖卡');
  box.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:calc(16px + env(safe-area-inset-top)) 16px calc(16px + env(safe-area-inset-bottom));background:rgba(0,0,0,.88);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);font:15px/1.5 -apple-system,"PingFang TC",sans-serif;color:#fff;text-align:center';
  const btn = 'min-height:46px;padding:0 22px;border-radius:12px;border:0;font:inherit;font-weight:700';
  box.innerHTML = `<img alt="圖卡預覽" style="max-width:100%;max-height:calc(100% - 150px);object-fit:contain;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.6);-webkit-touch-callout:default"><p style="margin:0;color:#cfd8e6">${canShare ? '按「儲存到照片」選擇「儲存影像」，或' : ''}長按圖片選「加入照片」</p><div style="display:flex;gap:10px">${canShare ? `<button type="button" data-ios-share style="${btn};background:#2ee6ff;color:#021219">儲存到照片</button>` : ''}<button type="button" data-ios-close style="${btn};background:#2a3447;color:#fff">關閉</button></div>`;
  box.querySelector('img').src = src;
  box.addEventListener('click', async e => {
    if (e.target.closest('[data-ios-close]') || e.target === box) return box.remove();
    if (e.target.closest('[data-ios-share]')) {
      try { await navigator.share({ files: [file], title: filename }); box.remove(); } // 這裡是新的點擊，iOS 才允許開分享選單
      catch (err) { if (err?.name !== 'AbortError') box.querySelector('p').textContent = '無法開啟分享選單，請長按圖片選「加入照片」'; }
    }
  });
  document.body.append(box);
  return 'sheet';
}
