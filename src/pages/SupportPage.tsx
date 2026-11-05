import { useEffect, useState, type FormEvent } from "react"
import { useAuth } from "../auth/AuthContext.tsx"
import { Alert, Button, Field, Modal, Page } from "../components/ui.tsx"
import { formatDateTime, humanError } from "../lib/format.ts"
import { supabase } from "../lib/supabase.ts"
import type { SupportKind, SupportStatus, SupportTicket, SupportTicketPage } from "../types.ts"

const pageSize = 10

const kindLabel: Record<SupportKind, string> = {
  correction: "개발요청",
  inquiry: "문의",
}

const statusLabel: Record<SupportStatus, string> = {
  open: "접수",
  answered: "답변",
  closed: "완료",
}

function pageWindow(page: number, pageCount: number): number[] {
  const end = Math.min(pageCount, Math.max(page + 2, 5))
  const start = Math.max(1, end - 4)
  return Array.from({ length: Math.min(pageCount, end) - start + 1 }, (_, index) => start + index)
}

export function SupportPage() {
  const { profile } = useAuth()
  const admin = profile?.role === "admin"
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [items, setItems] = useState<SupportTicket[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [writing, setWriting] = useState(false)
  const [selected, setSelected] = useState<SupportTicket | null>(null)
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [kind, setKind] = useState<SupportKind>("inquiry")
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [reply, setReply] = useState("")

  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  async function load(nextPage = page) {
    const { data, error: queryError } = await supabase.rpc("support_ticket_page", { p_page: nextPage, p_size: pageSize })
    if (queryError) throw queryError
    const payload = data as SupportTicketPage
    const count = Number(payload?.total ?? 0)
    const lastPage = Math.max(1, Math.ceil(count / pageSize))
    if (nextPage > lastPage) {
      setPage(lastPage)
      return
    }
    setTotal(count)
    setItems(payload?.items ?? [])
    setSelected((current) => {
      if (!current) return null
      return (payload?.items ?? []).find((item) => item.id === current.id) ?? null
    })
  }

  useEffect(() => {
    if (!profile) return
    let active = true
    setError(null)
    void load(page).catch((caught: unknown) => {
      if (active) setError(humanError(caught))
    })
    return () => {
      active = false
    }
  }, [profile, page])

  function openWrite(nextKind: SupportKind = "inquiry") {
    setWriting(true)
    setSelected(null)
    setEditing(false)
    setConfirmDelete(false)
    setKind(nextKind)
    setTitle("")
    setBody("")
    setError(null)
  }

  function openTicket(ticket: SupportTicket) {
    setWriting(false)
    setEditing(false)
    setConfirmDelete(false)
    setSelected(ticket)
    setKind(ticket.kind)
    setTitle(ticket.title)
    setBody(ticket.body)
    setReply(ticket.reply)
    setError(null)
  }

  function closeModal() {
    setWriting(false)
    setSelected(null)
    setEditing(false)
    setConfirmDelete(false)
  }

  async function submitTicket(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      if (editing && selected) {
        const { error: updateError } = await supabase.rpc("update_support_ticket", {
          p_id: selected.id,
          p_kind: kind,
          p_title: title,
          p_body: body,
        })
        if (updateError) throw updateError
      } else {
        const { error: createError } = await supabase.rpc("create_support_ticket", {
          p_kind: kind,
          p_title: title,
          p_body: body,
        })
        if (createError) throw createError
        if (page !== 1) {
          setPage(1)
          closeModal()
          return
        }
      }
      closeModal()
      await load(editing ? page : 1)
    } catch (caught) {
      setError(humanError(caught))
    } finally {
      setPending(false)
    }
  }

  async function removeTicket() {
    if (!selected) return
    setPending(true)
    setError(null)
    try {
      const { error: deleteError } = await supabase.rpc("delete_support_ticket", { p_id: selected.id })
      if (deleteError) throw deleteError
      closeModal()
      await load(page)
    } catch (caught) {
      setError(humanError(caught))
    } finally {
      setPending(false)
    }
  }

  async function sendReply(status: "answered" | "closed") {
    if (!selected) return
    setPending(true)
    setError(null)
    try {
      const { error: replyError } = await supabase.rpc("reply_support_ticket", {
        p_id: selected.id,
        p_reply: reply,
        p_status: status,
      })
      if (replyError) throw replyError
      await load(page)
      setSelected(null)
    } catch (caught) {
      setError(humanError(caught))
    } finally {
      setPending(false)
    }
  }

  const formOpen = writing || editing

  return (
    <Page
      title="고객센터"
      description="수정요청 혹은 문의 남겨주세요."
      action={<Button onClick={() => openWrite()}>글쓰기</Button>}
    >
      {error && !formOpen && !selected ? (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      ) : null}
      {items.length === 0 ? <p className="text-sm text-muted">등록된 글이 없습니다.</p> : null}
      {items.length > 0 ? (
        <ul className="ds-support-list max-w-3xl">
          {items.map((ticket) => (
            <li key={ticket.id}>
              <button type="button" className="ds-support-row" onClick={() => openTicket(ticket)}>
                <span className={`ds-support-kind is-${ticket.kind}`}>{kindLabel[ticket.kind]}</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{ticket.title}</span>
                  <span className="block truncate text-xs text-muted">
                    {ticket.masked_name}
                    {ticket.mine ? " · 나" : ""} · {formatDateTime(ticket.created_at)}
                  </span>
                </span>
                <span className="text-xs text-muted">{statusLabel[ticket.status]}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <nav className="ds-pager max-w-3xl" aria-label="고객센터 페이지">
        <button type="button" className="ds-pager-button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
          이전
        </button>
        {pageWindow(page, pageCount).map((number) => (
          <button
            key={number}
            type="button"
            className={`ds-pager-button${number === page ? " is-current" : ""}`}
            aria-current={number === page ? "page" : undefined}
            onClick={() => setPage(number)}
          >
            {number}
          </button>
        ))}
        <button type="button" className="ds-pager-button" disabled={page >= pageCount} onClick={() => setPage((current) => current + 1)}>
          다음
        </button>
      </nav>

      {formOpen ? (
        <Modal title={editing ? "글 수정" : "고객센터 글쓰기"} onClose={closeModal}>
          {error ? (
            <div className="mb-3">
              <Alert>{error}</Alert>
            </div>
          ) : null}
          <form className="grid gap-3" onSubmit={(event) => void submitTicket(event)}>
            <Field compact label="종류">
              <select value={kind} onChange={(event) => setKind(event.target.value as SupportKind)}>
                <option value="inquiry">문의</option>
                <option value="correction">개발요청</option>
              </select>
            </Field>
            <Field compact label="제목">
              <input value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} required />
            </Field>
            <Field compact label="내용">
              <textarea value={body} maxLength={2000} rows={6} onChange={(event) => setBody(event.target.value)} required />
            </Field>
            <Button type="submit" disabled={pending}>
              {pending ? "저장 중" : editing ? "수정" : "등록"}
            </Button>
          </form>
        </Modal>
      ) : null}

      {selected && !editing ? (
        <Modal title={selected.title} onClose={closeModal}>
          {error ? (
            <div className="mb-3">
              <Alert>{error}</Alert>
            </div>
          ) : null}
          <div className="grid gap-3 text-sm">
            <p className="text-xs text-muted">
              <span className={`ds-support-kind is-${selected.kind}`}>{kindLabel[selected.kind]}</span>
              <span className="ml-2">
                {selected.masked_name}
                {selected.mine ? " · 나" : ""} · {statusLabel[selected.status]} · {formatDateTime(selected.created_at)}
              </span>
            </p>
            <p className="whitespace-pre-wrap leading-6">{selected.body}</p>
            {selected.reply ? (
              <div className="border border-line px-3 py-2" style={{ borderRadius: 4 }}>
                <p className="text-xs font-semibold text-muted">답변{selected.replied_at ? ` · ${formatDateTime(selected.replied_at)}` : ""}</p>
                <p className="mt-1 whitespace-pre-wrap leading-6">{selected.reply}</p>
              </div>
            ) : null}
            {selected.mine && selected.status === "open" ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEditing(true)
                    setConfirmDelete(false)
                  }}
                >
                  수정
                </Button>
                {confirmDelete ? (
                  <Button variant="danger" disabled={pending} onClick={() => void removeTicket()}>
                    {pending ? "삭제 중" : "정말 삭제"}
                  </Button>
                ) : (
                  <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                    삭제
                  </Button>
                )}
              </div>
            ) : null}
            {admin && selected.status !== "closed" ? (
              <form
                className="grid gap-3"
                onSubmit={(event) => {
                  event.preventDefault()
                  void sendReply("answered")
                }}
              >
                <Field compact label="답변">
                  <textarea value={reply} maxLength={2000} rows={4} onChange={(event) => setReply(event.target.value)} />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" disabled={pending}>
                    {pending ? "저장 중" : "답변"}
                  </Button>
                  <Button variant="ghost" disabled={pending} onClick={() => void sendReply("closed")}>
                    완료
                  </Button>
                </div>
              </form>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </Page>
  )
}
