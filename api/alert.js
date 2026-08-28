import { list, put } from '@vercel/blob';
import { randomBytes } from 'node:crypto';

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LENGTH = 6;
const MAX_ATTEMPTS = 8;
const CODE_PATTERN = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5,7}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

async function createMapping(alertID) {
  const existing = await findExistingCode(alertID);
  if (existing) return existing;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const code = randomCode();
    const mappingPath = `alerts/${code}.json`;

    if (await exactBlob(mappingPath)) continue;

    const payload = JSON.stringify({
      alertID,
      createdAt: new Date().toISOString(),
    });

    try {
      await put(mappingPath, payload, {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: false,
      });

      await put(`alert-ids/${alertID}.json`, JSON.stringify({ code }), {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true,
      });

      return code;
    } catch (error) {
      // A simultaneous request may have claimed the same short code.
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
      setup: 'Connect a Vercel Blob store to this project so BLOB_READ_WRITE_TOKEN is available.',
    });
    return;
  }

  try {
    if (request.method === 'POST') {
      const alertID = String(request.body?.alertID ?? '').trim().toLowerCase();
      if (!UUID_PATTERN.test(alertID)) {
        sendJSON(response, 400, { error: 'Invalid Apple Weather alert ID.' });
        return;
      }

      const code = await createMapping(alertID);
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
