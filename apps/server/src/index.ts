import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db/index.js';

const AUDIT_RETENTION_DAYS = Number(process.env.AUDIT_RETENTION_DAYS ?? 365);

async function main() {
  const config = loadConfig();
  const db = openDatabase(config.databasePath);
  const app = await buildApp(config, db);

  if (app.services.users.countUsers() === 0) {
    app.log.warn('No users exist yet. Create the first administrator with: npm run create-admin');
  }

  // Housekeeping: expired sessions + audit-log retention.
  const housekeeping = () => {
    try {
      const sessions = app.services.auth.purgeExpiredSessions();
      const audit = app.services.audit.purgeOlderThan(AUDIT_RETENTION_DAYS);
      const notifications = app.services.notifications.purgeOlderThan(config.notificationRetentionDays);
      const trash = app.services.items.purgeTrash();
      const orphans = app.services.attachments.sweepOrphans();
      const runs = app.services.automations.purgeRunsOlderThan();
      if (sessions || audit || notifications || trash || orphans || runs) app.log.info({ sessions, audit, notifications, trash, orphans, runs }, 'housekeeping purge');
    } catch (err) {
      app.log.error({ err }, 'housekeeping failed');
    }
  };
  housekeeping();
  setInterval(housekeeping, 60 * 60_000).unref();

  // Frequent jobs (every 5 minutes). Each is self-gated and independent, so one failing job never
  // blocks the others: daily reminders, scheduled automations and reports (once per day after
  // DIGEST_HOUR), recurring items (as soon as their date arrives), re-scan of quarantined uploads.
  const jobs: [string, () => unknown][] = [
    ['daily reminders', () => app.services.notifications.runDailyReminders()],
    ['recurring items', () => app.services.recurrences.runDue()],
    ['scheduled automations', () => app.services.automations.runScheduled()],
    ['scheduled reports', () => app.services.reports.runDue()],
    ['rescan uploads', () => app.services.attachments.rescanPending()],
  ];
  const frequent = async () => {
    for (const [name, job] of jobs) {
      try {
        await job();
      } catch (err) {
        app.log.error({ err, job: name }, 'scheduled job failed');
      }
    }
  };
  void frequent();
  setInterval(() => void frequent(), 5 * 60_000).unref();

  if (!app.services.notifications.emailEnabled) app.log.warn('SMTP not configured: e-mail notifications are disabled (in-app notifications still work)');
  if (!app.services.attachments.scannerName) app.log.warn('No malware scanner configured: uploaded files stay quarantined and cannot be downloaded');
  if (app.services.attachments.scannerName === 'disabled-unsafe') app.log.warn('UNSAFE: malware scanning is disabled (development only)');

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    db.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: config.host, port: config.port });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
