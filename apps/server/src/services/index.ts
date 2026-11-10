import type { AppConfig } from '../config.js';
import type { DB } from '../db/index.js';
import { AccessService } from './access.js';
import { ActivityService } from './activity.js';
import { AuditService } from './audit.js';
import { AuthService } from './auth.js';
import { BoardService } from './boards.js';
import { DashboardService } from './dashboard.js';
import { ItemService } from './items.js';
import { UserService } from './users.js';

export interface Services {
  audit: AuditService;
  access: AccessService;
  activity: ActivityService;
  auth: AuthService;
  users: UserService;
  boards: BoardService;
  items: ItemService;
  dashboard: DashboardService;
}

export function createServices(db: DB, config: AppConfig): Services {
  const audit = new AuditService(db, config.auditIpSecret);
  const access = new AccessService(db);
  const activity = new ActivityService(db);
  const auth = new AuthService(db, config, audit);
  const users = new UserService(db, audit, auth);
  const boards = new BoardService(db, access, activity, audit);
  const items = new ItemService(db, access, boards, activity);
  const dashboard = new DashboardService(db, access, boards, config.timeZone);
  return { audit, access, activity, auth, users, boards, items, dashboard };
}
