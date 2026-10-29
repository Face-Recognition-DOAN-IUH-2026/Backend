/**
 * Local end-to-end test for OUR VietQR transaction-sync endpoint.
 * Exercises the real automatic-settlement path without needing VietQR:
 *   1. POST /borrow/vietqr/token-generate (Basic VIETQR_CALLBACK_USERNAME/PASSWORD)
 *   2. POST /borrow/vietqr/transaction-sync (Bearer) with a bank-like payload
 *
 * Usage:
 *   # settle by VietQR dynamic order id (content == orderId from the QR)
 *   npx ts-node scripts/simulate-vietqr-callback.ts VQRABC123456 50000
 *
 *   # settle a legacy static-QR order by internal order code (content match)
 *   npx ts-node scripts/simulate-vietqr-callback.ts TXN-20261013-def907a9 50000
 *
 * Env (required): VIETQR_CALLBACK_USERNAME, VIETQR_CALLBACK_PASSWORD,
 *   BORROW_SERVICE_URL (default http://localhost:8003)
 */

import http from 'http';
import https from 'https';

function postJson(url: URL, body: any, headers: Record<string, string>): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...headers },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode || 0, data: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode || 0, data: raw });
          }
        });
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function main() {
  const args = process.argv.slice(2);
  const orderRef = args[0];
  const amount = args[1] ? Number(args[1]) : 50000;
  const baseUrl = process.env.BORROW_SERVICE_URL || 'http://localhost:8003';
  const username = process.env.VIETQR_CALLBACK_USERNAME;
  const password = process.env.VIETQR_CALLBACK_PASSWORD;

  if (!orderRef) {
    console.error('Usage: npx ts-node scripts/simulate-vietqr-callback.ts <VIETQR_ORDER_ID|ORDER_CODE> [AMOUNT]');
    process.exit(1);
  }
  if (!username || !password) {
    console.error('Missing VIETQR_CALLBACK_USERNAME / VIETQR_CALLBACK_PASSWORD in env.');
    process.exit(1);
  }

  console.log('======================================================');
  console.log('GIẢ LẬP CALLBACK VIETQR TRANSACTION-SYNC (LOCAL)');
  console.log('======================================================');

  // 1. Get Bearer token like VietQR would
  const basic = Buffer.from(`${username}:${password}`).toString('base64');
  const tokenRes = await postJson(new URL(`${baseUrl}/borrow/vietqr/token-generate`), {}, { Authorization: `Basic ${basic}` });
  console.log(`[1] token-generate -> HTTP ${tokenRes.status}`);
  if (tokenRes.status !== 200 || !tokenRes.data?.access_token) {
    console.error('Token request failed:', tokenRes.data);
    process.exit(1);
  }

  // 2. Fire transaction-sync like VietQR would on a real balance change
  const reference = `SIM-${Date.now()}`;
  const callback = {
    bankaccount: process.env.VIETQR_ACCOUNT_NUMBER || '0395324779',
    amount,
    transType: 'C',
    content: orderRef,
    transactionid: reference,
    transactiontime: Date.now(),
    referencenumber: reference,
    orderId: orderRef,
  };
  const syncRes = await postJson(
    new URL(`${baseUrl}/borrow/vietqr/transaction-sync`),
    callback,
    { Authorization: `Bearer ${tokenRes.data.access_token}` },
  );
  console.log(`[2] transaction-sync -> HTTP ${syncRes.status}`);
  console.dir(syncRes.data, { depth: null });

  // 3. Replay same callback -> must be idempotent (duplicate, no double settle)
  const replayRes = await postJson(
    new URL(`${baseUrl}/borrow/vietqr/transaction-sync`),
    callback,
    { Authorization: `Bearer ${tokenRes.data.access_token}` },
  );
  console.log(`[3] replay same transactionid -> HTTP ${replayRes.status}`);
  console.dir(replayRes.data, { depth: null });
  console.log('======================================================');
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
