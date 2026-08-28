import { list } from '@vercel/blob';

const CODE_PATTERN = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5,7}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeOfficialURL(value, alertID) {
  try {
    const url = new URL(String(value ?? ''));
    if (url.protocol !== 'https:' || url.hostname !== 'weatherkit.apple.com') return null;
    const ids = (url.searchParams.get('ids') ?? '').split(',').map((item) => item.trim().toLowerCase());
    if (!ids.includes(alertID.toLowerCase())) return null;
    return url.toString();
  } catch (_) {
    return null;
  }
}

function fallbackOfficialURL(alertID) {
  const url = new URL('https://weatherkit.apple.com/alertDetails/index.html');
  url.searchParams.set('ids', alertID);
  return url.toString();
}

async function exactBlob(pathname) {
  const result = await list({ prefix: pathname, limit: 2 });
  return result.blobs.find((blob) => blob.pathname === pathname) ?? null;
}

async function readRecord(code) {
  const blob = await exactBlob(`alerts/${code}.json`);
  if (!blob) return null;
  const result = await fetch(blob.url, { cache: 'no-store' });
  if (!result.ok) return null;
  return result.json();
}

function pageShell({ code, record }) {
  const alertID = UUID_PATTERN.test(record?.alertID ?? '') ? record.alertID : null;
  if (!alertID) return null;

  const summary = String(record.summary || 'Official weather alert').slice(0, 220);
  const severity = String(record.severity || 'Official').slice(0, 40);
  const region = record.region ? String(record.region).slice(0, 220) : '';
  const source = String(record.source || 'Official weather agency').slice(0, 220);
  const issuedAt = record.issuedAt && !Number.isNaN(new Date(record.issuedAt).getTime()) ? new Date(record.issuedAt).toISOString() : '';
  const expiresAt = record.expiresAt && !Number.isNaN(new Date(record.expiresAt).getTime()) ? new Date(record.expiresAt).toISOString() : '';
  const active = !expiresAt || new Date(expiresAt).getTime() > Date.now();
  const officialURL = safeOfficialURL(record.detailsURL, alertID) ?? fallbackOfficialURL(alertID);
  const canonical = `https://vane.codearc.studio/a/${code}`;
  const previewDescription = [region, `${severity} alert`, `Issued by ${source}`].filter(Boolean).join(' · ');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <meta name="theme-color" content="#081725" />
  <title>${esc(summary)} · Vane</title>
  <meta name="description" content="${esc(previewDescription)}" />
  <meta property="og:title" content="${esc(summary)}" />
  <meta property="og:description" content="${esc(previewDescription)}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${esc(canonical)}" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="${esc(summary)}" />
  <meta name="twitter:description" content="${esc(previewDescription)}" />
  <link rel="canonical" href="${esc(canonical)}" />
  <link rel="icon" type="image/png" href="/favicon.png" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  <style>
    :root{color-scheme:dark;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text",Inter,system-ui,sans-serif;background:#081725;color:#f8fbff}
    *{box-sizing:border-box} body{margin:0;min-height:100vh;background:radial-gradient(circle at 18% 5%,rgba(77,157,245,.28),transparent 28rem),radial-gradient(circle at 92% 20%,rgba(153,211,255,.13),transparent 25rem),linear-gradient(155deg,#071421 0%,#0b2238 54%,#12385b 100%);color:#f8fbff}
    main{width:min(92vw,720px);margin:0 auto;padding:36px 0 56px}.brand{display:flex;align-items:center;gap:10px;margin:0 4px 22px;font-weight:720;letter-spacing:-.02em}.brand img{width:34px;height:34px;object-fit:contain}.card{border:1px solid rgba(255,255,255,.16);border-radius:32px;background:linear-gradient(180deg,rgba(255,255,255,.12),rgba(255,255,255,.065));box-shadow:0 28px 88px rgba(0,0,0,.25);backdrop-filter:blur(28px) saturate(135%);-webkit-backdrop-filter:blur(28px) saturate(135%)}
    .hero{padding:28px}.topline{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.eyebrow{font-size:12px;font-weight:760;letter-spacing:.09em;text-transform:uppercase;color:rgba(230,241,252,.68)}.status{display:inline-flex;align-items:center;gap:7px;padding:8px 11px;border:1px solid rgba(255,255,255,.15);border-radius:999px;background:rgba(255,255,255,.07);font-size:12px;font-weight:700}.status-dot{width:7px;height:7px;border-radius:50%;background:${active ? '#78c7ff' : '#a9b4c1'}}
    h1{margin:22px 0 0;font-size:clamp(36px,8vw,58px);line-height:1.01;letter-spacing:-.045em}.agency{margin:16px 0 0;font-size:16px;line-height:1.5;color:rgba(235,244,253,.74)}.agency strong{color:#fff}.facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;margin-top:18px;overflow:hidden}.fact{padding:18px 20px;background:rgba(255,255,255,.065)}.fact-label{font-size:11px;font-weight:720;letter-spacing:.06em;text-transform:uppercase;color:rgba(224,238,252,.52)}.fact-value{margin-top:6px;font-size:15px;font-weight:650;line-height:1.35}.guidance{margin-top:14px;padding:22px}.guidance h2{margin:0;font-size:19px;letter-spacing:-.02em}.guidance p{margin:9px 0 0;color:rgba(235,244,253,.68);line-height:1.55}.actions{display:grid;gap:10px;margin-top:14px}.button{min-height:56px;border-radius:18px;display:flex;align-items:center;justify-content:center;padding:0 18px;text-decoration:none;font-weight:720;letter-spacing:-.01em}.primary{color:#061321;background:linear-gradient(135deg,#f8fbff,#b8dcff);box-shadow:inset 0 1px 0 rgba(255,255,255,.8),0 14px 34px rgba(48,139,238,.18)}.secondary{color:#f5f9ff;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.065)}.source-note{margin:15px 4px 0;color:rgba(224,238,252,.48);font-size:12px;line-height:1.5}.code{font-variant-numeric:tabular-nums;font-weight:700}.hidden{display:none!important}
    @media(max-width:560px){main{padding:20px 0 40px}.hero{padding:23px}.card{border-radius:27px}.facts{grid-template-columns:1fr}.guidance{padding:20px}h1{font-size:clamp(34px,11vw,48px)}}
  </style>
</head>
<body>
  <main>
    <div class="brand"><img src="/assets/vane-logo.png" alt="" /><span>Vane</span></div>
    <section class="card hero">
      <div class="topline"><div class="eyebrow">Official weather alert</div><div class="status"><span class="status-dot"></span>${active ? 'Active' : 'Ended'}</div></div>
      <h1>${esc(summary)}</h1>
      <p class="agency">Official alert issued by <strong>${esc(source)}</strong>${region ? ` for ${esc(region)}` : ''}.</p>
    </section>

    <section class="card facts" aria-label="Alert details">
      ${region ? `<div class="fact"><div class="fact-label">Area</div><div class="fact-value">${esc(region)}</div></div>` : ''}
      <div class="fact"><div class="fact-label">Severity</div><div class="fact-value">${esc(severity)}</div></div>
      ${issuedAt ? `<div class="fact"><div class="fact-label">Issued</div><div class="fact-value local-time" data-date="${esc(issuedAt)}">${esc(new Date(issuedAt).toUTCString())}</div></div>` : ''}
      ${expiresAt ? `<div class="fact"><div class="fact-label">${active ? 'Listed until' : 'Ended'}</div><div class="fact-value local-time" data-date="${esc(expiresAt)}">${esc(new Date(expiresAt).toUTCString())}</div></div>` : ''}
    </section>

    <section class="card guidance">
      <h2>Check the full alert</h2>
      <p>Read the issuing agency’s complete instructions, timing, and updates before making safety decisions.</p>
      <div class="actions">
        <a class="button primary" href="${esc(officialURL)}" rel="noopener noreferrer">View full official alert</a>
        <a class="button secondary" href="https://vane.codearc.studio/">About Vane</a>
      </div>
    </section>

    <p class="source-note">Shared from Vane · <span class="code">${esc(code)}</span>. Vane preserves the alert details provided by the official issuing agency.</p>
  </main>
  <script>
    for (const element of document.querySelectorAll('.local-time')) {
      const date = new Date(element.dataset.date || '');
      if (!Number.isNaN(date.getTime())) {
        element.textContent = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
      }
    }
  </script>
</body>
</html>`;
}

function invalidPage(code = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="#081725"><title>Alert unavailable · Vane</title><meta property="og:title" content="Alert unavailable · Vane"><meta property="og:description" content="This shared weather alert is unavailable."><meta name="twitter:card" content="summary"><link rel="icon" href="/favicon.png"><style>:root{color-scheme:dark;font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;background:#081725;color:#fff}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:linear-gradient(145deg,#071421,#12385b)}main{width:min(90vw,520px);padding:28px}.card{padding:28px;border:1px solid rgba(255,255,255,.16);border-radius:30px;background:rgba(255,255,255,.08);backdrop-filter:blur(24px)}h1{margin:0;font-size:36px;letter-spacing:-.04em}p{color:rgba(255,255,255,.65);line-height:1.5}a{display:flex;min-height:54px;align-items:center;justify-content:center;margin-top:20px;border-radius:17px;background:#f5f9ff;color:#071421;text-decoration:none;font-weight:700}</style></head><body><main><section class="card"><h1>Alert unavailable.</h1><p>${code ? `The shared code ${esc(code)} is invalid, expired, or no longer available.` : 'This shared alert link is invalid or no longer available.'}</p><a href="https://vane.codearc.studio/">Go to Vane</a></section></main></body></html>`;
}

export default async function handler(request, response) {
  const code = String(request.query?.id ?? '').trim().toUpperCase();
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');

  if (!CODE_PATTERN.test(code) || !process.env.BLOB_READ_WRITE_TOKEN) {
    response.status(404).send(invalidPage(code));
    return;
  }

  try {
    const record = await readRecord(code);
    const html = record ? pageShell({ code, record }) : null;
    if (!html) {
      response.status(404).send(invalidPage(code));
      return;
    }
    response.status(200).send(html);
  } catch (error) {
    console.error('Vane alert page error:', error);
    response.status(404).send(invalidPage(code));
  }
}
