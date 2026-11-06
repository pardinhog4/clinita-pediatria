import 'dotenv/config';
import { defineConfig } from '@playwright/test';
// Testes de navegador em servidor e banco próprios: porta 3006, banco TEST_DATABASE_URL recriado com a clínica fictícia de teste.
// O servidor de desenvolvimento (3005) e o banco do dia a dia não são tocados.
// Roda sobre um build de produção: compila uma vez (testes rápidos e estáveis) e valida os tipos das rotas.
const port = 3006,
  origin = `http://localhost:${port}`;
process.env.APP_ORIGIN = origin;
export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  fullyParallel: false,
  timeout: 120000,
  expect: { timeout: 20000 },
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL: origin,
    headless: true,
    viewport: { width: 1440, height: 1000 },
    launchOptions: { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' },
    trace: 'retain-on-failure',
  },
  reporter: 'list',
  webServer: {
    command: `npx next build && npx next start -H 127.0.0.1 -p ${port}`,
    url: origin + '/login',
    reuseExistingServer: false,
    timeout: 600000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL || '',
      APP_ORIGIN: origin,
      NEXT_DIST_DIR: '.next-e2e',
    },
  },
});
