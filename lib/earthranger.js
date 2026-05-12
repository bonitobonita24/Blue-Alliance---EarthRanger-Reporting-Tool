const DEFAULT_TIMEOUT_MS = Number(process.env.ER_TIMEOUT_MS || 30000);

function getBaseUrl() {
  const raw = (process.env.ER_BASE_URL || '').trim().replace(/\/$/, '');
  if (!raw) throw new Error('Missing required environment variable: ER_BASE_URL');
  return raw.endsWith('/api/v1.0') ? raw : `${raw}/api/v1.0`;
}

function getAuthHeader() {
  const bearer = process.env.ER_TOKEN || process.env.ER_TRACK_TOKEN || process.env.DAS_WEB_TOKEN;

  if (bearer) return `Bearer ${bearer}`;

  const username = process.env.ER_USERNAME;
  const password = process.env.ER_PASSWORD;
  if (username && password) {
    return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  }

  throw new Error('Missing auth. Set ER_TOKEN (or ER_TRACK_TOKEN / DAS_WEB_TOKEN), or ER_USERNAME + ER_PASSWORD.');
}

async function erFetch(path, { method = 'GET', query = {}, body } = {}) {
  const url = new URL(`${getBaseUrl()}${path}`);

  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: getAuthHeader(),
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(`EarthRanger request failed (${response.status}): ${payload?.detail || JSON.stringify(payload)}`);
    }

    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

export async function testConnection() {
  return erFetch('/subjects/', { query: { page_size: 1 } });
}

export async function getPatrols(params = {}) {
  return erFetch('/activity/patrols/', { query: params });
}

export async function createPatrol(payload) {
  return erFetch('/activity/patrols/', { method: 'POST', body: payload });
}

export async function updatePatrol(patrolId, payload) {
  return erFetch(`/activity/patrols/${patrolId}/`, { method: 'PATCH', body: payload });
}

export async function getEvents(params = {}) {
  return erFetch('/activity/events/', { query: params });
}
