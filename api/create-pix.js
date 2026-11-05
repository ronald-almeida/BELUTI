import { randomUUID } from 'node:crypto';
import { quantumConfigured, quantumRequest, quantumToken } from '../lib/quantumpay.js';
import QRCode from 'qrcode';
import { AMOUNT, PRODUCT, sameOrigin, send, signPayment, validateCustomer } from '../lib/payment.js';

function handleRejectedPix(res, status, result) {
  const reference = randomUUID().slice(0, 8);
  // Diagnostic logs contain only recognized API vocabulary, including nested errors.
  const vocabulary = new Set(('amount amountincents valor minimo maximo centavos limite email telefone phone cpf cnpj document documenttype nome name customer pagador dados invalid invalid_request invalid_parameter validation_error invalidos invalido required obrigatorio obrigatoria ausente missing field campo fields items item quantity quantidade description descricao title tangible postbackurl webhook callback url api pix in cash cashin cash_in payment qrcode transaction transacao integracao integration merchant estabelecimento empresa conta company account adquirente acquirer provedor provider gateway banco bank configurado configurada configuracao configured enabled habilitado habilitada desabilitado desabilitada ativo ativa active inactive inativo inativa bloqueado bloqueada blocked unauthorized forbidden permission permissao allowed permitido ip whitelist credencial credentials chave key token expired expirado indisponivel unavailable falha failed failure error erro internal interno criar gerar creation processamento processar processado processing rejected recusada saldo balance insufficient insuficiente pendente pending onboarding kyc aprovado approved validacao validado nao not no sem encontrado encontrada found disponivel rota route pix_in cash_in_disabled').split(' '));
  const fragments = [];
  function collect(value, depth = 0) {
    if (depth > 5 || fragments.length >= 120) return;
    if (typeof value === 'string') fragments.push(value.slice(0, 500));
    else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value).slice(0, 20)) {
        fragments.push(key);
        collect(child, depth + 1);
      }
    }
  }
  collect(result);
  const reason = fragments.join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const hints = [...new Set((reason.match(/[a-z_]+/g) || []).filter(word => vocabulary.has(word)))].slice(0, 45);
  const rawCode = [result?.code, result?.error?.code, result?.error].find(value =>
    typeof value === 'string' && /^[A-Z]{2,16}(?:_[A-Z]{2,16}){1,5}$/.test(value));
  const integration = /integracao|integration|acquirer|adquirente/.test(reason);
  const field = ['cpf', 'cnpj', 'document', 'phone', 'email', 'telefone']
    .find(name => reason.includes(name));
  const category = integration ? 'integration' : (field || 'unspecified');
  console.warn('QuantumPay Pix IN rejected', { status, category, reference, hints, providerCode: rawCode });

  let message = 'A operadora recusou a solicitação de Pix. Fale com a equipe do produto.';
  if (integration) message = 'A operadora informou um erro de integração. Fale com a equipe do produto.';
  else if (field) message = 'A operadora recusou os dados do pagador. Confira o documento, o email e o telefone.';
  return send(res, 400, {
    code: integration ? 'PROVIDER_INTEGRATION' : 'INVALID_PAYMENT',
    reference,
    message: message + ' Referência: ' + reference + '.'
  });
}

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
    }
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
      if ([400, 422].includes(response.status)) return handleRejectedPix(res, response.status, result);
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
