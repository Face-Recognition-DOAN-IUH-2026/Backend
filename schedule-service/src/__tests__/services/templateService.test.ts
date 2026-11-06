import { NotFoundError } from "../../errors";
import { TemplateService } from "../../services/templateService";
import { StaffScheduleTemplate } from "../../entities";
import { RedisCacheService } from "../../redis";

jest.mock("../../redis", () => ({
  RedisCacheService: {
    del: jest.fn(),
  },
}));

const mockTemplateRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findOneBy: jest.fn(),
  find: jest.fn(),
  findBy: jest.fn(),
};
const mockShiftRepo = {
  findOneBy: jest.fn(),
};
const mockZoneRepo = {
  findOneBy: jest.fn(),
};
const mockAuditRepo = {
  create: jest.fn(),
  save: jest.fn(),
};

const mockUsers = {
  requireActiveStaff: jest.fn(),
};

const mockGetRepository = jest.fn();

jest.mock("../../data-source", () => ({
  AppDataSource: {
    getRepository: (...args: any[]) => mockGetRepository(...args),
  },
}));

function buildService() {
  mockGetRepository.mockImplementation((entity: any) => {
    if (entity === StaffScheduleTemplate) return mockTemplateRepo;
    if (entity.name === "StaffShift") return mockShiftRepo;
    if (entity.name === "LibraryZone") return mockZoneRepo;
    if (entity.name === "ScheduleAuditLog") return mockAuditRepo;
    return {};
  });
  return new TemplateService(mockUsers as any);
}

let svc: ReturnType<typeof buildService>;

beforeEach(() => {
  jest.clearAllMocks();
  (RedisCacheService.del as jest.Mock).mockResolvedValue(undefined);
  svc = buildService();
});

describe("TemplateService", () => {
  it("createTemplate validates targets then saves, logs and returns template", async () => {
    buildService();
    const actorId = "actor-1";
    const body = { staffId: "s-1", shiftId: "sh-1", zoneId: "z-1", name: "Tpl", dayOfWeek: 1, isActive: true };
    const saved = { id: "t-1", ...body };
    (mockUsers.requireActiveStaff as jest.Mock).mockResolvedValue(undefined);
    (mockShiftRepo.findOneBy as jest.Mock).mockResolvedValue({ id: "sh-1" });
    (mockZoneRepo.findOneBy as jest.Mock).mockResolvedValue({ id: "z-1" });
    (mockTemplateRepo.create as jest.Mock).mockReturnValue(saved);
    (mockTemplateRepo.save as jest.Mock).mockResolvedValue(saved);

    const result = await svc.createTemplate(actorId, body);

    expect(mockUsers.requireActiveStaff).toHaveBeenCalledWith("s-1");
    expect(mockShiftRepo.findOneBy).toHaveBeenCalledWith({ id: "sh-1", isActive: true });
    expect(mockZoneRepo.findOneBy).toHaveBeenCalledWith({ id: "z-1", isActive: true });
    expect(mockTemplateRepo.create).toHaveBeenCalledWith(body);
    expect(mockTemplateRepo.save).toHaveBeenCalledWith(saved);
    expect(mockAuditRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: "template.created", entityType: "staff_schedule_template", entityId: "t-1", actorId }),
    );
    expect(result).toEqual(saved);
  });

  it("listTemplates returns active templates ordered", async () => {
    const templates = [{ id: "t-1", name: "Tpl", dayOfWeek: 1, isActive: true }];
    (mockTemplateRepo.find as jest.Mock).mockResolvedValue(templates);
    const svc = buildService();
    const result = await svc.listTemplates();
    expect(mockTemplateRepo.find).toHaveBeenCalledWith({ where: { isActive: true }, order: { dayOfWeek: "ASC", createdAt: "DESC" } });
    expect(result).toEqual(templates);
  });

  it("updateTemplate throws NotFoundError when missing", async () => {
    (mockTemplateRepo.findOneBy as jest.Mock).mockResolvedValue(null);
    const svc = buildService();
    await expect(svc.updateTemplate("actor-1", "missing", {})).rejects.toBeInstanceOf(NotFoundError);
  });

  it("updateTemplate saves and logs", async () => {
    const existing = { id: "t-1", name: "Old", dayOfWeek: 1, isActive: true };
    const updated = { ...existing, name: "New" };
    (mockTemplateRepo.findOneBy as jest.Mock).mockResolvedValue(existing);
    (mockTemplateRepo.save as jest.Mock).mockResolvedValue(updated);
    const svc = buildService();
    const result = await svc.updateTemplate("actor-1", "t-1", { name: "New" });
    expect(mockTemplateRepo.save).toHaveBeenCalledWith(updated);
    expect(mockAuditRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: "template.updated", entityType: "staff_schedule_template", entityId: "t-1", actorId: "actor-1" }),
    );
    expect(result).toEqual(updated);
  });

  it("deleteTemplate soft-deletes and logs", async () => {
    const template = { id: "t-1", name: "Tpl", isActive: true };
    (mockTemplateRepo.findOneBy as jest.Mock).mockResolvedValue(template);
    const svc = buildService();
    const result = await svc.deleteTemplate("actor-1", "t-1");
    expect(template.isActive).toBe(false);
    expect(mockTemplateRepo.save).toHaveBeenCalledWith(template);
    expect(mockAuditRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: "template.deactivated", entityType: "staff_schedule_template", entityId: "t-1", actorId: "actor-1" }),
    );
    expect(result).toEqual({ deleted: true, id: "t-1" });
  });

  it("deleteTemplate throws NotFoundError when missing", async () => {
    (mockTemplateRepo.findOneBy as jest.Mock).mockResolvedValue(null);
    const svc = buildService();
    await expect(svc.deleteTemplate("actor-1", "missing")).rejects.toBeInstanceOf(NotFoundError);
  });
});
