import { useState } from "react"
import { Page } from "../components/ui.tsx"

const items = [
  {
    question: "출퇴근은 어떻게 찍나요?",
    answer:
      "로그인한 휴대폰으로 사업장 출퇴근 태그를 찍으면 출근이 됩니다. 같은 태그를 다시 찍으면 퇴근이 됩니다. 60초 안에 다시 찍으면 새 기록으로 남기지 않습니다.",
  },
  {
    question: "오전반차나 오전반반차가 있으면 출근은 어떻게 되나요?",
    answer:
      "그날 대기 중이거나 승인된 오전반차, 오전반반차가 있으면 출근 기준 시각이 휴가 시간만큼 늦어집니다. 출근 시각이 9시라면 오전반차 4시간은 13시, 오전반반차 2시간은 11시가 기준입니다. 지각 유예는 그 시각 뒤에 붙고, 지각 분은 늦춰진 기준부터 계산합니다. 휴가를 먼저 남긴 다음 출근을 찍어야 하며, 이미 찍힌 출근은 다시 계산하지 않습니다. 오후반차와 오후반반차는 출근 기준을 바꾸지 않습니다.",
  },
  {
    question: "지각은 언제 생기나요?",
    answer:
      "하루의 첫 출근이 출근 기준과 유예를 넘기면 지각입니다. 야근 인정 시각 이후에 출근하면 지각이 아니라 야근 시작입니다. 제재는 사업장 설정에 따라 벌금, 연차 차감, 없음 중 하나입니다.",
  },
  {
    question: "휴가는 어떻게 남기나요?",
    answer:
      "내 휴가에서 날짜를 누르면 달력이 좁아지고 아래에 그날 휴가가 나옵니다. 신청형이면 관리자가 승인한 뒤 차감되고, 대기 중인 신청도 남은 휴가에서 미리 빼 둡니다. 등록형이면 승인 없이 바로 등록됩니다. 연차는 1일, 반차는 0.5일, 반반차는 0.25일입니다. 본인의 휴가는 초록색 점으로 표시됩니다.",
  },
  {
    question: "같은 사업장 휴가도 보이나요?",
    answer:
      "같은 사업장에 등록된 휴가가 날짜 칸의 색 줄로 보입니다. 내 휴가는 날짜 옆의 초록색 점입니다. 날짜를 누르면 아래에 이름, 종류, 일수, 상태가 나옵니다.",
  },
  {
    question: "퇴근을 안 찍으면 어떻게 되나요?",
    answer:
      "같은 날 태그를 다시 찍으면 그 시각이 퇴근입니다. 자정까지 퇴근이 없으면 사업장에 설정된 퇴근 시각으로 퇴근 처리됩니다. 기준 퇴근이 18시면 퇴근 기록은 18시입니다. 다음 날 태그는 새 출근입니다.",
  },
  {
    question: "야근을 하면 보상휴가는 어떻게 쌓이나요?",
    answer:
      "야근 시간은 출근 시각과 야근 인정 시작 중 늦은 쪽부터 퇴근까지입니다. 사업장에 정한 비율로 분을 반올림해 보상휴가가 쌓입니다.",
  },
  {
    question: "초대받은 뒤 비밀번호는 무엇인가요?",
    answer:
      "초기 비밀번호는 없습니다. 초대 메일의 링크에서 본인이 비밀번호를 정합니다. 링크가 만료되면 로그인 화면에서 비밀번호 설정 메일을 다시 받을 수 있습니다.",
  },
  {
    question: "기록 수정이나 문의는 어디에 남기나요?",
    answer: "고객센터에서 수정요청 혹은 문의를 남기면 됩니다. 목록의 이름은 가운데가 가려지고, 글은 10건씩 나뉩니다.",
  },
]

export function FaqPage() {
  const [open, setOpen] = useState<boolean[]>(() => items.map(() => false))

  function toggle(index: number) {
    setOpen((current) => current.map((value, itemIndex) => (itemIndex === index ? !value : value)))
  }

  return (
    <Page title="자주 묻는 질문" description="항목을 누르면 답이 펼쳐집니다.">
      <ul className="ds-faq max-w-3xl">
        {items.map((item, index) => {
          const expanded = open[index]
          const panelId = `faq-answer-${index}`
          return (
            <li key={item.question} className={expanded ? "ds-faq-item is-open" : "ds-faq-item"}>
              <h2>
                <button
                  type="button"
                  className="ds-faq-q"
                  aria-expanded={expanded}
                  aria-controls={panelId}
                  onClick={() => toggle(index)}
                >
                  <span>Q. {item.question}</span>
                  <span className="ds-faq-mark" aria-hidden="true">
                    {expanded ? "−" : "+"}
                  </span>
                </button>
              </h2>
              <div className="ds-faq-a" id={panelId} role="region" aria-label={item.question} aria-hidden={!expanded}>
                <div className="ds-faq-a-inner">
                  <p>{item.answer}</p>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </Page>
  )
}
