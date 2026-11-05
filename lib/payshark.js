import { AMOUNT } from './payment.js';

const baseUrl = 'https://api.gatewaypayshark.com.br/v1';

export function paymentKey() {
  return process.env.PAYSHARK_API_KEY?.trim();
}

export function payShark(path, options = {}) {
  const key = paymentKey();
  if (!key) throw new Error('Configure PAYSHARK_API_KEY.');
  return fetch(baseUrl + path, {
    ...options,
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(30000)
  });
}

export function isExpectedPix(payment) {
  return payment?.amount === AMOUNT && payment.method === 'PIX' && payment.currency === 'BRL';
}
