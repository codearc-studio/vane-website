import { list, put } from '@vercel/blob';
import { randomBytes } from 'node:crypto';

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LENGTH = 6;
const MAX_ATTEMPTS = 8;
const CODE_PATTERN = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5,7}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TEXT = 220;

function sendJSON(response, status, payload) {
  response.status(status);
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Access-Control-Allow-Origin', 'https://vane.codearc.studio');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.json(payload);
}

function randomCode() {
  const bytes = randomBytes(CODE_LENGTH);
  let code = '';
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    code += ALPHABET[bytes[index] % ALPHABET.length];
  }
  return code;
}

function cleanText(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
}

function cleanOptionalText(value) {
  const cleaned = cleanText(value);
  return cleaned || null;
}

function cleanISODate(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function cleanOfficialURL(value, alertID) {
  try {
    const url = new URL(String(value ?? ''));
    if (url.protocol !== 'https:' || url.hostname !== 'weatherkit.apple.com') return null;
    const ids = url.searchParams.get('ids') ?? '';
    const normalizedIDs = ids.split(',').map((item) => item.trim().toLowerCase());
    if (!normalizedIDs.includes(alertID.toLowerCase())) return null;
    return url.toString();
  } catch (_) {
    return null;
  }
}

function recordFromBody(body) {
  const alertID = String(body?.alertID ?? '').trim().toLowerCase();
  if (!UUID_PATTERN.test(alertID)) return null;

  const detailsURL = cleanOfficialURL(body?.detailsURL, alertID);
  if (!detailsURL) return null;

  return {
    alertID,
    summary: cleanText(body?.summary, 'Official weather alert'),
    severity: cleanText(body?.severity, 'Official'),
    region: cleanOptionalText(body?.region),
    source: cleanText(body?.source, 'Official weather agency'),
    issuedAt: cleanISODate(body?.issuedAt),
    expiresAt: cleanISODate(body?.expiresAt),
    detailsURL,
  };
}

async function exactBlob(pathname) {
  const result = await list({ prefix: pathname, limit: 2 });
  return result.blobs.find((blob) => blob.pathname === pathname) ?? null;
}

async function readJSON(blob) {
  const result = await fetch(blob.url, { cache: 'no-store' });
  if (!result.ok) throw new Error(`Blob read failed with ${result.status}`);
  return result.json();
}

async function findExistingCode(alertID) {
  const indexPath = `alert-ids/${alertID}.json`;
  const indexBlob = await exactBlob(indexPath);
  if (!indexBlob) return null;

  const index = await readJSON(indexBlob);
  if (!CODE_PATTERN.test(index?.code ?? '')) return null;

  const mappingBlob = await exactBlob(`alerts/${index.code}.json`);
  if (!mappingBlob) return null;

  const mapping = await readJSON(mappingBlob);
  return mapping?.alertID === alertID ? index.code : null;
}

async function writeMapping(code, record, createdAt = null) {
  const payload = JSON.stringify({
    ...record,
    code,
    createdAt: createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  await put(`alerts/${code}.json`, payload, {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });
}

async function createOrUpdateMapping(record) {
  const existing = await findExistingCode(record.alertID);
  if (existing) {
    let createdAt = null;
    const oldBlob = await exactBlob(`alerts/${existing}.json`);
    if (oldBlob) {
      try {
        const old = await readJSON(oldBlob);
        createdAt = cleanISODate(old?.createdAt);
      } catch (_) {}
    }
    await writeMapping(existing, record, createdAt);
    return existing;
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const code = randomCode();
    const mappingPath = `alerts/${code}.json`;
    if (await exactBlob(mappingPath)) continue;

    try {
      await writeMapping(code, record);
      await put(`alert-ids/${record.alertID}.json`, JSON.stringify({ code }), {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
      });
      return code;
    } catch (error) {
      if (attempt === MAX_ATTEMPTS - 1) throw error;
    }
  }

  throw new Error('Could not allocate a short alert code');
}

export default async function handler(request, response) {
  if (request.method === 'OPTIONS') {
    response.status(204);
    response.setHeader('Access-Control-Allow-Origin', 'https://vane.codearc.studio');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.end();
    return;
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    sendJSON(response, 503, {
      error: 'Short alert links are not configured yet.',
      setup: 'Connect a public Vercel Blob store to this project so BLOB_READ_WRITE_TOKEN is available.',
    });
    return;
  }

  try {
    if (request.method === 'POST') {
      const record = recordFromBody(request.body);
      if (!record) {
        sendJSON(response, 400, { error: 'Invalid Apple Weather alert data.' });
        return;
      }

      const code = await createOrUpdateMapping(record);
      sendJSON(response, 200, {
        code,
        url: `https://vane.codearc.studio/a/${code}`,
      });
      return;
    }

    if (request.method === 'GET') {
      const code = String(request.query?.id ?? '').trim().toUpperCase();
      if (!CODE_PATTERN.test(code)) {
        sendJSON(response, 400, { error: 'Invalid alert code.' });
        return;
      }

      const blob = await exactBlob(`alerts/${code}.json`);
      if (!blob) {
        sendJSON(response, 404, { error: 'Alert code not found.' });
        return;
      }

      const mapping = await readJSON(blob);
      if (!UUID_PATTERN.test(mapping?.alertID ?? '')) {
        sendJSON(response, 404, { error: 'Alert mapping is unavailable.' });
        return;
      }

      sendJSON(response, 200, {
        code,
        alertID: mapping.alertID,
        summary: mapping.summary ?? 'Official weather alert',
        severity: mapping.severity ?? 'Official',
        region: mapping.region ?? null,
        source: mapping.source ?? 'Official weather agency',
        issuedAt: mapping.issuedAt ?? null,
        expiresAt: mapping.expiresAt ?? null,
        detailsURL: mapping.detailsURL ?? null,
      });
      return;
    }

    response.setHeader('Allow', 'GET, POST, OPTIONS');
    sendJSON(response, 405, { error: 'Method not allowed.' });
  } catch (error) {
    console.error('Vane alert short-link error:', error);
    sendJSON(response, 500, { error: 'Could not create or open this alert link.' });
  }
}
