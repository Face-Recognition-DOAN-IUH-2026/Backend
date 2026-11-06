import { NotFoundError } from "../../errors";
import { ZoneService } from "../../services/zoneService";
import { LibraryZone } from "../../entities";
import { RedisCacheService } from "../../redis";

jest.mock("../../redis", () => ({
  RedisCacheService: {
    del: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
  },
}));

const mockZoneRepo = {
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
    if (entity === LibraryZone) return mockZoneRepo;
    if (entity.name === "StaffSchedule") return mockScheduleRepo;
    if (entity.name === "StaffScheduleTemplate") return mockTemplateRepo;
    if (entity.name === "ScheduleAuditLog") return mockAuditRepo;
    return {};
  });
  return new ZoneService();
}

beforeEach(() => {
  jest.clearAllMocks();
  (RedisCacheService.del as jest.Mock).mockResolvedValue(undefined);
  (RedisCacheService.get as jest.Mock).mockResolvedValue(undefined);
  (RedisCacheService.set as jest.Mock).mockResolvedValue(undefined);
});

describe("ZoneService", () => {
  it("createZone saves zone, clears cache, logs and returns zone", async () => {
    buildService();
    const actorId = "actor-1";
    const body = { zoneName: "Zone A", floor: 1, isActive: true };
    const savedZone = { id: "z-1", ...body };
    (mockZoneRepo.create as jest.Mock).mockReturnValue(savedZone);
    (mockZoneRepo.save as jest.Mock).mockResolvedValue(savedZone);

    const result = await (buildService() as any).createZone(actorId, body);

    expect(mockZoneRepo.create).toHaveBeenCalledWith(body);
    expect(mockZoneRepo.save).toHaveBeenCalledWith(savedZone);
    expect(RedisCacheService.del).toHaveBeenCalledWith("schedule:zones:list");
    expect(mockAuditRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: "zone.created", entityType: "library_zone", entityId: "z-1", actorId }),
    );
    expect(mockAuditRepo.save).toHaveBeenCalled();
    expect(result).toEqual(savedZone);
  });

  it("listZones returns cached zones when available", async () => {
    const cached = [{ id: "z-1", zoneName: "Cached", floor: 1, isActive: true }];
    (RedisCacheService.get as jest.Mock).mockResolvedValue(cached);
    const svc = buildService();
    const result = await svc.listZones();
    expect(result).toEqual(cached);
    expect(mockZoneRepo.find).not.toHaveBeenCalled();
  });

  it("listZones fetches from db and caches when cache miss", async () => {
    (RedisCacheService.get as jest.Mock).mockResolvedValue(undefined);
    const zones = [{ id: "z-1", zoneName: "A", floor: 1, isActive: true }];
    (mockZoneRepo.find as jest.Mock).mockResolvedValue(zones);
    const svc = buildService();
    const result = await svc.listZones();
    expect(mockZoneRepo.find).toHaveBeenCalledWith({ order: { floor: "ASC", zoneName: "ASC" } });
    expect(RedisCacheService.set).toHaveBeenCalledWith("schedule:zones:list", zones, 3600);
    expect(result).toEqual(zones);
  });

  it("updateZone throws NotFoundError when zone missing", async () => {
    (mockZoneRepo.findOneBy as jest.Mock).mockResolvedValue(null);
    const svc = buildService();
    await expect(svc.updateZone("actor-1", "missing", {})).rejects.toBeInstanceOf(NotFoundError);
  });

  it("updateZone saves zone, clears cache and logs", async () => {
    const existing = { id: "z-1", zoneName: "Old", floor: 1, isActive: true };
    const updated = { ...existing, zoneName: "New" };
    (mockZoneRepo.findOneBy as jest.Mock).mockResolvedValue(existing);
    (mockZoneRepo.save as jest.Mock).mockResolvedValue(updated);
    const svc = buildService();
    const result = await svc.updateZone("actor-1", "z-1", { zoneName: "New" });
    expect(mockZoneRepo.save).toHaveBeenCalledWith(updated);
    expect(RedisCacheService.del).toHaveBeenCalledWith("schedule:zones:list");
    expect(mockAuditRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: "zone.updated", entityType: "library_zone", entityId: "z-1", actorId: "actor-1" }),
    );
    expect(result).toEqual(updated);
  });

  it("deleteZone cancels assignments, deactivates templates, soft-deletes zone and logs", async () => {
    const zone = { id: "z-1", zoneName: "A", floor: 1, isActive: true };
    (mockZoneRepo.findOneBy as jest.Mock).mockResolvedValue(zone);
    (mockScheduleRepo.find as jest.Mock).mockResolvedValue([{ id: "s-1" }]);
    (mockTemplateRepo.findBy as jest.Mock).mockResolvedValue([{ id: "t-1", isActive: true }]);
    (mockTemplateRepo.save as jest.Mock).mockResolvedValue([]);
    const svc = buildService();
    const result = await svc.deleteZone("actor-1", "z-1");
    expect(zone.isActive).toBe(false);
    expect(mockZoneRepo.save).toHaveBeenCalledWith(zone);
    expect(mockScheduleRepo.save).toHaveBeenCalled();
    expect(mockTemplateRepo.save).toHaveBeenCalled();
    expect(RedisCacheService.del).toHaveBeenCalledWith("schedule:zones:list");
    expect(result).toEqual({ deleted: true, id: "z-1", cancelledAssignments: 1 });
  });

  it("deleteZone throws NotFoundError when zone missing", async () => {
    (mockZoneRepo.findOneBy as jest.Mock).mockResolvedValue(null);
    const svc = buildService();
    await expect(svc.deleteZone("actor-1", "missing")).rejects.toBeInstanceOf(NotFoundError);
  });
});
