const fs = require('node:fs');
const crypto = require('node:crypto');
if (fs.existsSync('.env')) {
  console.log('.env existente preservado.');
  process.exit(0);
}
const password = crypto.randomBytes(24).toString('hex');
fs.writeFileSync(
  '.env',
  `DATABASE_URL=postgresql://integrar:${password}@127.0.0.1:5547/integrar\nTEST_DATABASE_URL=postgresql://integrar:${password}@127.0.0.1:5547/integrar_test\nPOSTGRES_PASSWORD=${password}\nACCESS_TOKEN_SECRET=${crypto.randomBytes(48).toString('base64url')}\nREFRESH_TOKEN_SECRET=${crypto.randomBytes(48).toString('base64url')}\nAPP_ORIGIN=http://localhost:3005\nDATABASE_SSL=false\n`,
);
console.log('.env criado com credenciais aleatórias.');
