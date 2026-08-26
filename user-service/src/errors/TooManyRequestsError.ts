import { AppError } from './AppError';

export class TooManyRequestsError extends AppError {
  constructor(message: string = 'Quá nhiều yêu cầu, vui lòng thử lại sau') {
    super(message, 429);
  }
}
