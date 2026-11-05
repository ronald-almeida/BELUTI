import { cp, mkdir, rm } from 'node:fs/promises';
import { payShark } from '../lib/payshark.js';

if (process.env.VERCEL_ENV === 'production') {
  const response = await payShark('/store-info');
  if (!response.ok) throw new Error('Autenticação PayShark falhou (HTTP ' + response.status + ').');
  const store = await response.json();
  if (store.status !== 'ACTIVE' || store.currency !== 'BRL') throw new Error('A loja PayShark precisa estar ativa em BRL.');
  console.log('PayShark: chave de pagamento validada para loja ativa em BRL.');
}

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });
console.log('Checkout pronto em dist/.');
