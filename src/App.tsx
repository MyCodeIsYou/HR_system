import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom"
import { useAuth } from "./auth/AuthContext.tsx"
import { Layout } from "./components/Layout.tsx"
import { FullScreen } from "./components/ui.tsx"
import { CheckinPage, CheckinResultPage } from "./pages/CheckinPage.tsx"
import { HomePage } from "./pages/HomePage.tsx"
import { LeaveRequestPage } from "./pages/LeaveRequestPage.tsx"
import { LoginPage } from "./pages/LoginPage.tsx"
import { SetupPage } from "./pages/SetupPage.tsx"
import { SupportPage } from "./pages/SupportPage.tsx"
import { FaqPage } from "./pages/FaqPage.tsx"
import { AnnualLeavePage } from "./pages/admin/AnnualLeavePage.tsx"
import { AttendancePage } from "./pages/admin/AttendancePage.tsx"
import { CompLeavePage } from "./pages/admin/CompLeavePage.tsx"
import { LeaveAdminPage } from "./pages/admin/LeaveAdminPage.tsx"
import { MembersPage } from "./pages/admin/MembersPage.tsx"
import { PenaltiesPage } from "./pages/admin/PenaltiesPage.tsx"
import { WorkplaceFormPage } from "./pages/admin/WorkplaceFormPage.tsx"
import { WorkplacesPage } from "./pages/admin/WorkplacesPage.tsx"

function ConfigMissing() {
  return (
    <FullScreen title="Supabase 연결이 필요합니다">
      <p>
        프로젝트 루트에 <code>.env.local</code>을 만들고 <code>VITE_SUPABASE_URL</code>, <code>VITE_SUPABASE_ANON_KEY</code>를
        넣은 뒤 개발 서버를 다시 시작하세요. 예시는 <code>.env.example</code>에 있습니다.
      </p>
      <p className="mt-3">
        스키마는 <code>supabase/migrations</code>의 SQL을 Supabase SQL 편집기에서 실행하거나, Supabase CLI로 적용합니다.
      </p>
    </FullScreen>
  )
}

function RequireAuth() {
  const { ready, session, profile, profileError, refresh } = useAuth()
  const location = useLocation()
  if (!ready) return <FullScreen title="불러오는 중" />
  if (!session) {
    const next = `${location.pathname}${location.search}`
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />
  }
  if (profileError) {
    return (
      <FullScreen title="프로필을 불러오지 못했습니다">
        <p>{profileError}</p>
        <button type="button" className="mt-4 text-sm underline" onClick={() => void refresh()}>
          다시 시도
        </button>
      </FullScreen>
    )
  }
  if (!profile) return <FullScreen title="프로필이 없습니다" />
  if (!profile.organization_id) return <Navigate to="/setup" replace />
  return <Layout />
}

function RequireAdmin() {
  const { profile } = useAuth()
  if (profile?.role !== "admin") return <Navigate to="/" replace />
  return <Outlet />
}

export function App() {
  const { configured } = useAuth()
  if (!configured) return <ConfigMissing />

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/setup" element={<SetupPage />} />
      <Route path="/c/result" element={<CheckinResultPage />} />
      <Route path="/c/:token" element={<CheckinPage />} />
      <Route element={<RequireAuth />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/leave" element={<LeaveRequestPage />} />
        <Route path="/support" element={<SupportPage />} />
        <Route path="/faq" element={<FaqPage />} />
        <Route element={<RequireAdmin />}>
          <Route path="/admin/workplaces" element={<WorkplacesPage />} />
          <Route path="/admin/workplaces/new" element={<WorkplaceFormPage />} />
          <Route path="/admin/workplaces/:workplaceId" element={<WorkplaceFormPage />} />
          <Route path="/admin/members" element={<MembersPage />} />
          <Route path="/admin/attendance" element={<AttendancePage />} />
          <Route path="/admin/penalties" element={<PenaltiesPage />} />
          <Route path="/admin/annual-leave" element={<AnnualLeavePage />} />
          <Route path="/admin/leaves" element={<LeaveAdminPage />} />
          <Route path="/admin/comp-leave" element={<CompLeavePage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
