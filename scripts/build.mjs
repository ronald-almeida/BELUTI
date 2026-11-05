import { cp, mkdir, rm } from 'node:fs/promises';
import { quantumConfigured, quantumToken } from '../lib/quantumpay.js';

if (process.env.VERCEL_ENV === 'production') {
  if (!quantumConfigured()) throw new Error('Configure as credenciais QuantumPay para produção.');
  await quantumToken();
  console.log('QuantumPay: autenticação de produção confirmada.');
}

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });
console.log('Checkout pronto em dist/.');
