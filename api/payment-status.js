import { AMOUNT, blackcat, sameOrigin, send, verifyPayment } from '../lib/payment.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { message: 'Método não permitido.' }); }
  if (!sameOrigin(req)) return send(res, 403, { message: 'Atualize a página para consultar.' });
  if (!process.env.BLACKCAT_API_KEY) return send(res, 503, { message: 'Consulta temporariamente indisponível.' });
  let payment;
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    payment = verifyPayment(body?.token, process.env.BLACKCAT_API_KEY);
  } catch { return send(res, 403, { message: 'Esta consulta expirou. Confira o pagamento com a equipe do produto.' }); }
  try {
    const response = await blackcat('/sales/' + encodeURIComponent(payment.id) + '/status');
    const result = await response.json();
    if (!response.ok || result.success !== true || result.data?.transactionId !== payment.id || Number(result.data?.amount) !== AMOUNT || String(result.data?.paymentMethod).toLowerCase() !== 'pix') throw new Error('invalid');
    const status = String(result.data.status).toUpperCase();
    if (!['PENDING', 'PAID', 'CANCELLED', 'REFUNDED'].includes(status)) throw new Error('invalid');
    return send(res, 200, { status });
  } catch { return send(res, 502, { message: 'Não foi possível consultar agora. Aguarde alguns instantes e verifique novamente.' }); }
}
