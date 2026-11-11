'use strict';

// npm run db:check — tests the database connection from wherever the website runs (e.g. Hostinger).
// Shows this server's public IP (the address your MySQL firewall must allow), then connects with the
// DB_* settings and reports encryption, speed and the tables found. Changes nothing.

const path = require('path');

try { process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch { /* no .env file */ }

const { getPool, closePool, isConfigured } = require('../server/db.js');

const HINTS = {
  ETIMEDOUT: 'No answer from the database server. Check the router port-forward (public 3306 -> the MySQL machine) and that the firewall allows this server\'s IP (shown above). Some hosts also block outgoing port 3306; ask them.',
  ECONNREFUSED: 'The address answered but nothing is listening on that port. Check DB_HOST/DB_PORT and that MySQL listens on the network (bind-address).',
  ENOTFOUND: 'DB_HOST is not a known hostname. Check the spelling, or use the IP address.',
  ER_ACCESS_DENIED_ERROR: 'Wrong user or password, or this user may not connect from this server\'s IP. Check DB_USER/DB_PASSWORD and the user\'s allowed host in MySQL.',
  ER_HOST_NOT_PRIVILEGED: 'MySQL refuses connections from this server\'s IP. Create the user for this IP (see DEPLOYMENT.md, "Database on your own server").',
  ER_DBACCESS_DENIED_ERROR: 'The user exists but has no rights on DB_NAME. GRANT it access to that database.',
  ER_BAD_DB_ERROR: 'The database named in DB_NAME does not exist on that server.',
  HANDSHAKE_SSL_ERROR: 'The encrypted connection failed. Check DB_SSL_CA points to the server\'s ca.pem, or that MySQL has SSL enabled.',
  ER_SECURE_TRANSPORT_REQUIRED: 'The server requires encryption: set DB_SSL=true.'
};

async function publicIp() {
  try {
    const response = await fetch('https://api.ipify.org', { signal: AbortSignal.timeout(8000) });
    return (await response.text()).trim();
  } catch {
    return 'unknown (no internet access?)';
  }
}

async function main() {
  console.log(`This server's public IP: ${await publicIp()}   <- the MySQL firewall / user must allow this address`);
  if (!isConfigured()) throw Object.assign(new Error('Set DB_HOST, DB_USER and DB_NAME first.'), { code: 'CONFIG' });
  console.log(`Connecting to ${process.env.DB_HOST}:${process.env.DB_PORT || 3306} as ${process.env.DB_USER}, database ${process.env.DB_NAME} ...`);

  const pool = getPool();
  const started = Date.now();
  const [[server]] = await pool.query("SELECT VERSION() AS version, CURRENT_USER() AS user");
  const firstMs = Date.now() - started;
  const [[ssl]] = await pool.query("SHOW SESSION STATUS LIKE 'Ssl_cipher'");
  const times = [];
  for (let i = 0; i < 5; i += 1) {
    const t = Date.now();
    await pool.query('SELECT 1');
    times.push(Date.now() - t);
  }
  const [tables] = await pool.query('SHOW TABLES');

  console.log(`Connected: MySQL ${server.version} as ${server.user} (first connection ${firstMs} ms)`);
  console.log(`Encryption: ${ssl && ssl.Value ? `yes (${ssl.Value})` : 'NO — set DB_SSL=true when the database is reached over the internet'}`);
  console.log(`Speed: about ${Math.round(times.reduce((a, b) => a + b, 0) / times.length)} ms per query`);
  console.log(`Tables in ${process.env.DB_NAME}: ${tables.length ? tables.map((t) => Object.values(t)[0]).join(', ') : 'none yet — run npm run db:setup'}`);
}

main()
  .catch((error) => {
    console.error(`Database check failed: ${error.code || ''} ${error.message}`);
    if (HINTS[error.code]) console.error(HINTS[error.code]);
    process.exitCode = 1;
  })
  .finally(() => closePool());
