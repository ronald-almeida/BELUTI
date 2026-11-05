import { quantumConfigured, quantumRequest, quantumToken } from '../lib/quantumpay.js';
import QRCode from 'qrcode';
import { AMOUNT, PRODUCT, sameOrigin, send, signPayment, validateCustomer } from '../lib/payment.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { message: 'Método não permitido.' }); }
  if (!sameOrigin(req)) return send(res, 403, { message: 'Atualize a página e tente novamente.' });
  if (!req.headers['content-type']?.startsWith('application/json')) return send(res, 415, { message: 'Formato de solicitação inválido.' });
  if (!quantumConfigured()) return send(res, 503, { code: 'PAYMENT_UNAVAILABLE', message: 'Pagamento temporariamente indisponível. Tente novamente mais tarde ou fale com a equipe do produto.' });
  let body;
  let customer;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!body || JSON.stringify(body).length > 12000) throw new Error('Solicitação inválida.');
    customer = validateCustomer(body);
  } catch (error) { return send(res, 400, { message: error instanceof SyntaxError ? 'Solicitação inválida.' : error.message }); }
  const payload = {
    amountInCents: AMOUNT,
    description: PRODUCT,
    customer: {
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      document: customer.document.number,
      documentType: customer.document.type
    },
    items: [{ title: PRODUCT, quantity: 1, tangible: false, amountInCents: AMOUNT }]
  };
  let accessToken;
  try {
    accessToken = await quantumToken();
  } catch {
    return send(res, 503, { code: 'PAYMENT_UNAVAILABLE', message: 'Pagamento temporariamente indisponível. Tente novamente mais tarde.' });
  }
  // Never retry a charge creation: a timeout may occur after the provider created it.
  try {
    const response = await quantumRequest(accessToken, '/api/v1/pix/in/qrcode', { method: 'POST', body: JSON.stringify(payload) });
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.success !== true) {
      if ([400, 422].includes(response.status)) return send(res, 400, { code: 'INVALID_PAYMENT', message: 'Não foi possível gerar o Pix. Confira seus dados e tente novamente.' });
      if ([401, 403].includes(response.status)) return send(res, 503, { code: 'PAYMENT_UNAVAILABLE', message: 'Pagamento temporariamente indisponível. Fale com a equipe do produto.' });
      if (response.status === 429) return send(res, 429, { code: 'RATE_LIMIT', message: 'Muitas solicitações. Aguarde um minuto e tente novamente.' });
      return send(res, 502, { code: 'PAYMENT_UNCERTAIN', message: 'A operadora não confirmou a geração. Para evitar cobranças duplicadas, confira com a equipe do produto antes de tentar novamente.' });
    }
    const data = result.data;
    const id = data?.id;
    const code = data?.pix?.emv;
    if (!/^[a-zA-Z0-9_-]{1,150}$/.test(id ?? '') || typeof code !== 'string' || !code.startsWith('000201') || code.length > 4000 || (data.amountInCents != null && Number(data.amountInCents) !== AMOUNT)) {
      return send(res, 502, { code: 'PAYMENT_UNCERTAIN', message: 'A cobrança foi enviada, mas o código Pix não pôde ser exibido. Confira com a equipe do produto antes de gerar outra cobrança.' });
    }
    // Render locally: no third-party QR service receives payment data.
    const qrImage = await QRCode.toDataURL(code, { errorCorrectionLevel: 'M', width: 480, margin: 2 });
    return send(res, 200, { transactionId: id, amount: AMOUNT, pixCode: code, qrImage, expiresAt: data.expiresAt || null, token: 'qp.' + signPayment(id, process.env.QUANTUMPAY_API_SECRET) });
  } catch {
    return send(res, 504, { code: 'PAYMENT_UNCERTAIN', message: 'A geração demorou mais que o esperado. Confira com a equipe do produto se a cobrança foi criada antes de tentar novamente.' });
  }
}
