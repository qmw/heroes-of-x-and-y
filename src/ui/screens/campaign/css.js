// Injects campaign.css once (screen-local stylesheet, docs/mechanics/ui.md §3).
export function injectCampaignCss() {
  if (typeof document === 'undefined' || !document.head) return;
  if (document.head.querySelector && document.head.querySelector('link[data-cmp-css]')) return;
  try {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('./campaign.css', import.meta.url).href;
    link.setAttribute('data-cmp-css', '1');
    document.head.appendChild(link);
  } catch { /* no CSS in exotic environments */ }
}
