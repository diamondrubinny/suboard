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
import { AttachmentService } from './attachments.js';
import { ExportService } from './export.js';
import { MfaService } from './mfa.js';
import { NotificationService } from './notifications.js';
import { SearchService } from './search.js';
import { ViewService } from './views.js';
import { AutomationService } from './automations.js';
import { CalendarService } from './calendar.js';
import { RecurrenceService } from './recurrences.js';
import { ReportService } from './reports.js';
import { ComplianceService } from './compliance.js';
import { FormService } from './forms.js';
import { InvestigationService } from './investigations.js';
import { LinkService } from './links.js';
import { AnalyticsService } from './analytics.js';
import { TrainingService } from './trainings.js';
import { PlanService, ProcedureService } from './procedures.js';
import { SsoService } from './sso.js';
import { FavoriteService } from './favorites.js';
import { FollowService } from './follow.js';
import { BoardTemplateService } from './boardTemplates.js';
import { PasswordResetService } from './passwordReset.js';
import { PersonalService } from './personal.js';
import { PasskeyService } from './passkeys.js';
import { ModuleService } from './modules.js';
import { WorkspaceService } from './workspaces.js';
import { ScimService } from './scim.js';
import { DashboardService as CustomDashboardService, DependencyService, MonthlyReportJob } from './planning.js';
import { ClamdScanner, UnsafeNoopScanner, type Scanner } from '../lib/clamav.js';
import { createMailer, type Mailer } from '../lib/mailer.js';

export interface Services {
  audit: AuditService;
  access: AccessService;
  activity: ActivityService;
  auth: AuthService;
  users: UserService;
  boards: BoardService;
  items: ItemService;
  dashboard: DashboardService;
  mfa: MfaService;
  notifications: NotificationService;
  attachments: AttachmentService;
  exports: ExportService;
  views: ViewService;
  search: SearchService;
  automations: AutomationService;
  recurrences: RecurrenceService;
  reports: ReportService;
  calendar: CalendarService;
  links: LinkService;
  investigations: InvestigationService;
  compliance: ComplianceService;
  forms: FormService;
  analytics: AnalyticsService;
  dashboards: CustomDashboardService;
  dependencies: DependencyService;
  monthly: MonthlyReportJob;
  trainings: TrainingService;
  procedures: ProcedureService;
  plans: PlanService;
  sso: SsoService;
  scim: ScimService;
  favorites: FavoriteService;
  follow: FollowService;
  boardTemplates: BoardTemplateService;
  passwordReset: PasswordResetService;
  personal: PersonalService;
  passkeys: PasskeyService;
  modules: ModuleService;
  workspaces: WorkspaceService;
}

/** Infrastructure that tests (or alternative deployments) can substitute. */
export interface ServiceOverrides {
  mailer?: Mailer | null;
  scanner?: Scanner | null;
}

export function createScanner(config: AppConfig): Scanner | null {
  if (config.clamav) return new ClamdScanner(config.clamav);
  if (config.scanDisabledUnsafe && config.env !== 'production') return new UnsafeNoopScanner();
  return null;
}

export function createServices(db: DB, config: AppConfig, overrides: ServiceOverrides = {}): Services {
  const audit = new AuditService(db, config.auditIpSecret);
  const access = new AccessService(db);
  const activity = new ActivityService(db);
  const mfa = new MfaService(db, config, audit);
  const auth = new AuthService(db, config, audit, mfa);
  const users = new UserService(db, audit, auth);
  const boards = new BoardService(db, access, activity, audit);
  const mailer = 'mailer' in overrides ? (overrides.mailer ?? null) : createMailer(config);
  const notifications = new NotificationService(db, config, access, boards, mailer);
  const items = new ItemService(db, access, boards, activity, notifications);
  const dashboard = new DashboardService(db, access, boards, config.timeZone);
  const scanner = 'scanner' in overrides ? (overrides.scanner ?? null) : createScanner(config);
  const attachments = new AttachmentService(db, config, access, activity, audit, scanner);
  const exports = new ExportService(db, access, boards, audit);
  const views = new ViewService(db, access);
  const search = new SearchService(db, access);
  const automations = new AutomationService(db, config, access, boards, items, activity, notifications);
  const recurrences = new RecurrenceService(db, config, access, boards, items, activity);
  const reports = new ReportService(db, config, access, boards, items, activity, notifications);
  const calendar = new CalendarService(db, config, access, boards, audit);
  const links = new LinkService(db, access, boards, items, activity);
  const investigations = new InvestigationService(db, config, access, boards, items, activity, notifications);
  const compliance = new ComplianceService(db, config, access, boards, activity);
  const forms = new FormService(db, access, boards, items, attachments, activity, notifications);
  const analytics = new AnalyticsService(db, config, access, boards, compliance);
  const dashboards = new CustomDashboardService(db, access, analytics);
  const dependencies = new DependencyService(db, access, boards, activity);
  const monthly = new MonthlyReportJob(db, config, analytics, notifications);
  const trainings = new TrainingService(db, config, audit, notifications);
  const procedures = new ProcedureService(db, notifications);
  const plans = new PlanService(db, access);
  const sso = new SsoService(db, config, auth, audit);
  const scim = new ScimService(db, config, auth, audit);
  const favorites = new FavoriteService(db, access);
  const follow = new FollowService(db, access, boards, items, notifications);
  const boardTemplates = new BoardTemplateService(db, access, boards, audit);
  const passwordReset = new PasswordResetService(db, config, audit, auth, mailer);
  const passkeys = new PasskeyService(db, config, audit, auth);
  const modules = new ModuleService(db, audit);
  const workspaces = new WorkspaceService(db, access, audit);
  const personal = new PersonalService(db, access, boards, items, activity, notifications);
  return {
    audit, access, activity, auth, users, boards, items, dashboard, mfa, notifications, attachments, exports, views, search,
    automations, recurrences, reports, calendar, links, investigations, compliance, forms, analytics, dashboards, dependencies, monthly, trainings, procedures, plans, sso, scim, favorites, follow, boardTemplates, passwordReset, personal, passkeys, modules, workspaces,
  };
}
