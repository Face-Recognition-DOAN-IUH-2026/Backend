import { NotFoundError } from "../../errors";
import { PreferenceService } from "../../services/preferenceService";
import { StaffShiftPreference } from "../../entities";

const mockPreferenceRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findOneBy: jest.fn(),
  find: jest.fn(),
  findAndCount: jest.fn(),
};
const mockShiftRepo = {
  findBy: jest.fn(),
};
const mockZoneRepo = {
  findBy: jest.fn(),
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
    if (entity === StaffShiftPreference) return mockPreferenceRepo;
    if (entity.name === "StaffShift") return mockShiftRepo;
    if (entity.name === "LibraryZone") return mockZoneRepo;
    if (entity.name === "ScheduleAuditLog") return mockAuditRepo;
    return {};
  });
  return new PreferenceService();
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("PreferenceService", () => {
  it("listPreferences paginates and enriches items with shift & zone", async () => {
    const items = [
      { id: "p-1", staffId: "s-1", shiftId: "sh-1", zoneId: "z-1", priority: 1, isActive: true },
    ];
    const shifts = [{ id: "sh-1", name: "Sáng" }];
    const zones = [{ id: "z-1", zoneName: "Khu A" }];
    (mockPreferenceRepo.findAndCount as jest.Mock).mockResolvedValue([items, 1]);
    (mockShiftRepo.findBy as jest.Mock).mockResolvedValue(shifts);
    (mockZoneRepo.findBy as jest.Mock).mockResolvedValue(zones);

    const svc = buildService();
    const result = await svc.listPreferences("s-1", 1, 50);

    expect(mockPreferenceRepo.findAndCount).toHaveBeenCalledWith({
      where: { isActive: true, staffId: "s-1" },
      order: { priority: "ASC", createdAt: "DESC" },
      skip: 0,
      take: 50,
    });
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(50);
    expect(result.items[0].shift).toEqual(shifts[0]);
    expect(result.items[0].zone).toEqual(zones[0]);
  });

  it("createPreference creates when not existing and logs", async () => {
    (mockPreferenceRepo.findOneBy as jest.Mock).mockResolvedValue(null);
    const pref = { id: "p-1", staffId: "s-1", shiftId: "sh-1", zoneId: "z-1", priority: 2, isActive: true };
    (mockPreferenceRepo.create as jest.Mock).mockReturnValue(pref);
    (mockPreferenceRepo.save as jest.Mock).mockResolvedValue(pref);

    const svc = buildService();
    const result = await svc.createPreference("actor-1", { staffId: "s-1", shiftId: "sh-1", zoneId: "z-1", priority: 2 });

    expect(mockPreferenceRepo.create).toHaveBeenCalledWith({ staffId: "s-1", shiftId: "sh-1", zoneId: "z-1", priority: 2 });
    expect(mockPreferenceRepo.save).toHaveBeenCalledWith(pref);
    expect(mockAuditRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: "preference.created", entityType: "staff_shift_preference", entityId: "p-1" }),
    );
    expect(result).toEqual(pref);
  });

  it("createPreference updates existing (upsert) and logs preference.updated", async () => {
    const existing = { id: "p-1", staffId: "s-1", shiftId: "sh-1", zoneId: "z-1", priority: 1, isActive: false };
    (mockPreferenceRepo.findOneBy as jest.Mock).mockResolvedValue(existing);
    (mockPreferenceRepo.save as jest.Mock).mockResolvedValue({ ...existing, priority: 3, isActive: true });

    const svc = buildService();
    const result = await svc.createPreference("actor-1", { staffId: "s-1", shiftId: "sh-1", zoneId: "z-1", priority: 3 });

    expect(existing.priority).toBe(3);
    expect(existing.isActive).toBe(true);
    expect(mockAuditRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: "preference.updated", entityType: "staff_shift_preference", entityId: "p-1" }),
    );
    expect(result.priority).toBe(3);
  });

  it("deletePreference soft-deletes and logs", async () => {
    const pref = { id: "p-1", isActive: true };
    (mockPreferenceRepo.findOneBy as jest.Mock).mockResolvedValue(pref);
    const svc = buildService();
    const result = await svc.deletePreference("actor-1", "p-1");
    expect(pref.isActive).toBe(false);
    expect(mockPreferenceRepo.save).toHaveBeenCalledWith(pref);
    expect(mockAuditRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: "preference.deactivated", entityType: "staff_shift_preference", entityId: "p-1" }),
    );
    expect(result).toEqual({ deleted: true, id: "p-1" });
  });

  it("deletePreference throws NotFoundError when missing", async () => {
    (mockPreferenceRepo.findOneBy as jest.Mock).mockResolvedValue(null);
    const svc = buildService();
    await expect(svc.deletePreference("actor-1", "missing")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("getPreferencesForStaff returns active prefs ordered by priority", async () => {
    const prefs = [{ id: "p-1", priority: 1 }];
    (mockPreferenceRepo.find as jest.Mock).mockResolvedValue(prefs);
    const svc = buildService();
    const result = await svc.getPreferencesForStaff("s-1");
    expect(mockPreferenceRepo.find).toHaveBeenCalledWith({ where: { staffId: "s-1", isActive: true }, order: { priority: "ASC" } });
    expect(result).toEqual(prefs);
  });

  it("getPreferenceById returns pref or null", async () => {
    const pref = { id: "p-1" };
    (mockPreferenceRepo.findOneBy as jest.Mock).mockResolvedValueOnce(pref).mockResolvedValueOnce(null);
    const svc = buildService();
    expect(await svc.getPreferenceById("p-1")).toEqual(pref);
    expect(await svc.getPreferenceById("missing")).toBeNull();
  });
});
