import { z } from 'zod';

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

export const FaceResultEventSchema = z.object({
  event_id: z.string().min(1),
  event_type: z.literal('face_result'),
  task_id: z.string().min(1),
  process_type: z.string().min(1),
  status: z.enum(['SUCCESS', 'FAILURE']),
  result: z.record(z.unknown()).optional(),
  user_id: z.string().nullish(),
  camera_id: z.string().nullish(),
  occurred_at: z.string().optional(),
  source: z.string().min(1).default('face-recognition-service'),
});

export type FaceResultEvent = z.infer<typeof FaceResultEventSchema>;

export const AccessStatusSchema = z.enum(ACCESS_STATUSES);
export const AccessTypeSchema = z.enum(['entry', 'exit']);

export const RecognitionEventInputSchema = z.object({
  event_id: z.string().min(1).optional(),
  log_id: z.string().min(1).optional(),
  event_type: z.literal('camera_event').optional(),
  camera_id: z.string().min(1).default('unknown'),
  access_type: AccessTypeSchema.nullish(),
  status: z.union([
    AccessStatusSchema,
    z.literal('success'),
    z.literal('unknown'),
  ]).default('error'),
  patron_id: z.string().min(1).nullish(),
  student_code: z.string().nullish(),
  full_name: z.string().nullish(),
  score: z.number().finite().nullish(),
  confidence: z.number().finite().nullish(),
  bbox: z.unknown().optional(),
  landmarks: z.unknown().optional(),
  occurred_at: z.union([z.string(), z.date()]).optional(),
  source: z.string().min(1).default('face-recognition-service'),
  image_url: z.string().nullish(),
  verify_method: z.string().min(1).optional(),
}).passthrough();

export const AccessRealtimeEventSchema = z.object({
  event_id: z.string().min(1),
  event_type: z.literal('camera_event'),
  camera_id: z.string().min(1),
  access_type: AccessTypeSchema.nullish(),
  status: AccessStatusSchema,
  patron_id: z.string().nullish(),
  student_code: z.string().nullish(),
  full_name: z.string().nullish(),
  score: z.number().finite().nullish(),
  bbox: z.unknown().optional(),
  landmarks: z.unknown().optional(),
  occurred_at: z.string().optional(),
  source: z.string().min(1),
  image_url: z.string().nullish(),
});

export type RecognitionEventInput = z.infer<typeof RecognitionEventInputSchema>;
export type AccessRealtimeEvent = z.infer<typeof AccessRealtimeEventSchema>;
