import { NavLink, Outlet } from "react-router-dom"
import { useAuth } from "../auth/AuthContext.tsx"

const item = "ds-nav"
const active = "is-active"

export function Layout() {
  const { profile, organization, signOut } = useAuth()
  const admin = profile?.role === "admin"

  return (
    <div className="min-h-svh">
      <header className="ds-header">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <div className="mr-auto">
            <p className="text-xs tracking-[0.16em] text-accent">근태</p>
            <p className="text-sm font-medium">{organization?.name ?? "조직"}</p>
          </div>
          <p className="text-sm text-muted">
            {profile?.name}
            {admin ? " · 관리자" : ""}
          </p>
          <button type="button" className="text-sm text-muted underline-offset-4 hover:underline" onClick={() => void signOut()}>
            로그아웃
          </button>
        </div>
        <nav className="mx-auto flex w-full max-w-5xl gap-1 overflow-x-auto px-4 pb-3 sm:px-6">
          <NavLink to="/" end className={({ isActive }) => (isActive ? `${item} ${active}` : item)}>
            내 근태
          </NavLink>
          {admin ? (
            <>
              <NavLink to="/admin/workplaces" className={({ isActive }) => (isActive ? `${item} ${active}` : item)}>
                사업장
              </NavLink>
              <NavLink to="/admin/members" className={({ isActive }) => (isActive ? `${item} ${active}` : item)}>
                구성원
              </NavLink>
              <NavLink to="/admin/attendance" className={({ isActive }) => (isActive ? `${item} ${active}` : item)}>
                출퇴근
              </NavLink>
              <NavLink to="/admin/penalties" className={({ isActive }) => (isActive ? `${item} ${active}` : item)}>
                지각
              </NavLink>
              <NavLink to="/admin/annual-leave" className={({ isActive }) => (isActive ? `${item} ${active}` : item)}>
                연차
              </NavLink>
              <NavLink to="/admin/leaves" className={({ isActive }) => (isActive ? `${item} ${active}` : item)}>
                휴가
              </NavLink>
              <NavLink to="/admin/comp-leave" className={({ isActive }) => (isActive ? `${item} ${active}` : item)}>
                보상휴가
              </NavLink>
            </>
          ) : null}
        </nav>
      </header>
      <Outlet />
    </div>
  )
}
