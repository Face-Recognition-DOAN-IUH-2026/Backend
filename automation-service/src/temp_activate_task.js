const { AppDataSource } = require('./data-source');

async function main() {
  await AppDataSource.initialize();
  const result = await AppDataSource.query(`
    INSERT INTO automation_tasks (name, description, type, cron_expression, event_type, handler, config, is_active)
    VALUES
      ('staff_schedule_auto_checkout', 'Auto-checkout stale staff schedule assignments at end of day', 'scheduled', '59 23 * * *', NULL, 'staff_schedule_auto_checkout', NULL, true)
    ON CONFLICT (name) DO UPDATE SET is_active = true, cron_expression = '59 23 * * *', handler = 'staff_schedule_auto_checkout'
    RETURNING id, name, is_active, cron_expression
  `);
  console.log('Result:', JSON.stringify(result));
  await AppDataSource.destroy();
}

main().catch(e => { console.error(e.message); process.exit(1); });