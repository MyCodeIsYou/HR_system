import { useState } from "react"
import { useAuth } from "../auth/AuthContext.tsx"
import { Button, Modal } from "./ui.tsx"

export function LogoutButton() {
  const { signOut } = useAuth()
  const [open, setOpen] = useState(false)

  return (
    <>
      <button type="button" className="ds-icon-button" aria-label="로그아웃" onClick={() => setOpen(true)}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10 7V5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-2" />
          <path d="M4 12h10" />
          <path d="M11 9l3 3-3 3" />
        </svg>
      </button>
      {open ? (
        <Modal title="로그아웃" onClose={() => setOpen(false)}>
          <p className="text-sm leading-6">정말 로그아웃 하시겠습니까?</p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              취소
            </Button>
            <Button
              onClick={() => {
                setOpen(false)
                void signOut()
              }}
            >
              확인
            </Button>
          </div>
        </Modal>
      ) : null}
    </>
  )
}
