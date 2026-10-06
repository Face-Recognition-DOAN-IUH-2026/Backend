const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

async function generate100Patrons() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Smart Library System';
  workbook.created = new Date();

  const ws = workbook.addWorksheet('Danh Sách Độc Giả', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  const columns = [
    { header: 'Mã sinh viên*', key: 'student_code', width: 18 },
    { header: 'Họ và tên*', key: 'full_name', width: 28 },
    { header: 'Lớp', key: 'class_name', width: 16 },
    { header: 'Khóa học / Niên khóa', key: 'course', width: 22 },
    { header: 'Email', key: 'email', width: 32 },
    { header: 'Số điện thoại', key: 'phone', width: 18 },
    { header: 'CCCD/CMND', key: 'identity_number', width: 20 },
    { header: 'Hạn thẻ (YYYY-MM-DD)', key: 'membership_expiry', width: 22 },
  ];

  ws.columns = columns;

  // Header styling
  const headerRow = ws.getRow(1);
  headerRow.height = 28;
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: '0F52BA' },
    };
    cell.font = {
      name: 'Segoe UI',
      bold: true,
      color: { argb: 'FFFFFF' },
      size: 11,
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      top: { style: 'thin', color: { argb: 'CCCCCC' } },
      bottom: { style: 'medium', color: { argb: '083159' } },
      left: { style: 'thin', color: { argb: 'CCCCCC' } },
      right: { style: 'thin', color: { argb: 'CCCCCC' } },
    };
  });

  const hoList = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Phan', 'Vũ', 'Võ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương'];
  const demList = ['Văn', 'Thị', 'Hữu', 'Đức', 'Quốc', 'Minh', 'Thanh', 'Gia', 'Hoàng', 'Xuân', 'Kim', 'Ngọc', 'Đình', 'Bảo', 'Anh'];
  const tenList = [
    'An', 'Bình', 'Cường', 'Dũng', 'Em', 'Giang', 'Hải', 'Huy', 'Khoa', 'Linh',
    'Long', 'Minh', 'Nam', 'Nghĩa', 'Phúc', 'Quân', 'Sơn', 'Tâm', 'Thắng', 'Thảo',
    'Thịnh', 'Trang', 'Trí', 'Trung', 'Tú', 'Tuấn', 'Tùng', 'Uyên', 'Việt', 'Vinh'
  ];

  const classList = ['DHKTPM18A', 'DHKTPM18B', 'DHCNTT18A', 'DHCNTT18B', 'DHKHDL18A', 'DHQTKD19A', 'DHQTKD19B', 'DHTD18A', 'DHTM18A'];

  for (let i = 1; i <= 100; i++) {
    const studentCode = `22${String(680000 + i).padStart(6, '0')}`;
    const ho = hoList[i % hoList.length];
    const dem = demList[(i * 3) % demList.length];
    const ten = tenList[(i * 7) % tenList.length];
    const fullName = `${ho} ${dem} ${ten}`;
    const className = classList[i % classList.length];
    const course = i % 3 === 0 ? '2023-2027' : '2022-2026';
    // Let 10% have empty email to test auto-generation
    const email = i % 10 === 0 ? '' : `${studentCode}@student.iuh.edu.vn`;
    const phone = `09${String(10000000 + i * 37).padStart(8, '0')}`.slice(0, 10);
    const identityNumber = `079204${String(100000 + i).padStart(6, '0')}`;
    const expiry = i % 4 === 0 ? '' : (course === '2023-2027' ? '2027-09-01' : '2026-09-01');

    const addedRow = ws.addRow([
      studentCode,
      fullName,
      className,
      course,
      email,
      phone,
      identityNumber,
      expiry,
    ]);

    addedRow.height = 22;
    addedRow.eachCell((cell, colNumber) => {
      cell.font = { name: 'Segoe UI', size: 10 };
      cell.alignment = {
        vertical: 'middle',
        horizontal: colNumber === 2 ? 'left' : 'center',
      };
      cell.border = {
        top: { style: 'thin', color: { argb: 'E0E0E0' } },
        bottom: { style: 'thin', color: { argb: 'E0E0E0' } },
        left: { style: 'thin', color: { argb: 'E0E0E0' } },
        right: { style: 'thin', color: { argb: 'E0E0E0' } },
      };
    });
  }

  const outPath1 = path.resolve(__dirname, '../../patron_test_100.xlsx');
  const outPath2 = path.resolve(__dirname, '../../Frontend_Web/public/patron_test_100.xlsx');

  await workbook.xlsx.writeFile(outPath1);
  console.log(`Saved 100 patrons to: ${outPath1}`);

  if (fs.existsSync(path.dirname(outPath2))) {
    await workbook.xlsx.writeFile(outPath2);
    console.log(`Saved 100 patrons to: ${outPath2}`);
  }
}

generate100Patrons().catch(console.error);
