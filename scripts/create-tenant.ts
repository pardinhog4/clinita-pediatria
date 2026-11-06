import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { pool, query, transaction } from '../src/lib/db';
import { hashPassword, passwordRule, strongEnough } from '../src/lib/password';
import { provisionTenant } from '../src/server/provisioning';

// Cria a clínica e a conta inicial da direção (com a senha escolhida aqui).
// O resto (unidades, salas, profissionais, convênios, pacientes, usuários) é feito pela plataforma.
//
// Uso interativo (pergunta tudo; a senha não aparece na tela):
//   npm run clinica:criar
// Sem perguntas (ex.: servidor), a senha vem de CLINIC_ADMIN_PASSWORD:
//   npm run clinica:criar -- --nome "Clínica X" --unidade "Matriz" --direcao "Maria Souza" --email maria@clinica.com.br
// Por segurança, se já existir uma clínica, só cria outra com --outra-clinica.

function arg(name: string) {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

/** Lê a senha sem mostrar o que é digitado. */
function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const onData = (ch: string) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (c === '\u0003') process.exit(130); // Ctrl+C
        if (c === '\u0008' || c === '\u007f') value = value.slice(0, -1);
        else value += c;
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  const interactive = process.stdin.isTTY && !arg('email');
  const rl = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  const ask = async (q: string, fallback = '') => {
    if (!rl) return fallback;
    const a = (await rl.question(q + (fallback ? ` [${fallback}]` : '') + ': ')).trim();
    return a || fallback;
  };

  const [{ n }] = await query<{ n: number }>(
    'SELECT count(*)::int AS n FROM tenants WHERE demo_admin_user_id IS NULL',
  );
  if (n && !process.argv.includes('--outra-clinica'))
    throw new Error(
      `Já existe ${n} clínica cadastrada. Novas pessoas e unidades entram pela plataforma (Usuários e acessos, Configurações → Unidades).\nPara criar outra clínica separada, rode de novo com --outra-clinica.`,
    );

  console.log('\nCadastro da clínica e da conta inicial da direção\n');
  const name = arg('nome') || (await ask('Nome da clínica'));
  const unit = arg('unidade') || (await ask('Primeira unidade', 'Matriz'));
  const adminName = arg('direcao') || (await ask('Nome da pessoa da direção'));
  const email = arg('email') || (await ask('E-mail de acesso da direção'));
  rl?.close();

  let password = process.env.CLINIC_ADMIN_PASSWORD || '';
  if (interactive) {
    password = await askHidden(`Senha (${passwordRule.toLowerCase()}): `);
    const confirm = await askHidden('Confirme a senha: ');
    if (password !== confirm) throw new Error('A confirmação não corresponde à senha.');
  }
  if (!password)
    throw new Error(
      'Defina CLINIC_ADMIN_PASSWORD ao rodar sem perguntas (a senha não vai na linha de comando).',
    );
  if (!strongEnough(password)) throw new Error(passwordRule);
  const passwordHash = await hashPassword(password);

  const r = await transaction(async (c) => {
    const created = await provisionTenant(c, {
      name,
      units: [unit],
      admin: { name: adminName, email },
    });
    // A direção já escolheu a senha aqui: não precisa trocar no primeiro acesso.
    await c.query(
      'UPDATE users SET password_hash=$2,must_change_password=false,password_changed_at=now() WHERE id=$1',
      [created.adminId, passwordHash],
    );
    return created;
  });
  console.log(
    `\nClínica "${name}" criada com a unidade "${unit}".` +
      `\nEntre em ${process.env.APP_ORIGIN || 'http://localhost:3005'}/login com ${r.adminEmail} e a senha escolhida.` +
      '\nPróximos passos na plataforma: Configurações (unidades, salas, horários, importar dados) e Usuários e acessos.',
  );
}

main()
  .catch((e) => {
    console.error(
      '\n' +
        (e.issues
          ? e.issues.map((i: any) => i.path.join('.') + ': ' + i.message).join('\n')
          : e.message),
    );
    process.exitCode = 1;
  })
  .finally(() => pool.end());
