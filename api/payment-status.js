import { quantumRequest, quantumToken } from '../lib/quantumpay.js';
import { AMOUNT, blackcat, sameOrigin, send, verifyPayment } from '../lib/payment.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { message: 'Método não permitido.' }); }
  if (!sameOrigin(req)) return send(res, 403, { message: 'Atualize a página para consultar.' });
  let token;
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    token = body?.token;
  } catch { return send(res, 400, { message: 'Solicitação inválida.' }); }
  const quantum = typeof token === 'string' && token.startsWith('qp.');
  const secret = quantum ? process.env.QUANTUMPAY_API_SECRET : process.env.BLACKCAT_API_KEY;
  if (!secret) return send(res, 503, { message: 'Consulta temporariamente indisponível.' });
  let payment;
  try {
    payment = verifyPayment(quantum ? token.slice(3) : token, secret);
  } catch { return send(res, 403, { message: 'Esta consulta expirou. Confira o pagamento com a equipe do produto.' }); }
  try {
    if (quantum) {
      const accessToken = await quantumToken();
      const response = await quantumRequest(accessToken, '/api/v1/transactions/' + encodeURIComponent(payment.id));
      const result = await response.json();
      const data = result?.data ?? result;
      const amount = data?.amountInCents ?? data?.amount;
      if (!response.ok || result?.success === false || !data ||
          (data.id != null && data.id !== payment.id) ||
          (amount != null && Number(amount) !== AMOUNT)) throw new Error('Invalid transaction');
      const statuses = new Map([
        ['pending', 'PENDING'], ['paid', 'PAID'], ['canceled', 'CANCELLED'],
        ['expired', 'CANCELLED'], ['refunded', 'REFUNDED']
      ]);
      const status = statuses.get(data.status);
      if (!status) throw new Error('Unknown payment status');
      return send(res, 200, { status });
    }
    const response = await blackcat('/sales/' + encodeURIComponent(payment.id) + '/status');
    const result = await response.json();
    if (!response.ok || result.success !== true || result.data?.transactionId !== payment.id || Number(result.data?.amount) !== AMOUNT || String(result.data?.paymentMethod).toLowerCase() !== 'pix') throw new Error('invalid');
    const status = String(result.data.status).toUpperCase();
    if (!['PENDING', 'PAID', 'CANCELLED', 'REFUNDED'].includes(status)) throw new Error('invalid');
    return send(res, 200, { status });
  } catch { return send(res, 502, { message: 'Não foi possível consultar agora. Aguarde alguns instantes e verifique novamente.' }); }
}
