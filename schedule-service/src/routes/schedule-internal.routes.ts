import { Router, Request, Response } from 'express';
import { scheduleService } from '../services/ScheduleService';
import { config } from '../config';
import { createInternalAuth } from '../../../shared/auth';

const internalAuth = createInternalAuth({
  serviceName: 'schedule-service',
  jwtSecret: config.serviceJwtSecret,
});

const router = Router();
router.use(internalAuth);

router.get('/today', async (req: Request, res: Response) => {
  try {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;

    const staffId = req.query.staffId ? String(req.query.staffId) : undefined;

    const assignments = await scheduleService.listAssignments({
      from: dateStr,
      to: dateStr,
      staffId,
    });

    res.json(assignments);
  } catch (error) {
    console.error('Error fetching today schedule:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/upcoming', internalAuth, async (req: Request, res: Response) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) {
      res.status(400).json({ error: 'Missing from or to query parameter (YYYY-MM-DD)' });
      return;
    }

    const assignments = await scheduleService.listAssignments({
      from: from as string,
      to: to as string,
    });

    res.json(assignments);
  } catch (error) {
    console.error('Error fetching upcoming schedule:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/library-hours', async (_req: Request, res: Response) => {
  try {
    const shifts = await scheduleService.listShifts();
    const activeShifts = (shifts || []).filter((s: any) => s.isActive !== false);

    let weekdayStart = '06:30';
    let weekdayEnd = '21:00';
    let weekendStart = '08:00';
    let weekendEnd = '19:30';

    if (activeShifts.length > 0) {
      const starts = activeShifts.map((s: any) => (s.startTime || '').slice(0, 5)).filter(Boolean).sort();
      const ends = activeShifts.map((s: any) => (s.endTime || '').slice(0, 5)).filter(Boolean).sort();
      if (starts.length > 0) weekdayStart = starts[0];
      if (ends.length > 0) weekdayEnd = ends[ends.length - 1];
    }

    const schedule = [
      {
        days: 'Thứ Hai - Thứ Sáu (Monday - Friday)',
        hours: `${weekdayStart} - ${weekdayEnd}`,
      },
      {
        days: 'Thứ Bảy - Chủ Nhật (Saturday - Sunday)',
        hours: `${weekendStart} - ${weekendEnd}`,
      },
    ];

    const formatted_text = `Thứ Hai - Thứ Sáu: ${weekdayStart} - ${weekdayEnd}\nThứ Bảy - Chủ Nhật: ${weekendStart} - ${weekendEnd}\n(Lưu ý: Giờ mở cửa có thể thay đổi vào ngày lễ và kỳ nghỉ đặc biệt)`;

    res.json({
      schedule,
      shifts: activeShifts.map((s: any) => ({
        name: s.name,
        hours: `${(s.startTime || '').slice(0, 5)} - ${(s.endTime || '').slice(0, 5)}`,
      })),
      note: 'Giờ mở cửa có thể thay đổi vào ngày lễ và kỳ nghỉ đặc biệt',
      formatted_text,
    });
  } catch (error) {
    console.error('Error fetching library hours:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/shifts', async (_req: Request, res: Response) => {
  try {
    const shifts = await scheduleService.listShifts();
    res.json(shifts);
  } catch (error) {
    console.error('Error fetching internal shifts:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/auto-checkout', internalAuth, async (req: Request, res: Response) => {
  try {
    const result = await scheduleService.autoCheckoutStaleAssignments();
    res.json(result);
  } catch (error) {
    console.error('Error auto-checking out stale assignments:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
