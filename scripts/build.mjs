import { cp, mkdir, rm } from 'node:fs/promises';
import { quantumConfigured, quantumRequest, quantumToken } from '../lib/quantumpay.js';

if (process.env.VERCEL_ENV === 'production') {
  if (!quantumConfigured()) throw new Error('Configure as credenciais QuantumPay para produção.');
  const accessToken = await quantumToken();
  console.log('QuantumPay: autenticação de produção confirmada.');
  // Only the provider's non-personal account state belongs in deployment logs.
  try {
    const response = await quantumRequest(accessToken, '/api/v1/company');
    const result = await response.json();
    const state = result?.data?.company?.status;
    const recognized = ['active', 'inactive', 'pending', 'blocked', 'suspended'];
    console.log('QuantumPay company status:', recognized.includes(String(state).toLowerCase()) ? String(state).toLowerCase() : 'unknown', 'HTTP', response.status);
  } catch {
    console.warn('QuantumPay company status unavailable.');
  }
}

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });
console.log('Checkout pronto em dist/.');
