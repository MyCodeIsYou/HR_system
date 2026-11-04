import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react"

export function FullScreen({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <main className="grid min-h-svh place-items-center px-6">
      <div className="max-w-md text-center">
        <p className="text-sm tracking-[0.18em] text-accent">근태</p>
        <h1 className="mt-3 text-3xl font-semibold">{title}</h1>
        {children ? <div className="mt-4 text-sm leading-6 text-muted">{children}</div> : <div className="ds-progress mx-auto mt-6 w-48" />}
      </div>
    </main>
  )
}

export function Page({
  title,
  description,
  action,
  children,
  menuTitle = true,
}: {
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
  menuTitle?: boolean
}) {
  return (
    <section className={`mx-auto w-full max-w-5xl px-4 py-6 sm:px-8${menuTitle ? " ds-home-page" : ""}`}>
      <div className={`flex flex-wrap items-end justify-between gap-3${description ? " mb-2" : " mb-6"}${menuTitle ? " ds-home-title" : ""}`}>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {action}
      </div>
      {description ? <p className="ds-page-lead">{description}</p> : null}
      {children}
    </section>
  )
}

export function Card({
  children,
  className = "",
  tone = "blue",
}: {
  children: ReactNode
  className?: string
  tone?: "blue" | "warm"
}) {
  return <div className={`ds-card p-4 ${tone === "warm" ? "ds-card-warm" : ""} ${className}`}>{children}</div>
}

export function Alert({ children }: { children: ReactNode }) {
  return <p className="ds-alert">{children}</p>
}

export function Notice({ children }: { children: ReactNode }) {
  return <p className="ds-notice">{children}</p>
}

export function Toast({ children }: { children: ReactNode }) {
  return <p className="ds-toast">{children}</p>
}

export function Modal({
  title,
  children,
  onClose,
  footer,
}: {
  title: string
  children: ReactNode
  onClose: () => void
  footer?: ReactNode
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    window.addEventListener("keydown", onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener("keydown", onKey)
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
      <button type="button" className="absolute inset-0 bg-black/60" aria-label="닫기" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className="ds-card relative z-10 flex w-full max-w-lg flex-col overflow-hidden p-5 max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-3rem)]"
      >
        <div className="mb-4 flex shrink-0 items-center justify-between gap-3">
          <h2 id="modal-title" className="text-lg font-semibold">{title}</h2>
          <button type="button" className="text-sm text-muted underline-offset-4 hover:underline" onClick={onClose}>
            닫기
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto">{children}</div>
        {footer ? <div className="shrink-0 pt-3">{footer}</div> : null}
      </div>
    </div>
  )
}

export function Field({ label, hint, children, compact = false }: { label: string; hint?: string; children: ReactNode; compact?: boolean }) {
  return (
    <label className="block min-w-0 text-sm">
      <span className={compact ? "mb-1 block text-xs font-medium text-muted" : "mb-2 block font-medium"}>{label}</span>
      {children}
      {hint ? <span className="mt-2 block text-xs leading-5 text-muted">{hint}</span> : null}
    </label>
  )
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger"
}

export function Button({ variant = "primary", className = "", type = "button", ...props }: ButtonProps) {
  const tone = variant === "primary" ? "ds-button" : variant === "danger" ? "ds-button ds-button-danger" : "ds-button ds-button-ghost"
  return <button type={type} className={`${tone} ${className}`} {...props} />
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="ds-empty">
      <span className="ds-empty-mark" aria-hidden="true">
        ·
      </span>
      <p>{children}</p>
    </div>
  )
}
