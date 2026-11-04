import { createHmac, timingSafeEqual } from 'node:crypto';
export const AMOUNT = 34790;
export const PRODUCT = 'Black Friday da Monique';
export const API_BASE = 'https://api.blackcatoficial.com/api';
export const digits = value => String(value ?? '').replace(/\D/g, '');

export function validDocument(value) {
  const d = digits(value);
  if (!/^\d{11}$|^\d{14}$/.test(d) || /^(\d)\1+$/.test(d)) return false;
  const check = (base, weights) => {
    const sum = [...base].reduce((n, c, i) => n + Number(c) * weights[i], 0);
    const rem = sum % 11;
    return String(rem < 2 ? 0 : 11 - rem);
  };
  const base = d.slice(0, -2);
  const first = d.length === 11 ? [10,9,8,7,6,5,4,3,2] : [5,4,3,2,9,8,7,6,5,4,3,2];
  const second = d.length === 11 ? [11,10,9,8,7,6,5,4,3,2] : [6,5,4,3,2,9,8,7,6,5,4,3,2];
  const a = check(base, first);
  return d === base + a + check(base + a, second);
}

export function validateCustomer(body) {
  const name = String(body.name ?? '').trim().replace(/\s+/g, ' ');
  const email = String(body.email ?? '').trim().toLowerCase();
  const confirmation = String(body.emailConfirmation ?? '').trim().toLowerCase();
  const document = digits(body.document);
  let phone = digits(body.phone);
  if ((phone.length === 12 || phone.length === 13) && phone.startsWith('55')) phone = phone.slice(2);
  if (name.length < 5 || name.length > 120 || !/^\p{L}+(?:[\p{L}'’.-]*)(?:\s+[\p{L}'’.-]+)+$/u.test(name)) throw new Error('Informe seu nome completo.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('Informe um email válido.');
  if (email !== confirmation) throw new Error('Os emails precisam ser iguais.');
  if (!validDocument(document)) throw new Error('Informe um CPF ou CNPJ válido.');
  if (!/^[1-9]{2}\d{8,9}$/.test(phone)) throw new Error('Informe um celular válido com DDD.');
  return { name, email, phone, document: { number: document, type: document.length === 11 ? 'cpf' : 'cnpj' } };
}

export function signPayment(id, secret, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ id, amount: AMOUNT, exp: now + 48 * 60 * 60 * 1000 })).toString('base64url');
  return payload + '.' + createHmac('sha256', secret).update('monique:' + payload).digest('base64url');
}

export function verifyPayment(token, secret, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 1800) throw new Error('invalid');
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) throw new Error('invalid');
  const expected = createHmac('sha256', secret).update('monique:' + payload).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('invalid');
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
  if (data.amount !== AMOUNT || data.exp < now || !/^[a-zA-Z0-9_-]{1,150}$/.test(data.id)) throw new Error('invalid');
  return data;
}

export function send(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(body);
}

export function sameOrigin(req) {
  if (!req.headers.origin) return true;
  try { return new URL(req.headers.origin).host === req.headers.host; } catch { return false; }
}

export async function blackcat(path, options = {}) {
  return fetch(API_BASE + path, { ...options, headers: { 'Content-Type': 'application/json', 'X-API-Key': process.env.BLACKCAT_API_KEY, ...options.headers }, signal: AbortSignal.timeout(45000) });
}
