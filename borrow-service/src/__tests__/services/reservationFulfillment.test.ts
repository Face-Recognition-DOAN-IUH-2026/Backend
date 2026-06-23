import { checkReservationsOnReturn } from '../../services/reservationFulfillment';
import { AppDataSource } from '../../data-source';

jest.mock('../../data-source');

describe('checkReservationsOnReturn', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('notifies patron when returned book has pending reservation', async () => {
    const mockReservation = {
      id: 'res-1',
      patronId: 'patron-1',
      bookId: 'book-1',
      status: 'pending',
      notifiedAt: null,
    };
    const mockRepo = {
      findOne: jest.fn().mockResolvedValue(mockReservation),
      save: jest.fn().mockResolvedValue(mockReservation),
    };
    (AppDataSource.getRepository as jest.Mock).mockReturnValue(mockRepo);

    await checkReservationsOnReturn('book-1');

    expect(mockRepo.findOne).toHaveBeenCalledWith({
      where: { bookId: 'book-1', status: 'pending' },
      order: { reservedAt: 'ASC' },
    });
    expect(mockReservation.notifiedAt).toBeInstanceOf(Date);
    expect(mockRepo.save).toHaveBeenCalledWith(mockReservation);
  });

  it('does nothing when no reservation exists', async () => {
    const mockRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(),
    };
    (AppDataSource.getRepository as jest.Mock).mockReturnValue(mockRepo);

    await checkReservationsOnReturn('book-1');

    expect(mockRepo.findOne).toHaveBeenCalled();
    expect(mockRepo.save).not.toHaveBeenCalled();
  });

  it('does nothing when no pending reservation found', async () => {
    const mockRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(),
    };
    (AppDataSource.getRepository as jest.Mock).mockReturnValue(mockRepo);

    await checkReservationsOnReturn('book-1');

    expect(mockRepo.findOne).toHaveBeenCalledWith({
      where: { bookId: 'book-1', status: 'pending' },
      order: { reservedAt: 'ASC' },
    });
    expect(mockRepo.save).not.toHaveBeenCalled();
  });
});
