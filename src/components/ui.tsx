import type { ButtonHTMLAttributes, ReactNode } from "react"

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
}: {
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description ? <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">{description}</p> : null}
        </div>
        {action}
      </div>
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

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-2 block font-medium">{label}</span>
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
