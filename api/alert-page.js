import { get, list, put } from '@vercel/blob';
import {
  cleanAgencyMessage,
  fallbackOfficialAlertURL,
  fetchOfficialAlert,
  WEATHERKIT_UUID_PATTERN,
  weatherKitConfigured,
} from '../lib/weatherkit-alert.js';

const CODE_PATTERN = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5,7}$/;
const RESPONSE_LABELS = {
  shelter: 'Take shelter in place',
  evacuate: 'Relocate or evacuate',
  prepare: 'Make preparations',
  execute: 'Follow the pre-planned action',
  avoid: 'Avoid the affected event or area',
  monitor: 'Monitor the situation',
  assess: 'Assess the situation',
  allClear: 'The threat is all clear',
  none: 'No specific action recommended',
};

function blobConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function cleanDate(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function titleCase(value, fallback = '') {
  const text = String(value ?? '').trim();
  if (!text || text.toLowerCase() === 'unknown') return fallback;
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function icon(name, className = 'icon') {
  const paths = {
    shield: '<path d="M12 3 5.5 5.7v5.1c0 4.6 2.7 8 6.5 10.2 3.8-2.2 6.5-5.6 6.5-10.2V5.7L12 3Z"/><path d="m9.3 12 1.7 1.7 3.9-4"/>',
    location: '<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.3"/>',
    building: '<path d="M4 20h16M6 17V9m4 8V9m4 8V9m4 8V9M4 7l8-4 8 4H4Z"/>',
    severity: '<path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v4.8M12 17.1v.1"/>',
    certainty: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
    urgency: '<path d="M13 2 5.7 13h5.1L10 22l8.3-12h-5.2L13 2Z"/>',
    calendar: '<rect x="3.5" y="5.5" width="17" height="15" rx="2.5"/><path d="M7.5 3v5M16.5 3v5M3.5 10h17"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.4 2"/>',
    onset: '<path d="M3 15h4l2.2-6 4 10 2.2-7H21"/>',
    hourglass: '<path d="M7 3h10M7 21h10M8 3c0 4 1.5 6 4 9-2.5 3-4 5-4 9m8-18c0 4-1.5 6-4 9 2.5 3 4 5 4 9"/>',
    action: '<path d="M12 3 5.5 5.7v5.1c0 4.6 2.7 8 6.5 10.2 3.8-2.2 6.5-5.6 6.5-10.2V5.7L12 3Z"/><path d="m8.8 12.2 2 2 4.4-4.7"/>',
    message: '<path d="M5 3.5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 3v-15a2 2 0 0 1 2-2Z"/><path d="M8 8h8M8 12h6"/>',
    source: '<path d="M4 20h16M6 17V9m4 8V9m4 8V9m4 8V9M4 7l8-4 8 4H4Z"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/>',
  };
  const path = paths[name] ?? paths.shield;
  return `<svg class="${esc(className)}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

function safeOfficialURL(value, alertID, verified) {
  try {
    const url = new URL(String(value ?? ''));
    if (url.protocol !== 'https:') return null;
    if (verified) return url.toString();

    if (url.hostname !== 'weatherkit.apple.com') return null;
    const ids = (url.searchParams.get('ids') ?? '').split(',').map((item) => item.trim().toLowerCase());
    return ids.includes(alertID.toLowerCase()) ? url.toString() : null;
  } catch (_) {
    return null;
  }
}

async function exactBlob(pathname) {
  const result = await list({ prefix: pathname, limit: 2 });
  return result.blobs.find((blob) => blob.pathname === pathname) ?? null;
}

async function readRecord(code) {
  const blob = await exactBlob(`alerts/${code}.json`);
  if (!blob) return null;
  const result = await get(blob.url, { access: 'private' });
  if (!result) return null;
  return JSON.parse(await new Response(result.stream).text());
}

async function upgradeLegacyRecord(code, record) {
  if (record?.verified === true || !weatherKitConfigured()) return record;
  const alertID = String(record?.alertID ?? '').trim().toLowerCase();
  if (!WEATHERKIT_UUID_PATTERN.test(alertID)) return record;

  try {
    const official = await fetchOfficialAlert(alertID, record?.language ?? 'en-US');
    const upgraded = {
      ...official,
      code,
      createdAt: record?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await put(`alerts/${code}.json`, JSON.stringify(upgraded), {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
    });
    return upgraded;
  } catch (_) {
    return record;
  }
}

function preferredMessage(record) {
  const messages = Array.isArray(record.messages) ? record.messages : [];
  if (!messages.length) return '';
  const language = String(record.language ?? '').toLowerCase();
  const baseLanguage = language.split('-')[0];
  const exact = messages.find((message) => String(message?.language ?? '').toLowerCase() === language);
  const base = messages.find((message) => String(message?.language ?? '').toLowerCase().split('-')[0] === baseLanguage);
  return cleanAgencyMessage(String((exact ?? base ?? messages[0])?.text ?? ''));
}

function responseCards(record) {
  const values = Array.isArray(record.responses) ? record.responses : [];
  const useful = values.filter((value) => value !== 'none' && RESPONSE_LABELS[value]);
  const finalValues = useful.length ? useful : values.filter((value) => RESPONSE_LABELS[value]);
  if (!finalValues.length) return '';

  return `<section class="card content-card action-card">
    <div class="section-head">
      <div class="section-icon action-icon">${icon('action')}</div>
      <div><div class="section-kicker">Recommended action</div><h2>${finalValues.length === 1 ? esc(RESPONSE_LABELS[finalValues[0]]) : 'Follow the reporting agency’s recommended actions'}</h2></div>
    </div>
    ${finalValues.length > 1 ? `<div class="action-list">${finalValues.map((value) => `<div class="action-pill">${icon('action', 'mini-icon')}<span>${esc(RESPONSE_LABELS[value])}</span></div>`).join('')}</div>` : ''}
    <p>These actions come from the reporting agency data supplied through Apple Weather.</p>
  </section>`;
}

function fact(label, value, iconName, date = false) {
  if (!value) return '';
  return `<div class="fact"><div class="fact-icon">${icon(iconName)}</div><div class="fact-copy"><div class="fact-label">${esc(label)}</div><div class="fact-value${date ? ' local-time' : ''}"${date ? ` data-date="${esc(value)}"` : ''}>${esc(date ? new Date(value).toUTCString() : value)}</div></div></div>`;
}

function pageShell({ code, record }) {
  const alertID = WEATHERKIT_UUID_PATTERN.test(record?.alertID ?? '') ? String(record.alertID).toLowerCase() : null;
  if (!alertID) return null;

  const verified = record.verified === true && record.verificationSource === 'weatherkit-rest';
  const summary = String(record.summary || 'Official weather alert').slice(0, 240);
  const severity = titleCase(record.severity, 'Official');
  const region = record.region ? String(record.region).slice(0, 500) : '';
  const source = String(record.source || 'Official weather agency').slice(0, 300);
  const certainty = titleCase(record.certainty);
  const urgency = titleCase(record.urgency);
  const issuedAt = cleanDate(record.issuedAt);
  const effectiveAt = cleanDate(record.effectiveAt);
  const onsetAt = cleanDate(record.onsetAt);
  const eventEndAt = cleanDate(record.eventEndAt);
  const expiresAt = cleanDate(record.expiresAt);
  const verifiedAt = cleanDate(record.verifiedAt);
  const statusEnd = expiresAt || eventEndAt;
  const active = !statusEnd || new Date(statusEnd).getTime() > Date.now();
  const language = String(record.language || 'en-US');
  const officialURL = safeOfficialURL(record.detailsURL, alertID, verified) ?? fallbackOfficialAlertURL(alertID, language);
  const canonical = `https://vane.codearc.studio/a/${code}`;
  const message = verified ? preferredMessage(record) : '';
  const previewDescription = [region, `${severity} alert`, `Issued by ${source}`].filter(Boolean).join(' · ').slice(0, 300);
  const statusText = active ? 'Active' : 'Ended';
  const integrityLabel = verified ? 'Verified from Apple WeatherKit' : 'Legacy Vane snapshot';

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
    *{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 16% 3%,rgba(72,155,247,.30),transparent 29rem),radial-gradient(circle at 93% 22%,rgba(153,211,255,.14),transparent 26rem),linear-gradient(155deg,#071421 0%,#0b2238 54%,#12385b 100%);color:#f8fbff}
    main{width:min(92vw,780px);margin:0 auto;padding:34px 0 58px}.brand{display:flex;align-items:center;gap:10px;margin:0 4px 22px;font-weight:720;letter-spacing:-.02em}.brand img{width:34px;height:34px;object-fit:contain}
    .icon{width:20px;height:20px;display:block}.mini-icon{width:14px;height:14px;display:block;flex:0 0 auto}.card{border:1px solid rgba(255,255,255,.16);border-radius:32px;background:linear-gradient(180deg,rgba(255,255,255,.12),rgba(255,255,255,.065));box-shadow:0 28px 88px rgba(0,0,0,.25);backdrop-filter:blur(28px) saturate(135%);-webkit-backdrop-filter:blur(28px) saturate(135%)}
    .hero{padding:30px}.topline{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.eyebrow{font-size:12px;font-weight:760;letter-spacing:.09em;text-transform:uppercase;color:rgba(230,241,252,.68)}.status{display:inline-flex;align-items:center;gap:7px;padding:8px 11px;border:1px solid rgba(255,255,255,.15);border-radius:999px;background:rgba(255,255,255,.07);font-size:12px;font-weight:700}.status-dot{width:7px;height:7px;border-radius:50%;background:${active ? '#78c7ff' : '#a9b4c1'}}
    h1{margin:22px 0 0;font-size:clamp(36px,8vw,60px);line-height:1.01;letter-spacing:-.048em}.agency{margin:16px 0 0;font-size:16px;line-height:1.55;color:rgba(235,244,253,.74)}.agency strong{color:#fff}.integrity{display:inline-flex;align-items:center;gap:8px;margin-top:18px;padding:9px 12px;border-radius:999px;background:${verified ? 'rgba(105,195,255,.11)' : 'rgba(255,198,102,.10)'};border:1px solid ${verified ? 'rgba(133,207,255,.18)' : 'rgba(255,205,120,.18)'};color:${verified ? '#c8e8ff' : '#f3d7a5'};font-size:12px;font-weight:700}.integrity .icon{width:16px;height:16px}
    .facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;margin-top:15px;overflow:hidden}.fact{display:flex;align-items:flex-start;gap:13px;padding:18px 20px;background:rgba(255,255,255,.058)}.fact-icon,.section-icon{display:grid;place-items:center;flex:0 0 auto;width:40px;height:40px;border-radius:13px;background:rgba(131,201,255,.10);border:1px solid rgba(151,211,255,.13);color:#c4e6ff}.fact-copy{min-width:0}.fact-label,.section-kicker{font-size:11px;font-weight:740;letter-spacing:.07em;text-transform:uppercase;color:rgba(224,238,252,.52)}.fact-value{margin-top:5px;font-size:15px;font-weight:650;line-height:1.4;overflow-wrap:anywhere}
    .content-card{margin-top:15px;padding:24px}.section-head{display:flex;align-items:center;gap:14px}.section-head h2{margin:5px 0 0;font-size:21px;letter-spacing:-.025em}.section-icon{width:44px;height:44px;border-radius:14px}.section-icon .icon{width:22px;height:22px}.action-icon{background:rgba(113,205,255,.12);color:#cbeaff}.content-card p{margin:14px 0 0;color:rgba(235,244,253,.68);line-height:1.58}.action-list{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}.action-pill{display:flex;align-items:center;gap:7px;padding:9px 12px;border-radius:999px;background:rgba(255,255,255,.075);border:1px solid rgba(255,255,255,.12);font-size:13px;font-weight:650}.message{margin:18px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;color:rgba(244,249,255,.86);font-size:15px;line-height:1.68}.message-card .section-icon{background:rgba(183,157,255,.10);color:#ded0ff}.guidance .section-icon{background:rgba(122,211,182,.10);color:#c4f1e2}
    .actions{display:grid;gap:10px;margin-top:18px}.button{min-height:56px;border-radius:18px;display:flex;align-items:center;justify-content:center;gap:9px;padding:0 18px;text-decoration:none;font-weight:720;letter-spacing:-.01em}.button .icon{width:18px;height:18px}.button-logo{display:block;width:27px;height:18px;object-fit:contain;flex:0 0 auto}.primary{color:#061321;background:linear-gradient(135deg,#f8fbff,#b8dcff);box-shadow:inset 0 1px 0 rgba(255,255,255,.8),0 14px 34px rgba(48,139,238,.18)}.secondary{color:#f5f9ff;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.065)}
    .source-note{margin:15px 4px 0;color:rgba(224,238,252,.48);font-size:12px;line-height:1.55}.code{font-variant-numeric:tabular-nums;font-weight:700}.legacy-warning{margin-top:15px;padding:18px 20px;border-radius:24px;border:1px solid rgba(255,205,120,.15);background:rgba(255,196,92,.06);color:rgba(245,225,188,.76);font-size:13px;line-height:1.55}
    @media(max-width:560px){main{padding:20px 0 40px}.hero{padding:23px}.card{border-radius:27px}.facts{grid-template-columns:1fr}.content-card{padding:21px}h1{font-size:clamp(34px,11vw,49px)}.fact-icon{width:37px;height:37px;border-radius:12px}}
  </style>
</head>
<body>
  <main>
    <div class="brand"><img src="/assets/vane-logo.png" alt="" /><span>Vane</span></div>

    <section class="card hero">
      <div class="topline"><div class="eyebrow">${verified ? 'Official weather alert' : 'Weather alert snapshot'}</div><div class="status"><span class="status-dot"></span>${statusText}</div></div>
      <h1>${esc(summary)}</h1>
      <p class="agency">${verified ? `Official alert issued by <strong>${esc(source)}</strong>${region ? ` for ${esc(region)}` : ''}.` : 'This alert information was saved by an older version of Vane. Use the official source below for authoritative details and updates.'}</p>
      <div class="integrity">${icon(verified ? 'shield' : 'severity')}<span>${esc(integrityLabel)}</span></div>
    </section>

    <section class="card facts" aria-label="Alert details">
      ${region ? fact('Area', region, 'location') : ''}
      ${fact('Severity', severity, 'severity')}
      ${certainty ? fact('Certainty', certainty, 'certainty') : ''}
      ${urgency ? fact('Urgency', urgency, 'urgency') : ''}
      ${issuedAt ? fact('Issued', issuedAt, 'calendar', true) : ''}
      ${effectiveAt && effectiveAt !== issuedAt ? fact('Effective', effectiveAt, 'clock', true) : ''}
      ${onsetAt ? fact('Event onset', onsetAt, 'onset', true) : ''}
      ${eventEndAt ? fact('Expected event end', eventEndAt, 'hourglass', true) : ''}
      ${expiresAt ? fact(active ? 'Alert valid until' : 'Alert expired', expiresAt, 'clock', true) : ''}
    </section>

    ${verified ? responseCards(record) : ''}

    ${message ? `<section class="card content-card message-card"><div class="section-head"><div class="section-icon">${icon('message')}</div><div><div class="section-kicker">Official agency message</div><h2>Full alert description</h2></div></div><div class="message">${esc(message)}</div></section>` : ''}

    ${!verified ? `<div class="legacy-warning"><strong>Legacy snapshot:</strong> Vane cannot independently verify the saved title, severity, area, or timing for this older link. Newly shared alerts are rebuilt directly from Apple WeatherKit on Vane’s server.</div>` : ''}

    <section class="card content-card guidance">
      <div class="section-head"><div class="section-icon">${icon('source')}</div><div><div class="section-kicker">Source of truth</div><h2>Check the issuing agency’s current alert</h2></div></div>
      <p>${verified ? 'Vane displays the official alert data returned by Apple WeatherKit. The issuing agency’s source remains authoritative for live changes and safety instructions.' : 'Open the official Apple Weather alert before making safety decisions.'}</p>
      <div class="actions">
        <a class="button primary" href="${esc(officialURL)}" rel="noopener noreferrer">${icon('external')}<span>View official alert source</span></a>
        <a class="button secondary" href="https://vane.codearc.studio/"><img class="button-logo" src="/assets/vane-logo.png" alt="" /><span>About Vane</span></a>
      </div>
    </section>

    <p class="source-note">Shared from Vane · <span class="code">${esc(code)}</span>${verifiedAt ? ` · Verified <span class="local-time" data-date="${esc(verifiedAt)}">${esc(new Date(verifiedAt).toUTCString())}</span>` : ''}.</p>
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="#081725"><title>Alert unavailable · Vane</title><meta property="og:title" content="Alert unavailable · Vane"><meta property="og:description" content="This shared weather alert is unavailable."><meta name="twitter:card" content="summary"><link rel="icon" href="/favicon.png"><style>:root{color-scheme:dark;font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;background:#081725;color:#fff}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:linear-gradient(145deg,#071421,#12385b)}main{width:min(90vw,520px);padding:28px}.card{padding:28px;border:1px solid rgba(255,255,255,.16);border-radius:30px;background:rgba(255,255,255,.08);backdrop-filter:blur(24px)}h1{margin:0;font-size:36px;letter-spacing:-.04em}p{color:rgba(255,255,255,.65);line-height:1.5}a{display:flex;min-height:54px;align-items:center;justify-content:center;margin-top:20px;border-radius:17px;background:#f5f9ff;color:#071421;text-decoration:none;font-weight:700}</style></head><body><main><section class="card"><h1>Alert unavailable.</h1><p>${code ? `The shared code ${esc(code)} is invalid or no longer available.` : 'This shared alert link is invalid or no longer available.'}</p><a href="https://vane.codearc.studio/">Go to Vane</a></section></main></body></html>`;
}

export default async function handler(request, response) {
  const code = String(request.query?.id ?? '').trim().toUpperCase();
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');

  if (!CODE_PATTERN.test(code) || !blobConfigured()) {
    response.status(404).send(invalidPage(code));
    return;
  }

  try {
    const storedRecord = await readRecord(code);
    const record = storedRecord ? await upgradeLegacyRecord(code, storedRecord) : null;
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
