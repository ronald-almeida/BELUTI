import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import createPix from '../api/create-pix.js';
import paymentStatus from '../api/payment-status.js';
import { AMOUNT, signPayment, verifyPayment, validDocument } from '../lib/payment.js';
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; delete process.env.BLACKCAT_API_KEY; });
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
  let called = false; globalThis.fetch = async () => { called = true; };
  const r = res(); await createPix(req(buyer), r);
  assert.equal(r.statusCode, 503); assert.equal(called, false);
});
test('price and product are fixed server-side and response excludes customer and key', async () => {
  process.env.BLACKCAT_API_KEY = 'test-key-not-real';
  let payload;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.blackcatoficial.com/api/sales/create-sale');
    payload = JSON.parse(options.body);
    assert.equal(options.headers['X-API-Key'], 'test-key-not-real');
    return Response.json({ success: true, data: { amount: AMOUNT, transactionId: 'TXN-test', paymentData: { copyPaste: pixCode, expiresAt: '2026-11-05T22:00:00Z' } } }, { status: 201 });
  };
  const r = res(); await createPix(req({ ...buyer, amount: 1, product: 'tampered' }), r);
  assert.equal(r.statusCode, 200);
  assert.equal(payload.amount, 34790);
  assert.equal(payload.items[0].unitPrice, 34790);
  assert.equal(payload.items[0].title, 'Black Friday da Monique');
  assert.match(r.data.qrImage, /^data:image\/png;base64,/);
  assert.equal(r.data.pixCode, pixCode);
  assert.equal(r.headers['Cache-Control'], 'no-store');
  const output = JSON.stringify(r.data);
  assert.ok(!output.includes(buyer.document) && !output.includes(buyer.email) && !output.includes('test-key-not-real'));
  assert.equal(verifyPayment(r.data.token, 'test-key-not-real').id, 'TXN-test');
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
  globalThis.fetch = async () => { calls++; throw new Error('timeout'); };
  const r = res(); await createPix(req(buyer), r);
  assert.equal(calls, 1); assert.equal(r.data.code, 'PAYMENT_UNCERTAIN');
});
test('wrong provider amount is not displayed as a valid payment', async () => {
  process.env.BLACKCAT_API_KEY = 'test-key';
  globalThis.fetch = async () => Response.json({ success: true, data: { amount: 1, transactionId: 'TXN-test', paymentData: { copyPaste: pixCode } } });
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
