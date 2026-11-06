import { resetTestDatabase } from './test-db';
// Recria o banco de testes. Com --demo, carrega também a clínica de demonstração.
resetTestDatabase({ demo: process.argv.includes('--demo') })
  .then(() => console.log('Banco de testes recriado.'))
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
