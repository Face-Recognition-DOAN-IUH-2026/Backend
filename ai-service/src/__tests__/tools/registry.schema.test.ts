jest.mock('../../config', () => ({
  config: {
    port: 3004,
    nodeEnv: 'test',
    borrowServiceUrl: 'http://borrow-service:8000',
    scheduleServiceUrl: 'http://schedule-service:3002',
    userServiceUrl: 'http://user-service:3001',
    serviceJwtSecret: 'test-service-jwt',
    ai: { refreshMinutes: 15, mockMode: true },
    db: { host: 'localhost', port: 5432, database: 'aidb', schema: 'ai', user: 'test', password: 'test' },
  },
}));

import {
  patronToolDefs,
  staffToolDefs,
  adminToolDefs,
  getToolDefsForRole,
  toOpenAITools,
  type ToolDef,
} from '../../tools/registry';

function expectValidObjectSchema(params: any) {
  expect(params).toBeDefined();
  expect(params.type).toBe('object');
  expect(typeof params.properties).toBe('object');
  expect(params.properties).not.toBeNull();
  if (params.required) {
    expect(Array.isArray(params.required)).toBe(true);
    for (const r of params.required) {
      expect(params.properties[r]).toBeDefined();
    }
  }
}

describe('ToolDef JSON Schema (native function calling)', () => {
  const allTools: Array<[string, ToolDef[]]> = [
    ['patron', patronToolDefs],
    ['staff', staffToolDefs],
    ['admin', adminToolDefs],
  ];

  it.each(allTools)('every %s tool declares a JSON Schema parameters block', (_role, tools) => {
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect(tool.parameters).toBeDefined();
      expectValidObjectSchema(tool.parameters);
    }
  });

  it('maps each tool to the exact function parameter it accepts', () => {
    const byName = (t: ToolDef) => t.name;
    const patron = patronToolDefs;
    const propsOf = (name: string) => patron.find((t) => byName(t) === name)!.parameters.properties;

    expect(Object.keys(propsOf('search_books'))).toEqual(['query']);
    expect(propsOf('search_books').query.type).toBe('string');

    expect(Object.keys(propsOf('get_shelf_location'))).toEqual(['book_id']);
    expect(propsOf('get_shelf_location').book_id.type).toBe('string');

    expect(Object.keys(propsOf('lookup_book'))).toEqual(['isbn_or_query']);
    expect(propsOf('lookup_book').isbn_or_query.type).toBe('string');

    expect(propsOf('get_library_hours')).toEqual({});
  });

  it('exposes ZERO model-suppliable parameters for injectUserId tools (anti prompt-injection)', () => {
    for (const name of ['get_patron_info', 'get_patron_borrows', 'get_patron_history']) {
      const patronTool = patronToolDefs.find((t) => t.name === name)!;
      expect(patronTool.injectUserId).toBe(true);
      expect(patronTool.parameters.properties).toEqual({});
      expect(patronTool.parameters.required ?? []).toEqual([]);
      expect(patronTool.parameters.additionalProperties).toBe(false);
    }
  });

  it('requires student_code for staff lookups (different contract from patron)', () => {
    const staffInfo = staffToolDefs.find((t) => t.name === 'get_patron_info')!;
    expect(staffInfo.injectUserId).toBeUndefined();
    expect(staffInfo.parameters.properties).toHaveProperty('student_code');
    expect(staffInfo.parameters.required).toEqual(['student_code']);
  });

  it('getToolDefsForRole keeps returning role-scoped allowlists', () => {
    expect(getToolDefsForRole('patron').map((t) => t.name)).not.toContain('get_overdue_borrows');
    expect(getToolDefsForRole('staff').map((t) => t.name)).toContain('get_overdue_borrows');
    expect(getToolDefsForRole('admin').map((t) => t.name)).toContain('get_schedule_today');
    expect(getToolDefsForRole('weird-role').map((t) => t.name)).not.toContain('get_overdue_borrows');
  });
});

describe('toOpenAITools', () => {
  it('emits OpenAI function-calling schema shape', () => {
    const out = toOpenAITools(patronToolDefs);

    expect(out).toHaveLength(patronToolDefs.length);
    for (const t of out) {
      expect(t.type).toBe('function');
      expect(t.function.name).toBeTruthy();
      expect(t.function.description).toBeTruthy();
      expect(t.function.parameters.type).toBe('object');
    }

    const search = out.find((t) => t.function.name === 'search_books')!;
    expect(search.function.parameters.required).toEqual(['query']);
  });

  it('preserves injectUserId markers are NOT leaked into the wire schema', () => {
    const out = toOpenAITools(patronToolDefs);
    const info = out.find((t) => t.function.name === 'get_patron_info')!;
    expect(info.function.parameters.properties).toEqual({});
    expect(JSON.stringify(out)).not.toContain('injectUserId');
  });

  it('is safe for an empty tool list', () => {
    expect(toOpenAITools([])).toEqual([]);
  });
});
