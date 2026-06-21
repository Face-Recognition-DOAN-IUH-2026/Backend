const http = require('http');

function createNotification(userId, type, title, body, data) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ userId, type, title, body, data });
    const req = http.request({
      hostname: 'localhost',
      port: 3006,
      path: '/internal/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-api-key': 'borrow-internal-secret-key-change-in-production',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        console.log(`${type} -> ${res.statusCode}: ${body.substring(0, 80)}`);
        resolve();
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function main() {
  // 1. Admin: daily report
  await createNotification(
    '266a128d-bafa-4a2b-873c-be1e5753cf79',
    'daily_report',
    'Bao cao hang ngay - 2026-06-21',
    'Thong ke thu vien ngay 2026-06-21. Luu luong truy cap: 12. Muon tra: 28. Nhan vien: 3.',
    { date: '2026-06-21', activeInside: 12, activeBorrowers: 28 }
  );

  // 2. Patron: overdue reminder
  await createNotification(
    '5adf3a3e-39ff-4952-a640-6dc7f46d417f',
    'borrow_overdue',
    'Sach qua han',
    'Ban, cuon "Lap trinh NodeJS" da qua han 3 ngay. Vui long tra sach som.',
    { bookId: 'test-book-1', daysOverdue: 3 }
  );

  // 3. Staff: schedule change
  await createNotification(
    'afeb0cc3-e197-4ec7-a683-7541c9bb6ec7',
    'schedule_change',
    'Thay doi lich truc',
    'Lich truc ngay 2026-06-22 da thay doi. Ca moi: Sang (7h-11h).',
    { changeType: 'swap', workDate: '2026-06-22' }
  );

  // 4. Patron: book available
  await createNotification(
    '5adf3a3e-39ff-4952-a640-6dc7f46d417f',
    'book_available',
    'Sach da co san',
    'Cuon "Database Design" da duoc tra. Ban co the muon ngay!',
    { bookId: 'test-book-2' }
  );

  // 5. Patron: membership expiry
  await createNotification(
    '5adf3a3e-39ff-4952-a640-6dc7f46d417f',
    'membership_expiry',
    'The thu vien sap het han',
    'The thu vien cua ban se het han ngay 30/06/2026.',
    { expiryDate: '2026-06-30', daysLeft: 9 }
  );

  // 6. Admin: anomaly alert
  await createNotification(
    '266a128d-bafa-4a2b-873c-be1e5753cf79',
    'anomaly_alert',
    'Canh bao: 2 nguoi trong thu vien',
    'Phat hien 2 nguoi trong thu vien ngoai gio lam viec.',
    { patrons: [], hour: 23 }
  );

  console.log('All test notifications created!');
}

main().catch(console.error);
