import { BASE } from './api/base';
import { Component, lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Outlet, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { FeedbackProvider } from './components/Feedback';
import { Layout, RequireAuth } from './components/Layout';
import { AdminUsersPage } from './pages/AdminUsersPage';
import { AuditPage } from './pages/AuditPage';
import { BoardPage } from './pages/board/BoardPage';
import { BoardSettingsPage } from './pages/board/BoardSettingsPage';
import { BoardsPage } from './pages/BoardsPage';
import { DashboardPage } from './pages/DashboardPage';
import { AccessibilityPage, CookiesPage, PrivacyPage, TermsPage } from './pages/legal/LegalPages';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { LoadingState } from './components/Feedback';

// Wave B pages are loaded on demand to keep the main bundle small.
const AutomationsPage = lazy(() => import('./pages/board/automations/AutomationsPage').then((m) => ({ default: m.AutomationsPage })));
const ReportPage = lazy(() => import('./pages/board/automations/ReportPage').then((m) => ({ default: m.ReportPage })));
const CompliancePage = lazy(() => import('./pages/field/CompliancePage').then((m) => ({ default: m.CompliancePage })));
const QrLandingPage = lazy(() => import('./pages/field/QrPages').then((m) => ({ default: m.QrLandingPage })));
const QrSheetPage = lazy(() => import('./pages/field/QrPages').then((m) => ({ default: m.QrSheetPage })));
const FormsPage = lazy(() => import('./pages/field/FormPages').then((m) => ({ default: m.FormsPage })));
const FormFillPage = lazy(() => import('./pages/field/FormPages').then((m) => ({ default: m.FormFillPage })));
const FormsAdminPage = lazy(() => import('./pages/field/FormPages').then((m) => ({ default: m.FormsAdminPage })));
const FilesPage = lazy(() => import('./pages/board/FilesPage').then((m) => ({ default: m.FilesPage })));
const DashboardsPage = lazy(() => import('./pages/dashboards/DashboardPages').then((m) => ({ default: m.DashboardsPage })));
const CustomDashboardPage = lazy(() => import('./pages/dashboards/DashboardPages').then((m) => ({ default: m.CustomDashboardPage })));
const WorkloadPage = lazy(() => import('./pages/dashboards/ReportPages').then((m) => ({ default: m.WorkloadPage })));
const MonthlyReportPage = lazy(() => import('./pages/dashboards/ReportPages').then((m) => ({ default: m.MonthlyReportPage })));
const TrainingsPage = lazy(() => import('./pages/modules/TrainingPages').then((m) => ({ default: m.TrainingsPage })));
const MyTrainingsPage = lazy(() => import('./pages/modules/TrainingPages').then((m) => ({ default: m.MyTrainingsPage })));
const PermitsPage = lazy(() => import('./pages/modules/PermitPages').then((m) => ({ default: m.PermitsPage })));
const PermitNewPage = lazy(() => import('./pages/modules/PermitPages').then((m) => ({ default: m.PermitNewPage })));
const PermitDetailPage = lazy(() => import('./pages/modules/PermitPages').then((m) => ({ default: m.PermitDetailPage })));
const ProceduresPage = lazy(() => import('./pages/modules/ProcedurePages').then((m) => ({ default: m.ProceduresPage })));
const ProcedurePage = lazy(() => import('./pages/modules/ProcedurePages').then((m) => ({ default: m.ProcedurePage })));
const FloorPlansPage = lazy(() => import('./pages/modules/FloorPlanPage').then((m) => ({ default: m.FloorPlansPage })));
const FloorPlanPage = lazy(() => import('./pages/modules/FloorPlanPage').then((m) => ({ default: m.FloorPlanPage })));
const lazyPage = (node: ReactNode) => <Suspense fallback={<LoadingState />}>{node}</Suspense>;
import { ProfilePage } from './pages/ProfilePage';

/** Last-resort error boundary: friendly message, no stack traces shown to users. */
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    if (this.state.failed)
      return (
        <div className="state" role="alert">
          <h1>אירעה שגיאה בלתי צפויה</h1>
          <p>נסו לרענן את הדף. אם הבעיה חוזרת, פנו למנהל המערכת.</p>
          <button type="button" className="btn btn-primary" onClick={() => window.location.assign(`${BASE}/`)}>
            חזרה לדף הבית
          </button>
        </div>
      );
    return this.props.children;
  }
}

export function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter basename={BASE || undefined}>
        <AuthProvider>
          <FeedbackProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route element={<RequireAuth />}>
                <Route element={<Layout />}>
                  <Route index element={<DashboardPage />} />
                  <Route path="boards" element={<BoardsPage />} />
                  <Route path="boards/:boardId" element={<BoardPage />} />
                  <Route path="boards/:boardId/settings" element={<BoardSettingsPage />} />
                  <Route path="boards/:boardId/automations" element={lazyPage(<AutomationsPage />)} />
                  <Route path="boards/:boardId/report" element={lazyPage(<ReportPage />)} />
                  <Route path="boards/:boardId/qr" element={lazyPage(<QrSheetPage />)} />
                  <Route path="boards/:boardId/forms" element={lazyPage(<FormsAdminPage />)} />
                  <Route path="q/:itemId" element={lazyPage(<QrLandingPage />)} />
                  <Route path="compliance" element={lazyPage(<CompliancePage />)} />
                  <Route path="dashboards" element={lazyPage(<DashboardsPage />)} />
                  <Route path="dashboards/:dashboardId" element={lazyPage(<CustomDashboardPage />)} />
                  <Route path="workload" element={lazyPage(<WorkloadPage />)} />
                  <Route path="trainings" element={lazyPage(<TrainingsPage />)} />
                  <Route path="trainings/me" element={lazyPage(<MyTrainingsPage />)} />
                  <Route path="permits" element={lazyPage(<PermitsPage />)} />
                  <Route path="permits/new" element={lazyPage(<PermitNewPage />)} />
                  <Route path="permits/:permitId" element={lazyPage(<PermitDetailPage />)} />
                  <Route path="procedures" element={lazyPage(<ProceduresPage />)} />
                  <Route path="procedures/:procedureId" element={lazyPage(<ProcedurePage />)} />
                  <Route path="boards/:boardId/plans" element={lazyPage(<FloorPlansPage />)} />
                  <Route path="boards/:boardId/files" element={lazyPage(<FilesPage />)} />
                  <Route path="boards/:boardId/plans/:attachmentId" element={lazyPage(<FloorPlanPage />)} />
                  <Route path="reports/monthly" element={lazyPage(<MonthlyReportPage />)} />
                  <Route path="forms" element={lazyPage(<FormsPage />)} />
                  <Route path="forms/:formId" element={lazyPage(<FormFillPage />)} />
                  <Route path="profile" element={<ProfilePage />} />
                  <Route element={<RequireAuth admin />}>
                    <Route path="admin/users" element={<AdminUsersPage />} />
                    <Route path="admin/audit" element={<AuditPage />} />
                  </Route>
                  <Route path="*" element={<NotFoundPage />} />
                </Route>
              </Route>
              <Route element={<AuthOptionalLayout />}>
                <Route path="accessibility" element={<AccessibilityPage />} />
                <Route path="privacy" element={<PrivacyPage />} />
                <Route path="cookies" element={<CookiesPage />} />
                <Route path="terms" element={<TermsPage />} />
              </Route>
            </Routes>
          </FeedbackProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

/** Legal routes must be reachable without login; with a session they use the normal app layout. */
function AuthOptionalLayout() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user && !user.mustChangePassword && !user.mfaSetupRequired) return <Layout />;
  return <Outlet />;
}
