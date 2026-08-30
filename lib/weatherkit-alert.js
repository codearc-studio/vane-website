import { createPrivateKey, sign } from 'node:crypto';

export const WEATHERKIT_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LANGUAGE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const SEVERITIES = new Set(['extreme', 'severe', 'moderate', 'minor', 'unknown']);
const CERTAINTIES = new Set(['observed', 'likely', 'possible', 'unlikely', 'unknown']);
const URGENCIES = new Set(['immediate', 'expected', 'future', 'past', 'unknown']);
const RESPONSES = new Set(['shelter', 'evacuate', 'prepare', 'execute', 'avoid', 'monitor', 'assess', 'allClear', 'none']);
const MAX_TITLE = 240;
const MAX_REGION = 500;
const MAX_SOURCE = 300;
const MAX_MESSAGE = 80_000;
const MAX_MESSAGES = 8;
const TOKEN_LIFETIME_SECONDS = 50 * 60;

let cachedToken = null;
let cachedTokenExpiresAt = 0;

function env(name) {
  return String(process.env[name] ?? '').trim();
}

export function weatherKitConfigured() {
  return Boolean(
    env('WEATHERKIT_TEAM_ID') &&
    env('WEATHERKIT_KEY_ID') &&
    env('WEATHERKIT_SERVICE_ID') &&
    env('WEATHERKIT_PRIVATE_KEY')
  );
}

function base64url(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  return buffer.toString('base64url');
}

function weatherKitToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedTokenExpiresAt - now > 60) return cachedToken;

  const teamID = env('WEATHERKIT_TEAM_ID');
  const keyID = env('WEATHERKIT_KEY_ID');
  const serviceID = env('WEATHERKIT_SERVICE_ID');
  const privateKeyValue = env('WEATHERKIT_PRIVATE_KEY');
  if (!teamID || !keyID || !serviceID || !privateKeyValue) {
    throw new Error('WeatherKit server credentials are not configured');
  }

  const header = {
    alg: 'ES256',
    kid: keyID,
    id: `${teamID}.${serviceID}`,
  };
  const claims = {
    iss: teamID,
    iat: now - 5,
    exp: now + TOKEN_LIFETIME_SECONDS,
    sub: serviceID,
  };

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const key = createPrivateKey(privateKeyValue.replace(/\\n/g, '\n'));
  const signature = sign('sha256', Buffer.from(signingInput), {
    key,
    dsaEncoding: 'ieee-p1363',
  });

  cachedToken = `${signingInput}.${base64url(signature)}`;
  cachedTokenExpiresAt = claims.exp;
  return cachedToken;
}

export function normalizeLanguage(value) {
  const candidate = String(value ?? '').trim().replaceAll('_', '-');
  return LANGUAGE_PATTERN.test(candidate) ? candidate : 'en-US';
}

function cleanInline(value, maxLength, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, maxLength) : fallback;
}

function cleanDate(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function enumValue(value, allowed, fallback = 'unknown') {
  const candidate = String(value ?? '').trim();
  return allowed.has(candidate) ? candidate : fallback;
}

function cleanHTTPSURL(value) {
  try {
    const url = new URL(String(value ?? ''));
    return url.protocol === 'https:' ? url.toString() : null;
  } catch (_) {
    return null;
  }
}

export function cleanAgencyMessage(value) {
  if (typeof value !== 'string') return '';
  const lines = value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();

      // WeatherKit alert text can contain markdown-style separators/headings.
      // Vane renders official agency copy as plain text, so remove formatting
      // markers without changing the wording itself.
      if (/^#{1,6}$/.test(trimmed) || /^\*{3,}$/.test(trimmed) || /^_{3,}$/.test(trimmed)) {
        return '';
      }
      return line.replace(/^\s*#{1,6}\s+/, '');
    });

  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_MESSAGE);
}

function cleanMessages(raw, language) {
  const candidates = Array.isArray(raw?.messages)
    ? raw.messages
    : Array.isArray(raw?.eventText)
      ? raw.eventText
      : [];

  const messages = [];
  for (const message of candidates.slice(0, MAX_MESSAGES)) {
    const textValue = typeof message === 'string' ? message : message?.text;
    if (typeof textValue !== 'string') continue;
    const text = cleanAgencyMessage(textValue);
    if (!text) continue;
    messages.push({
      language: normalizeLanguage(typeof message === 'string' ? language : message?.language ?? language),
      text,
    });
  }
  return messages;
}

function regionFromAlert(raw) {
  const direct = cleanInline(raw?.areaName, MAX_REGION);
  if (direct) return direct;

  const area = raw?.area;
  if (!area || typeof area !== 'object') return null;
  return cleanInline(area.name ?? area.areaName ?? area.description, MAX_REGION) || null;
}

function responseValues(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item ?? '').trim()).filter((item) => RESPONSES.has(item)))];
}

export function fallbackOfficialAlertURL(alertID, language = 'en-US') {
  const url = new URL('https://weatherkit.apple.com/alertDetails/index.html');
  url.searchParams.set('ids', alertID);
  url.searchParams.set('lang', normalizeLanguage(language));
  return url.toString();
}

export function normalizeWeatherKitAlert(payload, expectedAlertID, language = 'en-US') {
  const raw = payload?.weatherAlert && typeof payload.weatherAlert === 'object'
    ? payload.weatherAlert
    : payload;
  if (!raw || typeof raw !== 'object') throw new Error('WeatherKit returned an invalid alert payload');

  const expected = String(expectedAlertID ?? '').trim().toLowerCase();
  const returnedID = String(raw.id ?? expected).trim().toLowerCase();
  if (!WEATHERKIT_UUID_PATTERN.test(expected) || returnedID !== expected) {
    throw new Error('WeatherKit alert ID did not match the requested alert');
  }

  const normalizedLanguage = normalizeLanguage(language);
  const description = cleanInline(raw.description ?? raw.summary, MAX_TITLE, 'Official weather alert');
  const source = cleanInline(raw.source, MAX_SOURCE, 'Official weather agency');
  const region = regionFromAlert(raw);
  const severity = enumValue(raw.severity, SEVERITIES);
  const certainty = enumValue(raw.certainty, CERTAINTIES);
  const urgency = enumValue(raw.urgency, URGENCIES);
  const responses = responseValues(raw.responses);
  const messages = cleanMessages(raw, normalizedLanguage);
  const detailsURL = cleanHTTPSURL(raw.detailsUrl ?? raw.detailsURL) ?? fallbackOfficialAlertURL(expected, normalizedLanguage);
  const attributionURL = cleanHTTPSURL(raw.attributionURL ?? raw.attributionUrl);

  return {
    alertID: expected,
    summary: description,
    severity,
    region,
    source,
    countryCode: cleanInline(raw.countryCode, 8) || null,
    certainty,
    urgency,
    responses,
    issuedAt: cleanDate(raw.issuedTime ?? raw.issuedAt),
    effectiveAt: cleanDate(raw.effectiveTime ?? raw.effectiveAt),
    onsetAt: cleanDate(raw.eventOnsetTime ?? raw.eventOnSetTime ?? raw.onsetTime),
    eventEndAt: cleanDate(raw.eventEndTime ?? raw.endTime),
    expiresAt: cleanDate(raw.expireTime ?? raw.expiresAt),
    messages,
    detailsURL,
    attributionURL,
    language: normalizedLanguage,
    verified: true,
    verificationSource: 'weatherkit-rest',
    verifiedAt: new Date().toISOString(),
  };
}

export async function fetchOfficialAlert(alertID, language = 'en-US') {
  const normalizedID = String(alertID ?? '').trim().toLowerCase();
  if (!WEATHERKIT_UUID_PATTERN.test(normalizedID)) throw new Error('Invalid WeatherKit alert ID');
  if (!weatherKitConfigured()) throw new Error('WeatherKit server credentials are not configured');

  const normalizedLanguage = normalizeLanguage(language);
  const url = new URL(`https://weatherkit.apple.com/api/v1/weatherAlert/${encodeURIComponent(normalizedLanguage)}/${encodeURIComponent(normalizedID)}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${weatherKitToken()}`,
      },
      signal: controller.signal,
      cache: 'no-store',
    });

    if (!response.ok) {
      const body = (await response.text()).slice(0, 500);
      const error = new Error(`WeatherKit alert request failed with ${response.status}${body ? `: ${body}` : ''}`);
      error.statusCode = response.status;
      throw error;
    }

    return normalizeWeatherKitAlert(await response.json(), normalizedID, normalizedLanguage);
  } finally {
    clearTimeout(timer);
  }
}
