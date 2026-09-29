export async function expireWaitlistNotifications(
  _cfg: Record<string, any>,
  _event?: any
): Promise<any> {
  return { expired: 0, advanced: 0, message: 'Deprecated: FIFO waitlist reservation hold replaced by availability alerts' };
}
