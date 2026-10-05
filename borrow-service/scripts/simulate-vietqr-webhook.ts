/**
 * Sandbox VietQR Payment Simulator CLI
 * 
 * Usage:
 *   npx ts-node scripts/simulate-vietqr-webhook.ts <ORDER_CODE> [AMOUNT] [GATEWAY_URL]
 * 
 * Example:
 *   npx ts-node scripts/simulate-vietqr-webhook.ts TXN-20261005-ABCD1234 35000
 */

import crypto from 'crypto';
import http from 'http';
import https from 'https';

async function main() {
  const args = process.argv.slice(2);
  const orderCode = args[0];
  const amount = args[1] ? Number(args[1]) : 50000;
  const baseUrl = args[2] || process.env.BORROW_SERVICE_URL || 'http://localhost:8003';
  const secretKey = process.env.PAYOS_CHECKSUM_KEY || process.env.PAYMENT_WEBHOOK_SECRET || 'test-secret-key';

  if (!orderCode) {
    console.error('❌ Vui lòng cung cấp mã đơn hàng (orderCode).');
    console.log('Cách dùng: npx ts-node scripts/simulate-vietqr-webhook.ts <ORDER_CODE> [AMOUNT]');
    process.exit(1);
  }

  console.log(`\n======================================================`);
  console.log(`🏦 GIẢ LẬP THANH TOÁN VIETQR SANDBOX - THƯ VIỆN IUH`);
  console.log(`======================================================`);
  console.log(`📌 Mã đơn hàng (orderCode) : ${orderCode}`);
  console.log(`💰 Số tiền giao dịch        : ${amount.toLocaleString('vi-VN')} VND`);
  console.log(`🌐 Endpoint nhận webhook   : ${baseUrl}/borrow/payments/webhook`);

  const payload = {
    code: '00',
    desc: 'success',
    data: {
      orderCode,
      amount,
      description: orderCode,
      accountNumber: '1133669988',
      reference: `SANDBOX-FT-${Date.now()}`,
      transactionDateTime: new Date().toISOString(),
      currency: 'VND',
      paymentLinkId: `LINK-${Date.now()}`,
      code: '00',
      desc: 'Thanh toán phí thư viện IUH thành công',
    },
    signature: '',
  };

  const raw = JSON.stringify(payload);
  const signature = crypto.createHmac('sha256', secretKey).update(raw).digest('hex');
  payload.signature = signature;

  const bodyData = JSON.stringify(payload);
  const url = new URL(`${baseUrl}/borrow/payments/webhook`);

  const isHttps = url.protocol === 'https:';
  const client = isHttps ? https : http;

  const req = client.request(
    {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyData),
        'x-signature': signature,
      },
    },
    (res) => {
      let responseBody = '';
      res.on('data', (chunk) => {
        responseBody += chunk;
      });
      res.on('end', () => {
        console.log(`\n📡 HTTP Status: ${res.statusCode} ${res.statusMessage}`);
        try {
          const parsed = JSON.parse(responseBody);
          console.log('📦 Kết quả phản hồi:');
          console.dir(parsed, { depth: null, colors: true });

          if (res.statusCode === 200 && parsed.success) {
            console.log('\n✅ [THÀNH CÔNG] Đơn thanh toán đã được gạch nợ thành công!');
            if (parsed.activatedPatrons && parsed.activatedPatrons.length > 0) {
              console.log(`🔓 Thẻ thư viện của độc giả [${parsed.activatedPatrons.join(', ')}] đã được tự động mở khóa.`);
            }
          } else {
            console.error('\n⚠️ [LỖI] Webhook bị từ chối hoặc thất bại:', parsed.detail || responseBody);
          }
        } catch {
          console.log('Phản hồi thô:', responseBody);
        }
        console.log(`======================================================\n`);
      });
    },
  );

  req.on('error', (err) => {
    console.error('\n❌ Không thể kết nối tới máy chủ:', err.message);
    console.log('💡 Hãy đảm bảo borrow-service đang chạy trên', baseUrl);
    console.log(`======================================================\n`);
  });

  req.write(bodyData);
  req.end();
}

if (require.main === module) {
  main().catch(console.error);
}
