const $ = id => document.getElementById(id);
const form = $('checkout-form');
const dialog = $('pix-dialog');
const storageKey = 'monique-pix-v1';
const attemptKey = 'monique-pix-attempt-v1';
let payment = null;
let creating = false;
let checking = false;
let poll = null;
let lastFocus = null;
let status = 'PENDING';
const storage = {
  get(key) { try { return JSON.parse(sessionStorage.getItem(key)); } catch { return null; } },
  set(key, value) { try { sessionStorage.setItem(key, JSON.stringify(value)); } catch {} },
  remove(key) { try { sessionStorage.removeItem(key); } catch {} }
};
const digits = value => value.replace(/\D/g, '');

function setView(view) {
  for (const name of ['loading', 'error', 'payment', 'success']) $('modal-' + name).hidden = name !== view;
}
function openModal() {
  if (!dialog.open) { lastFocus = document.activeElement; dialog.showModal(); document.body.classList.add('modal-open'); }
}
function closeModal() { dialog.close(); }
dialog.addEventListener('close', () => { document.body.classList.remove('modal-open'); clearTimeout(poll); lastFocus?.focus(); });
$('close-modal').addEventListener('click', closeModal);
$('back-to-form').addEventListener('click', closeModal);
dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closeModal(); } });

$('document').addEventListener('input', event => {
  const value = digits(event.target.value).slice(0, 14);
  event.target.value = value.length <= 11
    ? value.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/(\d{3})(\d{1,2})$/, '$1-$2')
    : value.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/(\d{3})(\d{4})(\d{1,2})$/, '$1/$2-$3');
  event.target.setCustomValidity('');
});
$('phone').addEventListener('input', event => {
  const v = digits(event.target.value).slice(0, 11);
  event.target.value = v.length > 10 ? v.replace(/^(\d{2})(\d{5})(\d{0,4})$/, '($1) $2-$3') : v.replace(/^(\d{2})(\d{4})(\d{0,4})$/, '($1) $2-$3');
  event.target.setCustomValidity('');
});
for (const id of ['email', 'email-confirmation']) $(id).addEventListener('input', () => $('email-confirmation').setCustomValidity(''));
$('name').addEventListener('input', () => $('name').setCustomValidity(''));

function validDocument(value) {
  const d = digits(value);
  if (!/^\d{11}$|^\d{14}$/.test(d) || /^(\d)\1+$/.test(d)) return false;
  const calc = (base, weights) => { const n = [...base].reduce((s, c, i) => s + Number(c) * weights[i], 0) % 11; return String(n < 2 ? 0 : 11 - n); };
  const base = d.slice(0, -2), cpf = d.length === 11;
  const a = calc(base, cpf ? [10,9,8,7,6,5,4,3,2] : [5,4,3,2,9,8,7,6,5,4,3,2]);
  return d === base + a + calc(base + a, cpf ? [11,10,9,8,7,6,5,4,3,2] : [6,5,4,3,2,9,8,7,6,5,4,3,2]);
}

function showPayment() {
  openModal();
  if (status === 'PAID') return setView('success');
  setView('payment');
  $('pix-qr').src = payment.qrImage;
  $('pix-code').value = payment.pixCode;
  const expires = Date.parse(payment.expiresAt);
  $('expiry').textContent = Number.isFinite(expires) ? 'Válido até ' + new Date(expires).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
  $('generate-pix').querySelector('span').textContent = 'Ver código QR';
  $('open-pix').type = 'button';
  $('generate-pix').type = 'button';
  $('customer-fields').disabled = true;
  checkStatus(false);
}

function showError(message) { setView('error'); $('modal-error-text').textContent = message; }

async function generate() {
  if (payment) return showPayment();
  if (creating) return openModal();
  const pending = storage.get(attemptKey);
  if (pending) {
    openModal();
    showError('Há uma tentativa de geração sem confirmação. Confira com a equipe do produto se a cobrança foi criada antes de iniciar outra.');
    return;
  }
  const body = Object.fromEntries(new FormData(form));
  $('email-confirmation').setCustomValidity(body.email.trim().toLowerCase() === body.emailConfirmation.trim().toLowerCase() ? '' : 'Os emails precisam ser iguais.');
  $('document').setCustomValidity(validDocument(body.document) ? '' : 'Informe um CPF ou CNPJ válido.');
  $('phone').setCustomValidity(/^[1-9]{2}\d{8,9}$/.test(digits(body.phone)) ? '' : 'Informe um celular válido com DDD.');
  $('name').setCustomValidity(body.name.trim().split(/\s+/).length >= 2 ? '' : 'Informe seu nome completo.');
  if (!form.reportValidity()) return;
  creating = true;
  openModal();
  setView('loading');
  $('generate-pix').disabled = $('open-pix').disabled = true;
  body.attemptId = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c => (Number(c) ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> Number(c) / 4).toString(16));
  for (const [key, value] of new URLSearchParams(location.search)) if (/^utm_(source|medium|campaign|content|term)$/.test(key)) body[key] = value;
  storage.set(attemptKey, { id: body.attemptId, at: Date.now() });
  try {
    const response = await fetch('/api/create-pix', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(55000) });
    const result = await response.json();
    if (!response.ok) {
      if ((result.code !== 'PAYMENT_UNCERTAIN' && response.status < 500) || result.code === 'PAYMENT_UNAVAILABLE') storage.remove(attemptKey);
      throw new Error(result.message || 'Não foi possível gerar o Pix. Tente novamente mais tarde.');
    }
    if (result.amount !== 34790 || !result.pixCode || !result.qrImage?.startsWith('data:image/png;base64,') || !result.token) throw new Error('Não foi possível exibir o código. Confira com a equipe do produto antes de gerar outra cobrança.');
    payment = result;
    storage.set(storageKey, payment);
    storage.remove(attemptKey);
    showPayment();
  } catch (error) {
    showError(['TimeoutError', 'TypeError', 'SyntaxError'].includes(error.name) ? 'A conexão foi interrompida durante a geração. Confira com a equipe do produto se a cobrança foi criada antes de tentar novamente.' : error.message);
  } finally {
    creating = false;
    $('generate-pix').disabled = $('open-pix').disabled = false;
  }
}
form.addEventListener('submit', event => { event.preventDefault(); generate(); });
for (const id of ['generate-pix', 'open-pix']) $(id).addEventListener('click', event => { if (payment) { event.preventDefault(); showPayment(); } });

$('copy-pix').addEventListener('click', async () => {
  if (!payment) return;
  try {
    await navigator.clipboard.writeText(payment.pixCode);
    $('copy-feedback').textContent = 'Código copiado! Abra o aplicativo do seu banco.';
  } catch {
    $('pix-code').focus(); $('pix-code').select(); $('pix-code').setSelectionRange(0, payment.pixCode.length);
    let copied = false;
    try { copied = document.execCommand('copy'); } catch {}
    $('copy-feedback').textContent = copied ? 'Código copiado! Abra o aplicativo do seu banco.' : 'Toque e segure o código selecionado para copiar.';
  }
});

async function checkStatus(manual) {
  clearTimeout(poll);
  if (!payment || checking || status !== 'PENDING') return;
  checking = true;
  $('check-payment').disabled = true;
  if (manual) $('status-feedback').textContent = 'Consultando pagamento…';
  try {
    const response = await fetch('/api/payment-status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: payment.token }), signal: AbortSignal.timeout(50000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message);
    status = result.status;
    if (status === 'PAID') { setView('success'); storage.set(storageKey, { ...payment, status }); }
    else if (status === 'UNDER_REVIEW') {
      $('waiting-status').textContent = 'Pagamento em análise';
      $('copy-pix').disabled = true;
      $('check-payment').hidden = true;
      $('status-feedback').textContent = 'Entre em contato com a equipe do produto.';
    } else if (['CANCELLED', 'REFUNDED'].includes(status)) {
      $('waiting-status').textContent = status === 'REFUNDED' ? 'Pagamento estornado' : 'Código cancelado ou expirado';
      $('copy-pix').disabled = true; $('check-payment').hidden = true;
      $('status-feedback').textContent = 'Fale com a equipe do produto antes de fazer um novo pagamento.';
    } else if (manual) $('status-feedback').textContent = 'O pagamento ainda não foi confirmado. Aguarde alguns instantes.';
  } catch (error) { if (manual) $('status-feedback').textContent = error.message || 'Não foi possível consultar agora. Tente novamente em instantes.'; }
  finally {
    checking = false;
    $('check-payment').disabled = false;
    if (dialog.open && status === 'PENDING' && !document.hidden) poll = setTimeout(() => checkStatus(false), 15000);
  }
}
$('check-payment').addEventListener('click', () => checkStatus(true));
document.addEventListener('visibilitychange', () => { if (document.hidden) clearTimeout(poll); else if (dialog.open) checkStatus(false); });
const saved = storage.get(storageKey);
if (saved?.amount === 34790 && saved.pixCode && saved.token && saved.qrImage?.startsWith('data:image/png;base64,')) {
  payment = saved; status = saved.status || 'PENDING';
  $('generate-pix').querySelector('span').textContent = status === 'PAID' ? 'Ver pagamento' : 'Ver código QR';
  $('generate-pix').type = $('open-pix').type = 'button';
  $('customer-fields').disabled = true;
}
