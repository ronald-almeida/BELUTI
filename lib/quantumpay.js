const baseUrl = 'https://api.quantumpay.com.br';
let cache;
let pendingAuth;

export function quantumConfigured() {
  return Boolean(process.env.QUANTUMPAY_API_KEY && process.env.QUANTUMPAY_API_SECRET);
}

async function authenticate() {
  const credentials = Buffer.from(process.env.QUANTUMPAY_API_KEY.trim() + ':' + process.env.QUANTUMPAY_API_SECRET.trim()).toString('base64');
  const response = await fetch(baseUrl + '/auth', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + credentials },
    redirect: 'error',
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    const reason = String(error?.message || error?.error || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    let kind = 'unspecified';
    if (/ip|whitelist/.test(reason)) kind = 'network restriction';
    else if (/bloque|suspend|inativ|disabled|blocked/.test(reason)) kind = 'access blocked';
    else if (/credenc|credential|api.?key|secret|chave/.test(reason)) kind = 'credentials';
    throw new Error('QuantumPay auth HTTP ' + response.status + ' (' + kind + ')');
  }
  const result = await response.json();
  if (result.success !== true || typeof result.token !== 'string' || !result.token) throw new Error('Invalid access token');
  cache = {
    token: result.token,
    until: Date.now() + Math.min(1800000, Number(result.expiresIn) || 1800000) - 60000
  };
  return cache.token;
}

export async function quantumToken() {
  if (cache && cache.until > Date.now()) return cache.token;
  pendingAuth ??= authenticate().finally(() => { pendingAuth = undefined; });
  return pendingAuth;
}

export async function quantumRequest(token, path, options = {}) {
  const response = await fetch(baseUrl + path, {
    ...options,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(35000)
  });
  if (response.status === 401 && cache?.token === token) cache = undefined;
  return response;
}
