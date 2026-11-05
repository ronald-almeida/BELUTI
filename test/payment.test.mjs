import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import createPix from '../api/create-pix.js';
import paymentStatus from '../api/payment-status.js';
import { AMOUNT, signPayment, verifyPayment, validDocument } from '../lib/payment.js';
const originalFetch = globalThis.fetch;
beforeEach(() => {
  process.env.QUANTUMPAY_API_KEY = 'test-public';
  process.env.QUANTUMPAY_API_SECRET = 'test-secret';
});
function mockQuantum(operation) {
  globalThis.fetch = async (url, options) => {
    if (url === 'https://api.quantumpay.com.br/auth') {
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.Authorization, 'Basic ' + Buffer.from('test-public:test-secret').toString('base64'));
      return Response.json({ success: true, token: 'test-bearer', expiresIn: 1000 });
    }
    assert.equal(options.headers.Authorization, 'Bearer test-bearer');
    return operation(url, options);
  };
}
afterEach(() => { globalThis.fetch = originalFetch; delete process.env.BLACKCAT_API_KEY; delete process.env.QUANTUMPAY_API_KEY; delete process.env.QUANTUMPAY_API_SECRET; });
function res() { return { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; }, json(data) { this.data = data; return this; } }; }
function req(body, method = 'POST') { return { method, headers: { 'content-type': 'application/json', host: 'checkout.example', origin: 'https://checkout.example' }, body }; }
const buyer = { name: 'Cliente de Teste', email: 'cliente@example.com', emailConfirmation: 'cliente@example.com', document: '52998224725', phone: '11999999999' };
const pixCode = '00020101021226840014br.gov.bcb.pix2562example.com/pix/teste5204000053039865406347.905802BR5913TESTE MONIQUE6009SAO PAULO62070503***6304ABCD';

test('validates CPF and CNPJ check digits', () => {
  assert.ok(validDocument('529.982.247-25'));
  assert.ok(validDocument('11.222.333/0001-81'));
  assert.equal(validDocument('11111111111'), false);
  assert.equal(validDocument('52998224726'), false);
});
test('missing API key never creates a charge', async () => {
  delete process.env.QUANTUMPAY_API_KEY;
  let called = false; globalThis.fetch = async () => { called = true; };
  const r = res(); await createPix(req(buyer), r);
  assert.equal(r.statusCode, 503); assert.equal(called, false);
});
test('price and product are fixed server-side and response excludes customer and key', async () => {

  let payload;
  mockQuantum(async (url, options) => {
    assert.equal(url, 'https://api.quantumpay.com.br/v1/pix/in/qrcode');
    payload = JSON.parse(options.body);
    assert.equal(payload.customer.documentType, 'cpf');
    assert.equal(payload.customer.document, buyer.document);
    return Response.json({ success: true, data: { id: 'TXN-test', status: 'pending', pix: { emv: pixCode } } }, { status: 201 });
  });
  const r = res(); await createPix(req({ ...buyer, amount: 1, product: 'tampered' }), r);
  assert.equal(r.statusCode, 200);
  assert.equal(payload.amountInCents, 34790);
  assert.equal(payload.items[0].amountInCents, 34790);
  assert.equal(payload.items[0].title, 'Black Friday da Monique');
  assert.match(r.data.qrImage, /^data:image\/png;base64,/);
  assert.equal(r.data.pixCode, pixCode);
  assert.equal(r.headers['Cache-Control'], 'no-store');
  const output = JSON.stringify(r.data);
  assert.ok(!output.includes(buyer.document) && !output.includes(buyer.email) && !output.includes('test-secret'));
  assert.equal(verifyPayment(r.data.token.slice(3), 'test-secret').id, 'TXN-test');
});
test('invalid customer and foreign origins do not reach the provider', async () => {
  process.env.BLACKCAT_API_KEY = 'test-key'; let called = false;
  globalThis.fetch = async () => { called = true; };
  const invalid = res(); await createPix(req({ ...buyer, emailConfirmation: 'different@example.com' }), invalid);
  assert.equal(invalid.statusCode, 400);
  const foreign = req(buyer); foreign.headers.origin = 'https://foreign.example';
  const r = res(); await createPix(foreign, r);
  assert.equal(r.statusCode, 403); assert.equal(called, false);
});
test('ambiguous failures are never automatically retried', async () => {
  process.env.BLACKCAT_API_KEY = 'test-key'; let calls = 0;
  mockQuantum(async () => { calls++; throw new Error('timeout'); });
  const r = res(); await createPix(req(buyer), r);
  assert.equal(calls, 1); assert.equal(r.data.code, 'PAYMENT_UNCERTAIN');
});
test('wrong provider amount is not displayed as a valid payment', async () => {
  process.env.BLACKCAT_API_KEY = 'test-key';
  mockQuantum(async () => Response.json({ success: true, data: { amountInCents: 1, id: 'TXN-test', pix: { emv: pixCode } } }));
  const r = res(); await createPix(req(buyer), r);
  assert.equal(r.data.code, 'PAYMENT_UNCERTAIN');
});
test('status tokens reject tampering and expiration', () => {
  const token = signPayment('TXN-test', 'secret', 1000);
  assert.throws(() => verifyPayment(token, 'wrong', 2000));
  assert.throws(() => verifyPayment(token + 'x', 'secret', 2000));
  assert.throws(() => verifyPayment(token, 'secret', 1000 + 49 * 3600000));
});
test('paid confirmation requires provider amount, payment method and transaction ID', async () => {
  process.env.BLACKCAT_API_KEY = 'test-key';
  const token = signPayment('TXN-test', 'test-key');
  globalThis.fetch = async () => Response.json({ success: true, data: { transactionId: 'TXN-test', status: 'PAID', amount: 34790, paymentMethod: 'PIX' } });
  const good = res(); await paymentStatus(req({ token }), good); assert.equal(good.data.status, 'PAID');
  globalThis.fetch = async () => Response.json({ success: true, data: { transactionId: 'TXN-other', status: 'PAID', amount: 34790, paymentMethod: 'PIX' } });
  const bad = res(); await paymentStatus(req({ token }), bad); assert.equal(bad.statusCode, 502);
});

test('QuantumPay status uses the signed transaction and checks returned amount', async () => {
  const token = 'qp.' + signPayment('trx_test', 'test-secret');
  for (const [data, expected] of [[{ status: 'paid' }, 200], [{ status: 'paid', amountInCents: 1 }, 502]]) {
    mockQuantum(async url => {
      assert.equal(url, 'https://api.quantumpay.com.br/api/v1/transactions/trx_test');
      return Response.json(data);
    });
    const result = res();
    await paymentStatus(req({ token }), result);
    assert.equal(result.statusCode, expected);
    if (expected === 200) assert.equal(result.data.status, 'PAID');
  }
});

test('integration rejection is distinct from payer validation and excludes upstream details', async () => {
  mockQuantum(async () => Response.json({ message: 'Erro de integração ' + buyer.email }, { status: 422 }));
  const result = res();
  await createPix(req(buyer), result);
  assert.equal(result.data.code, 'PROVIDER_INTEGRATION');
  assert.ok(result.data.reference);
  assert.ok(!JSON.stringify(result.data).includes(buyer.email));
});
