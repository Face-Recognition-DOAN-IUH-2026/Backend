export const ACTIVE_CAMERA_IDS = ['entry_gate', 'exit_gate', 'kiosk'] as const;
export const ACCESS_STATUSES = [
  'granted',
  'no_match',
  'spoof',
  'expired',
  'wrong_direction',
  'already_granted',
  'error',
] as const;

export type AccessStatus = (typeof ACCESS_STATUSES)[number];
export type AccessType = 'entry' | 'exit';

export interface AccessRealtimeEvent {
  event_id: string;
  event_type: 'camera_event';
  camera_id: string;
  access_type?: AccessType | null;
  status: AccessStatus;
  patron_id?: string | null;
  student_code?: string | null;
  full_name?: string | null;
  score?: number | null;
  bbox?: unknown;
  landmarks?: unknown;
  occurred_at: string;
  source: string;
  image_url?: string | null;
}
