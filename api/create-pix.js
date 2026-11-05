import { randomUUID } from 'node:crypto';
import { payShark, paymentKey, isExpectedPix } from '../lib/payshark.js';
import QRCode from 'qrcode';
import { AMOUNT, PRODUCT, sameOrigin, send, signPayment, validateCustomer } from '../lib/payment.js';

function handleRejectedPix(res, status, result) {
  const reference = randomUUID().slice(0, 8);
  const code = result?.code;
  const knownCodes = ['payment.businessLogic.ticketMin', 'payment.businessLogic.ticketMax', 'payment.businessLogic.netAmountLT0'];
  console.warn('PayShark Pix rejected', { status, reference, code: knownCodes.includes(code) ? code : 'other' });
  const message = 'A operadora recusou a solicitação de Pix. Fale com a equipe do produto.';
  return send(res, 400, {
    code: 'INVALID_PAYMENT',
    reference,
    message: message + ' Referência: ' + reference + '.'
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { message: 'Método não permitido.' }); }
  if (!sameOrigin(req)) return send(res, 403, { message: 'Atualize a página e tente novamente.' });
  if (!req.headers['content-type']?.startsWith('application/json')) return send(res, 415, { message: 'Formato de solicitação inválido.' });
  if (!paymentKey()) return send(res, 503, { code: 'PAYMENT_UNAVAILABLE', message: 'Pagamento temporariamente indisponível. Tente novamente mais tarde ou fale com a equipe do produto.' });
  let body;
  let customer;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!body || JSON.stringify(body).length > 12000) throw new Error('Solicitação inválida.');
    customer = validateCustomer(body);
  } catch (error) { return send(res, 400, { message: error instanceof SyntaxError ? 'Solicitação inválida.' : error.message }); }
  const payload = {
    amount: AMOUNT,
    currency: 'BRL',
    method: 'PIX',
    description: PRODUCT,
    externalRef: 'MONIQUE-' + randomUUID(),
    payer: {
      name: customer.name,
      email: customer.email,
      phone: '+55' + customer.phone,
      taxId: customer.document.number
    },
    items: [{ name: PRODUCT, price: AMOUNT, quantity: 1, type: 'DIGITAL' }]
  };
  // Never retry a charge creation: a timeout may occur after the provider created it.
  try {
    const response = await payShark('/payment', { method: 'POST', body: JSON.stringify(payload) });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      if ([400, 422].includes(response.status)) return handleRejectedPix(res, response.status, result);
      if ([401, 403].includes(response.status)) return send(res, 503, { code: 'PAYMENT_UNAVAILABLE', message: 'Pagamento temporariamente indisponível. Fale com a equipe do produto.' });
      if (response.status === 429) return send(res, 429, { code: 'RATE_LIMIT', message: 'Muitas solicitações. Aguarde um minuto e tente novamente.' });
      return send(res, 502, { code: 'PAYMENT_UNCERTAIN', message: 'A operadora não confirmou a geração. Para evitar cobranças duplicadas, confira com a equipe do produto antes de tentar novamente.' });
    }
    const data = result;
    if (data?.status === 'REFUSED') return handleRejectedPix(res, 422, data);
    const id = data?.id;
    const code = data?.data?.copypaste;
    if (!/^[a-zA-Z0-9_-]{1,150}$/.test(id ?? '') || typeof code !== 'string' || !code.startsWith('000201') || code.length > 4000 || !isExpectedPix(data) || !['PENDING', 'PROCESSING'].includes(data.status)) {
      return send(res, 502, { code: 'PAYMENT_UNCERTAIN', message: 'A cobrança foi enviada, mas o código Pix não pôde ser exibido. Confira com a equipe do produto antes de gerar outra cobrança.' });
    }
    // Render locally: no third-party QR service receives payment data.
    const qrImage = await QRCode.toDataURL(code, { errorCorrectionLevel: 'M', width: 480, margin: 2 });
    return send(res, 200, { transactionId: id, amount: AMOUNT, pixCode: code, qrImage, expiresAt: data.expiresAt || null, token: 'ps.' + signPayment(id, paymentKey()) });
  } catch {
    return send(res, 504, { code: 'PAYMENT_UNCERTAIN', message: 'A geração demorou mais que o esperado. Confira com a equipe do produto se a cobrança foi criada antes de tentar novamente.' });
  }
}
