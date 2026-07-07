import 'reflect-metadata';
import { AppDataSource } from './data-source';
import { LibraryZone } from './entities/LibraryZone';
import { StaffShift } from './entities/StaffShift';

const ZONES_DATA = [
  { floor: 1, zoneName: 'Khu A - Tủ sách tham khảo', description: 'Khu vực tủ sách tham khảo, tài liệu chuyên ngành' },
  { floor: 1, zoneName: 'Khu B - Khu đọc tự do', description: 'Khu vực đọc sách thoải mái, có bàn ghế dài' },
  { floor: 2, zoneName: 'Khu C - Máy tính & Internet', description: 'Khu vực máy tính, truy cập Internet, in ấn' },
  { floor: 2, zoneName: 'Khu D - Sách ngoại văn', description: 'Khu vực sách tiếng Anh, tài liệu quốc tế' },
  { floor: 3, zoneName: 'Khu E - Phòng nghiên cứu', description: 'Phòng nghiên cứu nhóm, bàn thảo luận' },
  { floor: 3, zoneName: 'Khu F - Kho lưu trữ', description: 'Khu vực lưu trữ sách cũ, tạp chí, luận văn' },
];

const SHIFTS_DATA = [
  { name: 'Ca sáng', startTime: '07:00', endTime: '12:00', minStaff: 3, maxStaff: 6 },
  { name: 'Ca chiều', startTime: '12:00', endTime: '17:00', minStaff: 3, maxStaff: 6 },
  { name: 'Ca tối', startTime: '17:00', endTime: '21:00', minStaff: 2, maxStaff: 4 },
  { name: 'Ca cả ngày', startTime: '07:00', endTime: '21:00', minStaff: 2, maxStaff: 3 },
];

async function seed() {
  try {
    await AppDataSource.initialize();
    console.log('[seed] schedule-service Database connected');

    const zoneRepo = AppDataSource.getRepository(LibraryZone);
    const shiftRepo = AppDataSource.getRepository(StaffShift);

    let zonesCreated = 0;
    let zonesSkipped = 0;
    let shiftsCreated = 0;
    let shiftsSkipped = 0;

    // Seed library zones
    for (const data of ZONES_DATA) {
      const existing = await zoneRepo.findOne({ where: { zoneName: data.zoneName } });
      if (existing) {
        console.log(`[seed] Zone already exists: ${data.zoneName}`);
        zonesSkipped++;
        continue;
      }
      await zoneRepo.save(zoneRepo.create({
        floor: data.floor,
        zoneName: data.zoneName,
        description: data.description,
        isActive: true,
      }));
      console.log(`[seed] Created zone: ${data.zoneName}`);
      zonesCreated++;
    }

    // Seed staff shifts
    for (const data of SHIFTS_DATA) {
      const existing = await shiftRepo.findOne({ where: { name: data.name } });
      if (existing) {
        console.log(`[seed] Shift already exists: ${data.name}`);
        shiftsSkipped++;
        continue;
      }
      await shiftRepo.save(shiftRepo.create({
        name: data.name,
        startTime: data.startTime,
        endTime: data.endTime,
        minStaff: data.minStaff,
        maxStaff: data.maxStaff,
        isActive: true,
      }));
      console.log(`[seed] Created shift: ${data.name}`);
      shiftsCreated++;
    }

    console.log(`[seed] Done. Zones: ${zonesCreated} created, ${zonesSkipped} skipped. Shifts: ${shiftsCreated} created, ${shiftsSkipped} skipped.`);
    await AppDataSource.destroy();
    process.exit(0);
  } catch (error) {
    console.error('[seed] Failed:', error);
    process.exit(1);
  }
}

seed();
