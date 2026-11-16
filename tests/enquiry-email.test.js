'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
try { process.loadEnvFile('.env'); } catch { /* CI can supply DB_* directly. */ }
const db = require('../server/db.js');
const mailer = require('../server/mailer.js');
const { buildEnquiryEmail } = require('../server/enquiry-email.js');

test('email templates escape customer content and route replies correctly', () => {
  const enquiry = { id: 12, company: '<script>alert(1)</script>', email: 'customer@example.com', phone: '+44123456789', purpose: 'Sampling', message: '<img src=x onerror=alert(1)>' };
  const team = buildEnquiryEmail('team', enquiry);
  assert.equal(team.to, process.env.CONTACT_TO || 'connectfrescony@gmail.com');
  assert.equal(team.replyTo.address, enquiry.email);
  assert.ok(!team.html.includes('<script>'));
  assert.ok(!team.html.includes('<img src=x'));
  const thanks = buildEnquiryEmail('thankyou', enquiry);
  assert.equal(thanks.to, enquiry.email);
  assert.equal(thanks.replyTo, team.to);
  assert.ok(!thanks.html.includes('/admin/'));
  assert.ok(!thanks.subject.includes(`#${enquiry.id}`));
  assert.ok(!thanks.text.includes(`#${enquiry.id}`));
  assert.ok(!thanks.html.includes(`#${enquiry.id}`));
  const overdue = buildEnquiryEmail('overdue', enquiry, 4.5);
  assert.match(overdue.text, /waiting for 4.5 hours/);
  assert.match(overdue.html, /#b91c1c/);
});

test('MySQL queue delivery, retry, deadlines and transactional saving', { skip: !db.isConfigured() }, async (t) => {
  // Connection-local temporary tables shadow the real tables. No customer rows are touched.
  const pool = db.getPool();
  const connection = await pool.getConnection();
  const originalGetPool = db.getPool;
  const originalTransport = mailer.createMailTransport;
  const sent = [];
  let failDelivery = false;
  let failQueue = false;
  const workerPath = require.resolve('../server/enquiry-email.js');
  const enquiriesPath = require.resolve('../server/enquiries.js');
  try {
    await connection.query(`CREATE TEMPORARY TABLE enquiries (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, company VARCHAR(160), email VARCHAR(200),
      phone VARCHAR(32), purpose VARCHAR(80), message TEXT, country_code CHAR(2),
      status VARCHAR(12) DEFAULT 'new', created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, email_status VARCHAR(12) DEFAULT 'pending')`);
    await connection.query(`CREATE TEMPORARY TABLE enquiry_email_settings (
      id TINYINT UNSIGNED PRIMARY KEY, response_hours DECIMAL(7,2) DEFAULT 4, alerts_enabled TINYINT DEFAULT 1)`);
    await connection.query(`CREATE TEMPORARY TABLE enquiry_email_jobs (
      enquiry_id INT UNSIGNED, kind VARCHAR(16), sent_at DATETIME NULL,
      attempts INT DEFAULT 0, next_attempt_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_error VARCHAR(500), PRIMARY KEY(enquiry_id, kind))`);
    const wrapped = {
      query: async (sql, values) => {
        if (failQueue && sql.startsWith('INSERT INTO enquiry_email_jobs')) throw new Error('simulated queue failure');
        return connection.query(sql, values);
      },
      beginTransaction: () => connection.beginTransaction(), commit: () => connection.commit(),
      rollback: () => connection.rollback(), release() {}
    };
    db.getPool = () => ({ query: wrapped.query, getConnection: async () => wrapped });
    mailer.createMailTransport = () => ({
      sendMail: async (email) => { if (failDelivery) throw new Error('simulated SMTP failure'); sent.push(email); }, close() {}
    });
    delete require.cache[workerPath];
    delete require.cache[enquiriesPath];
    const worker = require(workerPath);
    const { saveEnquiry, listFilter } = require(enquiriesPath);
    const customer = { company: 'Queue test', email: 'customer@example.com', phone: '+44123456789', purpose: 'Sampling', message: 'Test' };
    await worker.ensureEmailTables(db.getPool());
    async function reset() {
      await connection.query('DELETE FROM enquiry_email_jobs');
      await connection.query('DELETE FROM enquiries');
      await connection.query('UPDATE enquiry_email_settings SET response_hours = 4, alerts_enabled = 1 WHERE id = 1');
      sent.length = 0;
      failDelivery = false;
    }

    await t.test('saving commits enquiry and both jobs; worker sends each once', async () => {
      await reset();
      const id = await saveEnquiry(customer);
      const [[count]] = await connection.query('SELECT COUNT(*) AS n FROM enquiry_email_jobs WHERE enquiry_id = ?', [id]);
      assert.equal(count.n, 2);
      await worker.wakeEnquiryEmailWorker();
      assert.equal(sent.length, 2);
      assert.ok(sent.some((email) => email.to === customer.email));
      await worker.wakeEnquiryEmailWorker();
      assert.equal(sent.length, 2);
    });
    await t.test('submission confirmation waits for team SMTP success', async () => {
      await reset();
      const id = await saveEnquiry(customer);
      assert.equal(await worker.confirmTeamEmail(id, 2000), true);
      await worker.wakeEnquiryEmailWorker();
      assert.ok(sent.some((email) => email.replyTo?.address === customer.email));
    });
    await t.test('submission confirmation does not report a failed or delayed email as sent', async () => {
      await reset();
      const id = await saveEnquiry(customer);
      failDelivery = true;
      assert.equal(await worker.confirmTeamEmail(id, 2000), false);
      await worker.wakeEnquiryEmailWorker();
      await connection.query('DELETE FROM enquiry_email_jobs');
      await connection.query("UPDATE enquiries SET email_status = 'pending' WHERE id = ?", [id]);
      assert.equal(await worker.confirmTeamEmail(id, 50), false);
      await worker.wakeEnquiryEmailWorker();
      assert.equal(sent.length, 0);
    });
    await t.test('queue failure rolls back the enquiry too', async () => {
      await reset();
      failQueue = true;
      await assert.rejects(saveEnquiry(customer), /queue failure/);
      failQueue = false;
      const [[count]] = await connection.query('SELECT COUNT(*) AS n FROM enquiries');
      assert.equal(count.n, 0);
    });
    await t.test('failed emails remain queued, wait 15 minutes and then retry', async () => {
      await reset();
      await saveEnquiry(customer);
      failDelivery = true;
      await worker.wakeEnquiryEmailWorker();
      const [jobs] = await connection.query('SELECT *, TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), next_attempt_at) AS delay FROM enquiry_email_jobs');
      assert.ok(jobs.every((job) => job.last_error && job.attempts === 1 && !job.sent_at && job.delay >= 895));
      failDelivery = false;
      await worker.wakeEnquiryEmailWorker();
      assert.equal(sent.length, 0);
      await connection.query('UPDATE enquiry_email_jobs SET next_attempt_at = UTC_TIMESTAMP()');
      await worker.wakeEnquiryEmailWorker();
      assert.equal(sent.length, 2);
    });
    await t.test('deadline changes and disabled alerts are respected; contacted enquiries are excluded', async () => {
      await reset();
      const id = await saveEnquiry(customer);
      await worker.wakeEnquiryEmailWorker();
      sent.length = 0;
      await connection.query('UPDATE enquiries SET created_at = TIMESTAMPADD(MINUTE, -30, UTC_TIMESTAMP()) WHERE id = ?', [id]);
      await worker.wakeEnquiryEmailWorker();
      assert.equal(sent.length, 0); // Four-hour default has not elapsed.
      await connection.query('UPDATE enquiry_email_settings SET response_hours = 0.25, alerts_enabled = 0');
      await worker.wakeEnquiryEmailWorker();
      assert.equal(sent.length, 0);
      await connection.query('UPDATE enquiry_email_settings SET alerts_enabled = 1');
      await connection.query("UPDATE enquiries SET status = 'contacted' WHERE id = ?", [id]);
      await worker.wakeEnquiryEmailWorker();
      assert.equal(sent.length, 0);
      await connection.query("UPDATE enquiries SET status = 'new' WHERE id = ?", [id]);
      await worker.wakeEnquiryEmailWorker();
      assert.equal(sent.length, 1);
      assert.match(sent[0].subject, /ACTION REQUIRED/);
      await worker.wakeEnquiryEmailWorker();
      assert.equal(sent.length, 1);
    });
    await t.test('overdue filter selects only waiting enquiries past the configured deadline and supports search', async () => {
      await reset();
      const oldId = await saveEnquiry({ ...customer, company: 'Waiting customer' });
      await connection.query('UPDATE enquiries SET created_at = TIMESTAMPADD(HOUR, -5, UTC_TIMESTAMP()) WHERE id = ?', [oldId]);
      await saveEnquiry({ ...customer, company: 'Recent customer' });
      const contactedId = await saveEnquiry({ ...customer, company: 'Replied customer' });
      await connection.query("UPDATE enquiries SET status = 'contacted', created_at = TIMESTAMPADD(HOUR, -5, UTC_TIMESTAMP()) WHERE id = ?", [contactedId]);
      async function matches(query, settings = { alertsEnabled: true, responseHours: 4 }) {
        const filter = listFilter(query, settings);
        const [rows] = await connection.query(`SELECT e.id FROM enquiries e WHERE ${filter.sql}`, filter.values);
        return rows.map((row) => row.id);
      }
      assert.deepEqual(await matches({ status: 'overdue' }), [oldId]);
      assert.deepEqual(await matches({ status: 'overdue', q: 'Waiting' }), [oldId]);
      assert.deepEqual(await matches({ status: 'overdue', q: 'Recent' }), []);
      assert.deepEqual(await matches({ status: 'overdue' }, { alertsEnabled: true, responseHours: 6 }), []);
      assert.deepEqual(await matches({ status: 'overdue' }, { alertsEnabled: false, responseHours: 4 }), []);
      assert.deepEqual(await matches({ status: 'contacted' }), [contactedId]);
    });
    await t.test('a failed overdue alert stops retrying once marked Contacted', async () => {
      await reset();
      const id = await saveEnquiry(customer);
      await worker.wakeEnquiryEmailWorker();
      sent.length = 0;
      await connection.query('UPDATE enquiries SET created_at = TIMESTAMPADD(HOUR, -5, UTC_TIMESTAMP()) WHERE id = ?', [id]);
      failDelivery = true;
      await worker.wakeEnquiryEmailWorker();
      failDelivery = false;
      await connection.query("UPDATE enquiries SET status = 'contacted' WHERE id = ?", [id]);
      await connection.query('UPDATE enquiry_email_jobs SET next_attempt_at = UTC_TIMESTAMP()');
      await worker.wakeEnquiryEmailWorker();
      assert.equal(sent.length, 0);
    });
  } finally {
    db.getPool = originalGetPool;
    mailer.createMailTransport = originalTransport;
    delete require.cache[workerPath];
    delete require.cache[enquiriesPath];
    // Temporary tables disappear when the physical connection closes.
    connection.destroy();
    await db.closePool();
  }
});
