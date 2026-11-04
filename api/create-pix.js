import { randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import { AMOUNT, PRODUCT, blackcat, sameOrigin, send, signPayment, validateCustomer } from '../lib/payment.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { message: 'Método não permitido.' }); }
  if (!sameOrigin(req)) return send(res, 403, { message: 'Atualize a página e tente novamente.' });
  if (!req.headers['content-type']?.startsWith('application/json')) return send(res, 415, { message: 'Formato de solicitação inválido.' });
  if (!process.env.BLACKCAT_API_KEY) return send(res, 503, { code: 'PAYMENT_UNAVAILABLE', message: 'Pagamento temporariamente indisponível. Tente novamente mais tarde ou fale com a equipe do produto.' });
  let body;
  let customer;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!body || JSON.stringify(body).length > 12000) throw new Error('Solicitação inválida.');
    customer = validateCustomer(body);
  } catch (error) { return send(res, 400, { message: error instanceof SyntaxError ? 'Solicitação inválida.' : error.message }); }
  const tracking = {};
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
    if (typeof body[key] === 'string') tracking[key] = body[key].slice(0, 200);
  }
  const attemptId = /^[a-f0-9-]{36}$/i.test(body.attemptId ?? '') ? body.attemptId : randomUUID();
  const payload = {
    amount: AMOUNT, currency: 'BRL', paymentMethod: 'pix',
    items: [{ title: PRODUCT, unitPrice: AMOUNT, quantity: 1, tangible: false }],
    customer, pix: { expiresInDays: 1 }, externalRef: 'MONIQUE-' + attemptId,
    metadata: 'Checkout Black Friday da Monique', ...tracking
  };
  // Never retry a charge creation: a timeout may occur after the provider created it.
  try {
    const response = await blackcat('/sales/create-sale', { method: 'POST', body: JSON.stringify(payload) });
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.success !== true) {
      if ([400, 422].includes(response.status)) return send(res, 400, { code: 'INVALID_PAYMENT', message: 'Não foi possível gerar o Pix. Confira seus dados e tente novamente.' });
      if ([401, 403].includes(response.status)) return send(res, 503, { code: 'PAYMENT_UNAVAILABLE', message: 'Pagamento temporariamente indisponível. Fale com a equipe do produto.' });
      if (response.status === 429) return send(res, 429, { code: 'RATE_LIMIT', message: 'Muitas solicitações. Aguarde um minuto e tente novamente.' });
      return send(res, 502, { code: 'PAYMENT_UNCERTAIN', message: 'A operadora não confirmou a geração. Para evitar cobranças duplicadas, confira com a equipe do produto antes de tentar novamente.' });
    }
    const data = result.data;
    const id = data?.transactionId;
    const code = data?.paymentData?.copyPaste || data?.paymentData?.qrCode;
    if (!/^[a-zA-Z0-9_-]{1,150}$/.test(id ?? '') || typeof code !== 'string' || !code.startsWith('000201') || code.length > 4000 || Number(data.amount) !== AMOUNT) {
      return send(res, 502, { code: 'PAYMENT_UNCERTAIN', message: 'A cobrança foi enviada, mas o código Pix não pôde ser exibido. Confira com a equipe do produto antes de gerar outra cobrança.' });
    }
    // Render locally: no third-party QR service receives payment data.
    const qrImage = await QRCode.toDataURL(code, { errorCorrectionLevel: 'M', width: 480, margin: 2 });
    return send(res, 200, { transactionId: id, amount: AMOUNT, pixCode: code, qrImage, expiresAt: data.paymentData.expiresAt || null, token: signPayment(id, process.env.BLACKCAT_API_KEY) });
  } catch {
    return send(res, 504, { code: 'PAYMENT_UNCERTAIN', message: 'A geração demorou mais que o esperado. Confira com a equipe do produto se a cobrança foi criada antes de tentar novamente.' });
  }
}
