import {
  accessClient,
  borrowClient,
  scheduleClient,
  userClient,
} from '../../clients/serviceClients';
import { accessAnomalyAlert } from '../../handlers/accessAnomalyAlert';
import { bookAvailabilityNotify } from '../../handlers/bookAvailabilityNotify';
import { checkStaffAbsence } from '../../handlers/checkStaffAbsence';
import { membershipExpiryCheck } from '../../handlers/membershipExpiryCheck';
import { recognitionStatsRollup } from '../../handlers/recognitionStatsRollup';
import { shiftReminderNotify } from '../../handlers/shiftReminderNotify';
import { stalePatronCleanup } from '../../handlers/stalePatronCleanup';

describe('cron handlers rethrow swallowed failures (#17)', () => {
  it('stalePatronCleanup throws when active patrons fetch fails', async () => {
    (accessClient.getActivePatrons as jest.Mock) = jest.fn().mockRejectedValue(new Error('access down'));
    await expect(stalePatronCleanup({})).rejects.toThrow('access down');
  });

  it('accessAnomalyAlert throws when active patrons fetch fails', async () => {
    (accessClient.getActivePatrons as jest.Mock) = jest.fn().mockRejectedValue(new Error('access down'));
    await expect(accessAnomalyAlert({})).rejects.toThrow('access down');
  });

  it('checkStaffAbsence throws when schedule fetch fails', async () => {
    (scheduleClient.getTodayAssignments as jest.Mock) = jest.fn().mockRejectedValue(new Error('schedule down'));
    await expect(checkStaffAbsence({})).rejects.toThrow('schedule down');
  });

  it('shiftReminderNotify throws when schedule fetch fails', async () => {
    (scheduleClient as any).getUpcomingAssignments = jest.fn().mockRejectedValue(new Error('schedule down'));
    await expect(shiftReminderNotify({})).rejects.toThrow('schedule down');
  });

  it('membershipExpiryCheck throws when expiring memberships fetch fails', async () => {
    (userClient.getExpiringMemberships as jest.Mock) = jest.fn().mockRejectedValue(new Error('user down'));
    await expect(membershipExpiryCheck({})).rejects.toThrow('user down');
  });

  it('bookAvailabilityNotify throws when waitlist fetch fails', async () => {
    (borrowClient as any).getWaitlistByBook = jest.fn().mockRejectedValue(new Error('borrow down'));
    await expect(
      bookAvailabilityNotify({}, { type: 'book.returned', payload: { bookId: 'b1' } } as any)
    ).rejects.toThrow('borrow down');
  });

  it('recognitionStatsRollup throws instead of returning success:false', async () => {
    (accessClient as any).rollupRecognition = jest.fn().mockRejectedValue(new Error('Connection refused'));
    await expect(recognitionStatsRollup({})).rejects.toThrow('Connection refused');
  });
});
