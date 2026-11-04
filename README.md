# Black Friday da Monique

Checkout Pix de R$ 347,90, com logo enviado, fontes Hotmart Sans/Display, layout responsivo e popup com QR Code e Pix Copia e Cola.

## Publicação na Vercel

Projeto: `beluti`. Repositório: `ronald-almeida/BELUTI`. Branch de produção: `main`. Node.js 24. Build: `npm run build`. Diretório de saída: `dist`.

Cadastre `BLACKCAT_API_KEY` em **Settings → Environment Variables** do projeto, para **Production**, usando sua chave da Black Cat. Não coloque a chave em arquivos públicos nem no Git. Faça um novo deploy após cadastrá-la. Sem a variável, a interface abre, mas a API recusa gerar cobranças.

## Integração

- `POST /api/create-pix`: valida os dados, define R$ 347,90 no servidor e chama `POST https://api.blackcatoficial.com/api/sales/create-sale` com `X-API-Key`.
- `POST /api/payment-status`: consulta somente a transação identificada por um token HMAC, validando valor, método e ID antes de confirmar o pagamento.
- QR Code gerado localmente a partir do Pix Copia e Cola devolvido pela Black Cat.
- Sem banco de dados, webhook ou serviço externo de QR. O provedor de pagamento mantém os registros de venda na própria plataforma.
- O código Pix e o token de consulta ficam no `sessionStorage` da aba para reabrir o mesmo pagamento após recarregar. Dados pessoais do formulário não são gravados nele.
- Cliques concorrentes são bloqueados. Criação de cobrança não tem repetição automática. Uma tentativa com resultado incerto fica bloqueada na mesma aba, inclusive após recarregar, até a situação ser verificada. Sem idempotência documentada pelo provedor ou armazenamento compartilhado, não é possível garantir deduplicação global entre abas/dispositivos.
- A confirmação de pagamento é uma consulta à Black Cat. Entrega do conteúdo e envio de emails são responsabilidade da operação do produto; este repositório não implementa uma área de membros nem dispara emails.
- Fontes servidas pelo próprio site; campos com 16px evitam zoom automático em iOS sem impedir o zoom de acessibilidade.

## Desenvolvimento e verificação

```sh
npm ci
npm test
npm run build
npm run dev
```

Para validar cobranças reais, configure a chave na Vercel e use dados legítimos do comprador. Os testes automatizados usam respostas simuladas; não criam cobranças.

Documentação: https://docs.blackcatoficial.com/
