# Noite de Slides

Site para avaliar apresentações de slides em casa. Os convidados votam pelo celular (nota de 1 a 5 em 5 critérios + comentário), o ranking atualiza ao vivo e o anfitrião controla qual apresentação está aberta para votação.

| Página | Para quem |
|---|---|
| `index.html` | Convidados votam (abre pelo QR code) |
| `resultados.html` | Ranking ao vivo, com **Modo TV** para tela cheia |
| `admin.html` | Anfitrião: cadastra apresentações, abre/fecha votação, QR code, troca de senha |

**Stack:** HTML/CSS/JS puro (sem build) no GitHub Pages + Supabase (Postgres) como banco.

## Segurança
- A chave em `config.js` é a chave **pública** do Supabase, feita para ficar no navegador.
- As tabelas têm RLS: o público só **lê**. Toda escrita passa por funções `security definer`.
- Ações de admin exigem a senha, guardada como hash bcrypt no schema `private` (não exposto pela API).
- Cada celular recebe um `voter_id` aleatório, guardado no navegador: um voto por pessoa por apresentação, e dá pra editar o voto.

## Configurar do zero
1. Crie um projeto no [Supabase](https://supabase.com) e rode `supabase/schema.sql` no SQL Editor.
2. Defina a senha de admin:
   ```sql
   insert into private.admin (id, pin_hash) values (1, extensions.crypt('SUA-SENHA', extensions.gen_salt('bf')))
   on conflict (id) do update set pin_hash = excluded.pin_hash;
   ```
3. Preencha `config.js` com a URL do projeto e a chave anon/publishable.
4. Publique (GitHub Pages: Settings → Pages → branch `main`, pasta `/`).

## Rodar localmente
```sh
npx serve .
```
