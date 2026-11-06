import { NotFoundError } from "../../errors";
import { ShiftService } from "../../services/shiftService";
import { StaffShift } from "../../entities";
import { RedisCacheService } from "../../redis";

jest.mock("../../redis", () => ({
  RedisCacheService: {
    del: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
  },
}));

const mockShiftRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findOneBy: jest.fn(),
  find: jest.fn(),
  findBy: jest.fn(),
};
const mockScheduleRepo = {
  find: jest.fn(),
  save: jest.fn(),
};
const mockTemplateRepo = {
  findBy: jest.fn(),
  save: jest.fn(),
};
const mockAuditRepo = {
  create: jest.fn(),
  save: jest.fn(),
};

const mockGetRepository = jest.fn();

jest.mock("../../data-source", () => ({
  AppDataSource: {
    getRepository: (...args: any[]) => mockGetRepository(...args),
  },
}));

function buildService() {
  mockGetRepository.mockImplementation((entity: any) => {
    if (entity === StaffShift) return mockShiftRepo;
    if (entity.name === "StaffSchedule") return mockScheduleRepo;
    if (entity.name === "StaffScheduleTemplate") return mockTemplateRepo;
    if (entity.name === "ScheduleAuditLog") return mockAuditRepo;
    return {};
  });
  return new ShiftService();
}

beforeEach(() => {
  jest.clearAllMocks();
  (RedisCacheService.del as jest.Mock).mockResolvedValue(undefined);
  (RedisCacheService.get as jest.Mock).mockResolvedValue(undefined);
  (RedisCacheService.set as jest.Mock).mockResolvedValue(undefined);
});

describe("ShiftService", () => {
  it("createShift saves shift, clears cache, logs and returns shift", async () => {
    buildService();
    const actorId = "actor-1";
    const body = { name: "Sáng", startTime: "08:00", endTime: "12:00", isActive: true };
    const saved = { id: "sh-1", ...body };
    (mockShiftRepo.create as jest.Mock).mockReturnValue(saved);
    (mockShiftRepo.save as jest.Mock).mockResolvedValue(saved);

    const result = await (buildService() as any).createShift(actorId, body);

    expect(mockShiftRepo.create).toHaveBeenCalledWith(body);
    expect(mockShiftRepo.save).toHaveBeenCalledWith(saved);
    expect(RedisCacheService.del).toHaveBeenCalledWith("schedule:shifts:list");
    expect(mockAuditRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: "shift.created", entityType: "staff_shift", entityId: "sh-1", actorId }),
    );
    expect(result).toEqual(saved);
  });

  it("listShifts returns cached shifts when available", async () => {
    const cached = [{ id: "sh-1", name: "Cached", startTime: "08:00", endTime: "12:00", isActive: true }];
    (RedisCacheService.get as jest.Mock).mockResolvedValue(cached);
    const svc = buildService();
    const result = await svc.listShifts();
    expect(result).toEqual(cached);
    expect(mockShiftRepo.find).not.toHaveBeenCalled();
  });

  it("listShifts fetches from db and caches when cache miss", async () => {
    (RedisCacheService.get as jest.Mock).mockResolvedValue(undefined);
    const shifts = [{ id: "sh-1", name: "Sáng", startTime: "08:00", endTime: "12:00", isActive: true }];
    (mockShiftRepo.find as jest.Mock).mockResolvedValue(shifts);
    const svc = buildService();
    const result = await svc.listShifts();
    expect(mockShiftRepo.find).toHaveBeenCalledWith({ order: { startTime: "ASC" } });
    expect(RedisCacheService.set).toHaveBeenCalledWith("schedule:shifts:list", shifts, 3600);
    expect(result).toEqual(shifts);
  });

  it("updateShift throws NotFoundError when shift missing", async () => {
    (mockShiftRepo.findOneBy as jest.Mock).mockResolvedValue(null);
    const svc = buildService();
    await expect(svc.updateShift("actor-1", "missing", {})).rejects.toBeInstanceOf(NotFoundError);
  });

  it("updateShift saves shift, clears cache and logs", async () => {
    const existing = { id: "sh-1", name: "Old", startTime: "08:00", endTime: "12:00", isActive: true };
    const updated = { ...existing, name: "New" };
    (mockShiftRepo.findOneBy as jest.Mock).mockResolvedValue(existing);
    (mockShiftRepo.save as jest.Mock).mockResolvedValue(updated);
    const svc = buildService();
    const result = await svc.updateShift("actor-1", "sh-1", { name: "New" });
    expect(mockShiftRepo.save).toHaveBeenCalledWith(updated);
    expect(RedisCacheService.del).toHaveBeenCalledWith("schedule:shifts:list");
    expect(mockAuditRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: "shift.updated", entityType: "staff_shift", entityId: "sh-1", actorId: "actor-1" }),
    );
    expect(result).toEqual(updated);
  });

  it("deleteShift cancels assignments, deactivates templates, soft-deletes shift and logs", async () => {
    const shift = { id: "sh-1", name: "Sáng", startTime: "08:00", endTime: "12:00", isActive: true };
    (mockShiftRepo.findOneBy as jest.Mock).mockResolvedValue(shift);
    (mockScheduleRepo.find as jest.Mock).mockResolvedValue([{ id: "s-1" }]);
    (mockTemplateRepo.findBy as jest.Mock).mockResolvedValue([{ id: "t-1", isActive: true }]);
    (mockTemplateRepo.save as jest.Mock).mockResolvedValue([]);
    const svc = buildService();
    const result = await svc.deleteShift("actor-1", "sh-1");
    expect(shift.isActive).toBe(false);
    expect(mockShiftRepo.save).toHaveBeenCalledWith(shift);
    expect(mockScheduleRepo.save).toHaveBeenCalled();
    expect(mockTemplateRepo.save).toHaveBeenCalled();
    expect(RedisCacheService.del).toHaveBeenCalledWith("schedule:shifts:list");
    expect(result).toEqual({ deleted: true, id: "sh-1", cancelledAssignments: 1 });
  });

  it("deleteShift throws NotFoundError when shift missing", async () => {
    (mockShiftRepo.findOneBy as jest.Mock).mockResolvedValue(null);
    const svc = buildService();
    await expect(svc.deleteShift("actor-1", "missing")).rejects.toBeInstanceOf(NotFoundError);
  });
});
