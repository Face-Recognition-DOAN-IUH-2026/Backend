import { HttpError } from '../../../shared/error-handler';
import { PatronSummary } from '../clients/UserServiceClient';

export function patronIdFrom(user: { id?: string } | null | undefined): string {
  if (!user?.id) throw new HttpError(401, 'Invalid or expired token');
  return user.id;
}

export function patronSummary(patron: PatronSummary | any) {
  const id = patron.id;
  const studentCode = patron.student_code || patron.studentCode;
  if (!id || !studentCode) throw new HttpError(502, 'Dữ liệu độc giả không hợp lệ');
  if (!/^[0-9a-f]{32}$/i.test(id.replace(/-/g, ''))) {
    throw new HttpError(502, 'ID độc giả không hợp lệ');
  }
  return {
    id,
    full_name: patron.full_name || patron.fullName || null,
    student_code: studentCode,
    email: patron.email || null,
    card_number: patron.card_number || patron.cardNumber || null,
    current_status: patron.current_status || patron.currentStatus || null,
  };
}
