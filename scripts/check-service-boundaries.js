const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

const rules = [
  {
    service: 'user-service',
    include: ['src'],
    extensions: ['.ts'],
    forbidden: [
      { pattern: /\bpatron_faces\b/i, reason: 'user-service must publish user events instead of deleting face tables' },
      { pattern: /\baccess_logs\b/i, reason: 'user-service must not read or delete access logs' },
      { pattern: /\bborrow_records\b/i, reason: 'user-service must not read borrow records' },
    ],
    allow: [
      /config\.ts$/,
    ],
  },
  {
    service: 'borrow-service',
    include: ['src'],
    extensions: ['.ts'],
    forbidden: [
      { pattern: /\busers\b/i, reason: 'borrow-service must call user-service instead of using users table' },
      { pattern: /\baccess_logs\b/i, reason: 'borrow-service must call access-service instead of using access logs' },
      { pattern: /\bpatron_access_states\b/i, reason: 'borrow-service must call access-service instead of using access state tables' },
    ],
    allow: [
      /UserServiceClient\.ts$/,
      /AccessServiceClient\.ts$/,
      /routes[\\/]borrow\.routes\.ts$/,
      /config\.ts$/,
      /__tests__[\\/]/,
    ],
  },
  {
    service: 'access-service',
    include: ['src'],
    extensions: ['.ts'],
    forbidden: [
      { pattern: /\bborrow_records\b/i, reason: 'access-service must not read borrow records' },
      { pattern: /\bbook_copies\b/i, reason: 'access-service must not read book copies' },
      { pattern: /\bbooks\b/i, reason: 'access-service must not read books' },
      { pattern: /@Entity\([^)]*users/i, reason: 'access-service must not map the users table' },
    ],
    allow: [
      /UserServiceClient\.ts$/,
    ],
  },
  {
    service: 'schedule-service',
    include: ['src'],
    extensions: ['.ts'],
    forbidden: [
      { pattern: /\bborrow_records\b/i, reason: 'schedule-service must not read borrow records' },
      { pattern: /\baccess_logs\b/i, reason: 'schedule-service must not read access logs' },
      { pattern: /\bpatron_access_states\b/i, reason: 'schedule-service must not read access state tables' },
      { pattern: /@Entity\([^)]*users/i, reason: 'schedule-service must not map the users table' },
    ],
    allow: [
      /UserServiceClient\.ts$/,
      /ScheduleService\.ts$/,
      /config\.ts$/,
    ],
  },
  {
    service: 'face-recognition-service',
    include: ['api', 'infra', 'worker'],
    extensions: ['.py'],
    forbidden: [
      { pattern: /class\s+UserModel\b/, reason: 'face-recognition-service must not map the users table' },
      { pattern: /class\s+AccessLogModel\b/, reason: 'face-recognition-service must not map access logs' },
      { pattern: /__tablename__\s*=\s*["']users["']/, reason: 'face-recognition-service must not own users' },
      { pattern: /__tablename__\s*=\s*["']access_logs["']/, reason: 'face-recognition-service must not own access logs' },
      { pattern: /select\(UserModel|update\(UserModel/, reason: 'face-recognition-service must call user-service instead of querying users' },
      { pattern: /select\(AccessLogModel|INSERT\s+INTO\s+access_logs/i, reason: 'face-recognition-service must call access-service instead of querying access logs' },
    ],
    allow: [
      /api[\\/]routers[\\/]access\.py$/,
    ],
  },
  {
    service: 'ai-service',
    include: ['src'],
    extensions: ['.ts'],
    forbidden: [
      { pattern: /\busers\b/i, reason: 'ai-service must call user-service instead of querying users' },
      { pattern: /\baccess_logs\b/i, reason: 'ai-service must call access-service instead of querying access logs' },
      { pattern: /\bborrow_records\b/i, reason: 'ai-service must call borrow-service instead of querying borrow records' },
      { pattern: /\bbook_copies\b/i, reason: 'ai-service must call borrow-service instead of querying inventory tables' },
      { pattern: /\bstaff_schedules\b/i, reason: 'ai-service must call schedule-service instead of querying schedules' },
    ],
    allow: [
      /config\.ts$/,
      /entities[\\/]Ai/,
      /migrations[\\/]/,
    ],
  },
];

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '__pycache__', '.pytest_cache'].includes(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

const violations = [];

for (const rule of rules) {
  const serviceRoot = path.join(root, rule.service);
  for (const includePath of rule.include) {
    const scanRoot = path.join(serviceRoot, includePath);
    if (!fs.existsSync(scanRoot)) continue;
    for (const file of walk(scanRoot)) {
      if (!rule.extensions.includes(path.extname(file))) continue;
      const relative = path.relative(serviceRoot, file);
      if (rule.allow.some((allowed) => allowed.test(relative))) continue;
      const content = fs.readFileSync(file, 'utf8');
      for (const forbidden of rule.forbidden) {
        if (forbidden.pattern.test(content)) {
          violations.push({
            service: rule.service,
            file: path.relative(root, file),
            reason: forbidden.reason,
          });
        }
      }
    }
  }
}

if (violations.length) {
  console.error('Service boundary violations found:');
  for (const violation of violations) {
    console.error(`- ${violation.file}: ${violation.reason}`);
  }
  process.exit(1);
}

console.log('Service boundary check passed.');
