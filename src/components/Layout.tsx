import { useState } from "react"
import { NavLink, Outlet } from "react-router-dom"
import { useAuth } from "../auth/AuthContext.tsx"
import { LogoutButton } from "./LogoutButton.tsx"

const item = "ds-nav"
const active = "is-active"

const links = [
  { to: "/", label: "내 근태", end: true, admin: false },
  { to: "/leave", label: "내 휴가", end: false, admin: false },
  { to: "/admin/workplaces", label: "사업장", admin: true },
  { to: "/admin/members", label: "구성원", admin: true },
  { to: "/admin/attendance", label: "출퇴근", admin: true },
  { to: "/admin/penalties", label: "지각", admin: true },
  { to: "/admin/annual-leave", label: "연차", admin: true },
  { to: "/admin/leaves", label: "휴가", admin: true },
  { to: "/admin/comp-leave", label: "보상휴가", admin: true },
]

export function Layout() {
  const { profile, organization, setTheme } = useAuth()
  const admin = profile?.role === "admin"
  const theme = profile?.ui_theme === "soft" ? "soft" : "night"
  const [open, setOpen] = useState(false)
  const menu = links.filter((link) => !link.admin || admin)

  return (
    <div className="ds-shell">
      {open ? <button type="button" className="ds-sidebar-backdrop" aria-label="메뉴 닫기" onClick={() => setOpen(false)} /> : null}
      <aside className={open ? "ds-sidebar is-open" : "ds-sidebar"}>
        <div>
          <p className="text-xs tracking-[0.16em] text-accent">근태</p>
          <p className="mt-1 text-sm font-medium">{organization?.name ?? "조직"}</p>
        </div>
        <nav>
          {menu.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) => (isActive ? `${item} ${active}` : item)}
              onClick={() => setOpen(false)}
            >
              {link.label}
            </NavLink>
          ))}
        </nav>
        <div className="ds-theme-switch" role="group" aria-label="테마">
          <button type="button" aria-pressed={theme === "night"} className={theme === "night" ? "is-active" : ""} onClick={() => void setTheme("night")}>
            밤
          </button>
          <button type="button" aria-pressed={theme === "soft"} className={theme === "soft" ? "is-active" : ""} onClick={() => void setTheme("soft")}>
            소프트
          </button>
        </div>
        <div className="ds-side-user">
          <p className="min-w-0 truncate text-sm text-muted">
            {profile?.name}
            {admin ? " · 관리자" : ""}
          </p>
          <LogoutButton />
        </div>
      </aside>
      <div className="min-w-0">
        <button type="button" className="ds-menu-toggle ds-icon-button" aria-label="메뉴" onClick={() => setOpen(true)}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="M5 7h14" />
            <path d="M5 12h14" />
            <path d="M5 17h14" />
          </svg>
        </button>
        <Outlet />
      </div>
    </div>
  )
}
