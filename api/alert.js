import { del, get, list, put } from '@vercel/blob';
import { randomBytes } from 'node:crypto';
import {
  fetchOfficialAlert,
  normalizeLanguage,
  WEATHERKIT_UUID_PATTERN,
  weatherKitConfigured,
} from '../lib/weatherkit-alert.js';

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LENGTH = 6;
const MAX_ATTEMPTS = 8;
const CODE_PATTERN = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5,7}$/;
const DEFAULT_RETENTION_DAYS = 30;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CLEANUP_MARKER_PATH = 'maintenance/alert-cleanup.json';

function alertRetentionDays() {
  const raw = String(process.env.ALERT_RETENTION_DAYS ?? '').trim();
  if (!raw) return DEFAULT_RETENTION_DAYS;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return DEFAULT_RETENTION_DAYS;
  if (value <= 0) return 0;
  return Math.min(value, 3650);
}

function blobConfigured() {
  // Vercel Blob supports both the legacy static read/write token and the
  // current OIDC connection model. New Vercel projects typically expose
  // BLOB_STORE_ID and authenticate Functions with a short-lived OIDC token.
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

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

function cleanISODate(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function exactBlob(pathname) {
  const result = await list({ prefix: pathname, limit: 2 });
  return result.blobs.find((blob) => blob.pathname === pathname) ?? null;
}

async function readJSON(blob) {
  const result = await get(blob.url, { access: 'private' });
  if (!result) throw new Error('Private Blob read failed');
  return JSON.parse(await new Response(result.stream).text());
}

async function readMapping(code) {
  const blob = await exactBlob(`alerts/${code}.json`);
  if (!blob) return null;
  const record = await readJSON(blob);
  return WEATHERKIT_UUID_PATTERN.test(record?.alertID ?? '') ? record : null;
}

function retentionEndDate(record) {
  const candidate = cleanISODate(record?.expiresAt) ?? cleanISODate(record?.eventEndAt);
  return candidate ? new Date(candidate) : null;
}

async function cleanupExpiredAlertsIfDue() {
  const retentionDays = alertRetentionDays();
  if (!blobConfigured() || retentionDays === 0) return;

  const markerBlob = await exactBlob(CLEANUP_MARKER_PATH);
  if (markerBlob) {
    try {
      const marker = await readJSON(markerBlob);
      const lastAttempt = cleanISODate(marker?.lastAttemptAt);
      if (lastAttempt && Date.now() - new Date(lastAttempt).getTime() < CLEANUP_INTERVAL_MS) {
        return;
      }
    } catch (_) {
      // A malformed maintenance marker should never block cleanup.
    }
  }

  // Write the marker before scanning so concurrent share requests do not all
  // perform the same maintenance pass.
  await put(CLEANUP_MARKER_PATH, JSON.stringify({
    lastAttemptAt: new Date().toISOString(),
    retentionDays,
  }), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });

  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let cursor;

  do {
    const page = await list({
      prefix: 'alerts/',
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });

    for (let offset = 0; offset < page.blobs.length; offset += 12) {
      const batch = page.blobs.slice(offset, offset + 12);
      await Promise.all(batch.map(async (blob) => {
        try {
          const record = await readJSON(blob);
          const endDate = retentionEndDate(record);
          if (!endDate || endDate.getTime() > cutoff) return;

          const deletes = [blob.url];
          const alertID = String(record?.alertID ?? '').trim().toLowerCase();
          if (WEATHERKIT_UUID_PATTERN.test(alertID)) {
            const indexBlob = await exactBlob(`alert-ids/${alertID}.json`);
            if (indexBlob) deletes.push(indexBlob.url);
          }
          await del(deletes);
        } catch (error) {
          console.warn('Vane alert cleanup skipped a record:', blob.pathname, error);
        }
      }));
    }

    cursor = page.hasMore && page.cursor ? page.cursor : undefined;
  } while (cursor);
}

async function findExistingMapping(alertID) {
  const indexBlob = await exactBlob(`alert-ids/${alertID}.json`);
  if (!indexBlob) return null;

  const index = await readJSON(indexBlob);
  const code = String(index?.code ?? '').toUpperCase();
  if (!CODE_PATTERN.test(code)) return null;

  const record = await readMapping(code);
  if (!record || String(record.alertID).toLowerCase() !== alertID.toLowerCase()) return null;
  return { code, record };
}

async function writeMapping(code, record, createdAt = null) {
  const payload = JSON.stringify({
    ...record,
    code,
    createdAt: createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  await put(`alerts/${code}.json`, payload, {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });
}

async function createOrUpdateMapping(record) {
  const existing = await findExistingMapping(record.alertID);
  if (existing) {
    await writeMapping(existing.code, record, cleanISODate(existing.record?.createdAt));
    return existing.code;
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const code = randomCode();
    const mappingPath = `alerts/${code}.json`;
    if (await exactBlob(mappingPath)) continue;

    try {
      await writeMapping(code, record);
      await put(`alert-ids/${record.alertID}.json`, JSON.stringify({ code }), {
        access: 'private',
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

function publicAlert(record, { code = null, stale = false } = {}) {
  return {
    ...(code ? { code } : {}),
    alertID: record.alertID,
    summary: record.summary ?? 'Official weather alert',
    severity: record.severity ?? 'unknown',
    region: record.region ?? null,
    source: record.source ?? 'Official weather agency',
    countryCode: record.countryCode ?? null,
    certainty: record.certainty ?? 'unknown',
    urgency: record.urgency ?? 'unknown',
    responses: Array.isArray(record.responses) ? record.responses : [],
    issuedAt: record.issuedAt ?? null,
    effectiveAt: record.effectiveAt ?? null,
    onsetAt: record.onsetAt ?? null,
    eventEndAt: record.eventEndAt ?? null,
    expiresAt: record.expiresAt ?? null,
    messages: Array.isArray(record.messages) ? record.messages : [],
    detailsURL: record.detailsURL ?? null,
    attributionURL: record.attributionURL ?? null,
    language: record.language ?? 'en-US',
    verified: record.verified === true,
    verificationSource: record.verificationSource ?? null,
    verifiedAt: record.verifiedAt ?? null,
    stale,
  };
}

function weatherKitSetupError(response) {
  sendJSON(response, 503, {
    error: 'Official alert verification is not configured yet.',
    setup: 'Set WEATHERKIT_TEAM_ID, WEATHERKIT_KEY_ID, WEATHERKIT_SERVICE_ID, and WEATHERKIT_PRIVATE_KEY in Vercel.',
  });
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

  try {
    if (request.method === 'POST') {
      if (!blobConfigured()) {
        sendJSON(response, 503, {
          error: 'Short alert links are not configured yet.',
          setup: 'Connect a private Vercel Blob store to this project (OIDC/BLOB_STORE_ID or BLOB_READ_WRITE_TOKEN).',
        });
        return;
      }
      if (!weatherKitConfigured()) {
        weatherKitSetupError(response);
        return;
      }

      // Intentionally accept only identity/localization from the client. Older Vane
      // builds may still send summary/severity/source/etc.; those fields are ignored.
      const alertID = String(request.body?.alertID ?? '').trim().toLowerCase();
      const language = normalizeLanguage(request.body?.language);
      if (!WEATHERKIT_UUID_PATTERN.test(alertID)) {
        sendJSON(response, 400, { error: 'Invalid Apple Weather alert ID.' });
        return;
      }

      const existing = await findExistingMapping(alertID);
      let official;
      try {
        official = await fetchOfficialAlert(alertID, language);
      } catch (error) {
        // Never let a failed/unavailable refresh overwrite a previously verified snapshot.
        if (existing?.record?.verified === true) {
          sendJSON(response, 200, {
            code: existing.code,
            url: `https://vane.codearc.studio/a/${existing.code}`,
            alert: publicAlert(existing.record, { code: existing.code, stale: true }),
          });
          return;
        }
        throw error;
      }

      const code = await createOrUpdateMapping(official);
      try {
        await cleanupExpiredAlertsIfDue();
      } catch (cleanupError) {
        console.warn('Vane alert cleanup failed:', cleanupError);
      }
      sendJSON(response, 200, {
        code,
        url: `https://vane.codearc.studio/a/${code}`,
        alert: publicAlert(official, { code }),
      });
      return;
    }

    if (request.method === 'GET') {
      const requestedAlertID = String(request.query?.alertID ?? '').trim().toLowerCase();
      if (requestedAlertID) {
        if (!WEATHERKIT_UUID_PATTERN.test(requestedAlertID)) {
          sendJSON(response, 400, { error: 'Invalid Apple Weather alert ID.' });
          return;
        }
        if (!weatherKitConfigured()) {
          weatherKitSetupError(response);
          return;
        }

        const language = normalizeLanguage(request.query?.lang);
        const existing = blobConfigured()
          ? await findExistingMapping(requestedAlertID)
          : null;

        try {
          const official = await fetchOfficialAlert(requestedAlertID, language);
          if (existing && blobConfigured()) {
            await writeMapping(existing.code, official, cleanISODate(existing.record?.createdAt));
          }
          sendJSON(response, 200, publicAlert(official, { code: existing?.code ?? null }));
        } catch (error) {
          if (existing?.record?.verified === true) {
            sendJSON(response, 200, publicAlert(existing.record, { code: existing.code, stale: true }));
            return;
          }
          throw error;
        }
        return;
      }

      if (!blobConfigured()) {
        sendJSON(response, 503, { error: 'Shared alert storage is unavailable.' });
        return;
      }

      const code = String(request.query?.id ?? '').trim().toUpperCase();
      if (!CODE_PATTERN.test(code)) {
        sendJSON(response, 400, { error: 'Invalid alert code.' });
        return;
      }

      const mapping = await readMapping(code);
      if (!mapping) {
        sendJSON(response, 404, { error: 'Alert code not found.' });
        return;
      }

      sendJSON(response, 200, publicAlert(mapping, { code }));
      return;
    }

    response.setHeader('Allow', 'GET, POST, OPTIONS');
    sendJSON(response, 405, { error: 'Method not allowed.' });
  } catch (error) {
    console.error('Vane official alert API error:', error);
    const status = Number(error?.statusCode);
    if (status === 404 || status === 410) {
      sendJSON(response, 404, { error: 'This official alert is no longer available from Apple Weather.' });
      return;
    }
    if (status === 401 || status === 403) {
      sendJSON(response, 502, { error: 'Apple Weather rejected the server alert request. Check the WeatherKit server credentials.' });
      return;
    }
    sendJSON(response, 502, { error: 'Could not verify this official alert with Apple Weather.' });
  }
}
