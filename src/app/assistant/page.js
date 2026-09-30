"use client"
import { useState, useRef, useEffect } from "react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import ReactMarkdown from "react-markdown"

const TOOL_LABELS = {
  getAllEmployees:            "Reading all employees",
  getEmployeesByStatus:      "Filtering by approval status",
  getEmployeesByDept:        "Filtering by department",
  getEmployeeDetails:        "Looking up employee",
  getTransferRecommendation: "Running recommendation",
  getSummaryStats:           "Calculating stats",
}

function StatusBadge({ status }) {
  const cls   = status === "Active" ? "pending" : status === "Accept" ? "approved" : "onleave"
  const label = status === "Active" ? "Pending" : status === "Accept" ? "Approved" : status
  return <span className={`badge ${cls}`}>{label}</span>
}

// ---- Single Employee Card (no own state — controlled by parent) --
function EmployeeCard({ emp, isSelected, onRecommend }) {
  return (
    <div className={`emp-card ${isSelected ? "emp-card-selected" : ""}`}>

      {/* Single row — avatar | name | transfer | badge | button */}
      <div className="emp-top">
        <div className="avatar">{emp.firstName[0]}{emp.lastName[0]}</div>

        <div className="emp-info">
          <div className="emp-name">
            {emp.firstName} {emp.lastName}
            <span className="emp-id">{emp.employeeId}</span>
          </div>
          <div className="emp-role">{emp.jobTitle}</div>
        </div>

        <div className="transfer-row">
          <span className="dept from">{emp.department}</span>
          <span className="arrow">→</span>
          <span className="dept to">{emp.TransferTo}</span>
        </div>

        <StatusBadge status={emp.approvalStatus} />

        <button
          className={`rec-btn ${isSelected ? "rec-btn-active" : ""}`}
          onClick={() => onRecommend(emp)}
        >
          {isSelected ? "✕ Close" : "Recommend ✨"}
        </button>
      </div>

      {/* Meta row */}
      <div className="emp-meta">
        <span>✉ {emp.email}</span>
        <span>💰 ${Number(emp.salary).toLocaleString()}</span>
        <span>📅 {new Date(emp.hireDate).toLocaleDateString("en-US",{month:"short",year:"numeric"})}</span>
      </div>
    </div>
  )
}

// ---- Recommendation panel that sits beside all cards ----
function InlineRecommendation({ rec, loading }) {
  if (loading) {
    return (
      <div className="side-rec-panel loading">
        <div className="side-rec-loading">
          <div className="typing"><span/><span/><span/></div>
          <span>Analysing transfer request…</span>
        </div>
      </div>
    )
  }

  if (!rec) return null

  if (rec.error) {
    return (
      <div className="side-rec-panel bad">
        <div className="side-rec-head" style={{background:"var(--red-lt)"}}>
          <span>❌</span>
          <div className="side-rec-title">Failed to load</div>
        </div>
        <p className="side-rec-reason">{rec.error}</p>
      </div>
    )
  }

  const cls  = rec.recommendation === "Recommended"     ? "good"
             : rec.recommendation === "Not Recommended" ? "bad" : "warn"
  const icon = cls === "good" ? "✅" : cls === "bad" ? "❌" : "⚠️"

  return (
    <div className={`side-rec-panel ${cls}`}>
      {/* Header */}
      <div className="side-rec-head">
        <span style={{fontSize:20}}>{icon}</span>
        <div style={{flex:1}}>
          <div className="side-rec-title">{rec.recommendation}</div>
          <div className="side-rec-sub">{rec.employeeName}</div>
        </div>
        <div className="side-rec-score">
          <span className="side-score-num">{rec.overallScore}</span>
          <span style={{fontSize:10,color:"var(--muted)"}}>/100</span>
        </div>
      </div>

      {/* Reason */}
      <p className="side-rec-reason">{rec.reason}</p>

      {/* Rules */}
      <div className="side-rec-rules">
        {Object.entries(rec.ruleResults).map(([rule, result]) => (
          <div key={rule} className={`side-rule ${result === "Pass" ? "pass" : "fail"}`}>
            <span>{result === "Pass" ? "✓" : "✗"}</span>
            <span className="side-rule-name">{rule}</span>
          </div>
        ))}
      </div>

      <div className="side-rec-tenure">Tenure: {rec.tenure} months</div>
    </div>
  )
}

// ---- Employee List — owns the recommendation state ------
// When any card is selected, ALL cards shrink to left column
// and recommendation appears in right panel beside them
function EmployeeList({ employees }) {
  const [selectedEmp, setSelectedEmp] = useState(null)
  const [rec,         setRec]         = useState(null)
  const [loading,     setLoading]     = useState(false)

  async function handleRecommend(emp) {
    // Clicking same card again → close
    if (selectedEmp?.employeeId === emp.employeeId) {
      setSelectedEmp(null)
      setRec(null)
      return
    }

    // New card selected
    setSelectedEmp(emp)
    setRec(null)
    setLoading(true)

    try {
      const res  = await fetch("/api/recommend", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ employeeId: emp.employeeId }),
      })
      const text = await res.text()
      if (!res.ok || !text) {
        setRec({ error: `Server error ${res.status}` })
        return
      }
      setRec(JSON.parse(text))
    } catch (e) {
      setRec({ error: e.message })
    } finally {
      setLoading(false)
    }
  }

  const hasPanel = !!(selectedEmp && (loading || rec))
  const recCls   = rec?.recommendation === "Recommended"     ? "good"
                 : rec?.recommendation === "Not Recommended" ? "bad"
                 : rec && !rec.error                         ? "warn" : ""

  return (
    // Two-column grid when panel is open, single column otherwise
    <div className={`emp-list-grid ${hasPanel ? "panel-open" : ""}`}>

      {/* LEFT — all cards, shrink when panel is open */}
      <div className="emp-list-cards">
        {employees.map(emp => (
          <EmployeeCard
            key={emp.employeeId}
            emp={emp}
            isSelected={selectedEmp?.employeeId === emp.employeeId}
            onRecommend={handleRecommend}
          />
        ))}
      </div>

      {/* RIGHT — recommendation panel, only visible when a card is selected */}
      {hasPanel && (
        <div className={`emp-list-panel ${recCls}`}>
          <InlineRecommendation rec={rec} loading={loading} />
        </div>
      )}
    </div>
  )
}

// ---- Full Recommendation Panel (returned by agent tool) -
function RecommendationPanel({ rec }) {
  const cls  = rec.recommendation === "Recommended" ? "good"
    : rec.recommendation === "Not Recommended" ? "bad" : "warn"
  const icon = cls === "good" ? "✅" : cls === "bad" ? "❌" : "⚠️"
  return (
    <div className={`rec-panel ${cls}`}>
      <div className="rec-head">
        <span className="rec-icon">{icon}</span>
        <div>
          <div className="rec-title">{rec.recommendation}</div>
          <div className="rec-sub">{rec.employeeName} · {rec.employeeId}</div>
        </div>
        <div className="rec-score">
          <span className="score-num">{rec.overallScore}</span>/100
        </div>
      </div>
      <p className="rec-reason">{rec.reason}</p>
      <div className="rec-rules">
        {Object.entries(rec.ruleResults).map(([rule, result]) => (
          <div key={rule} className={`rule ${result === "Pass" ? "pass" : "fail"}`}>
            {result === "Pass" ? "✓" : "✗"} {rule}
          </div>
        ))}
      </div>
      <div className="rec-tenure">Tenure: {rec.tenure} months</div>
    </div>
  )
}

function StatsPanel({ stats }) {
  return (
    <div className="stats-panel">
      <div className="kpis">
        <div className="kpi"><span className="kv">{stats.total}</span>Total</div>
        <div className="kpi"><span className="kv">{stats.pending}</span>Pending</div>
        <div className="kpi green"><span className="kv">{stats.approved}</span>Approved</div>
      </div>
      <div className="dept-breakdown">
        {Object.entries(stats.byDept).map(([d, n]) => (
          <div key={d} className="dept-row">
            <span>{d}</span>
            <div className="bar-wrap">
              <div className="bar" style={{ width: `${(n / stats.total) * 100}%` }} />
            </div>
            <span>{n}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ToolOutput({ toolName, data }) {
  if (data === null || data === undefined) return null

  if (Array.isArray(data) && data.length === 0) {
    return (
      <div className="tool-result">
        <div className="empty-result">No employees found for this query.</div>
      </div>
    )
  }

  // Array of employees — use EmployeeList so all cards share one rec state
  if (Array.isArray(data) && data[0]?.employeeId) {
    return (
      <div className="tool-result">
        <div className="result-label">
          {data.length} employee{data.length !== 1 ? "s" : ""}
        </div>
        <EmployeeList employees={data} />
      </div>
    )
  }

  // Single employee
  if (data?.employeeId && !data.recommendation) {
    return (
      <div className="tool-result">
        <EmployeeList employees={[data]} />
      </div>
    )
  }

  if (data?.recommendation) {
    return <div className="tool-result"><RecommendationPanel rec={data} /></div>
  }

  if (data?.total !== undefined) {
    return <div className="tool-result"><StatsPanel stats={data} /></div>
  }

  return <pre className="raw">{JSON.stringify(data, null, 2)}</pre>
}

function ThinkingLoader({ label }) {
  return (
    <div className="row assistant">
      <div className="bubble assistant">
        <div className="bubble-label">Assistant</div>
        <div className="thinking">
          <div className="typing"><span /><span /><span /></div>
          {label && <span className="thinking-label">{label}</span>}
        </div>
      </div>
    </div>
  )
}

const SUGGESTIONS = [
  "Show all transfer requests",
  "Who has been approved?",
  "Who is still pending?",
  "Recommendation for EMP-0006",
  "Show employees from IT",
  "Give me a summary",
]

export default function AssistantPage() {
  const [input, setInput] = useState("")
  const scrollRef = useRef(null)

  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: "/api/agent" }),
  })

  const busy      = status === "streaming" || status === "submitted"
  const isWaiting = status === "submitted"

  useEffect(() => {
    if (scrollRef.current)
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, busy])

  function send(text) {
    const msg = (text || input).trim()
    if (!msg || busy) return
    setInput("")
    sendMessage({ text: msg })
  }

  const lastMessage  = messages[messages.length - 1]
  const runningTool  = lastMessage?.role === "assistant"
    ? lastMessage.parts?.find(p =>
        p.type?.startsWith("tool-") && p.state !== "output-available"
      )
    : null
  const runningLabel = runningTool
    ? TOOL_LABELS[runningTool.type?.replace("tool-", "")] || "Working…"
    : null

  return (
    <div className="page">
      <header className="header">
        <div className="header-icon">⇄</div>
        <div>
          <h1>Employee Transfer Assistant</h1>
          <p>AI-powered employee transfer management</p>
        </div>
      </header>

      <div className="messages" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="empty">
            <div style={{ fontSize: 40 }}>💬</div>
            <p>Ask me about employee transfer requests</p>
            <div className="chips">
              {SUGGESTIONS.map(s => (
                <button key={s} className="chip" onClick={() => send(s)}>{s}</button>
              ))}
            </div>
          </div>
        )}

        {messages.map(message => (
          <div key={message.id} className={`row ${message.role}`}>
            <div className={`bubble ${message.role}`}>
              <div className="bubble-label">
                {message.role === "user" ? "You" : "Assistant"}
              </div>

              {message.parts?.map((part, i) => {
                if (part.type === "text") {
                  if (!part.text?.trim()) return null
                  return (
                    <div key={i} className="bubble-text markdown-body">
                      <ReactMarkdown>{part.text}</ReactMarkdown>
                    </div>
                  )
                }

                if (part.type?.startsWith("tool-")) {
                  if (part.state !== "output-available") {
                    const toolName = part.type.replace("tool-", "")
                    return (
                      <div key={i} className="tool-trace">
                        <span className="dot" />
                        {TOOL_LABELS[toolName] || toolName}…
                      </div>
                    )
                  }
                  const toolName = part.type.replace("tool-", "")
                  return (
                    <ToolOutput key={i} toolName={toolName} data={part.output} />
                  )
                }

                if (part.type === "step-start") return null
                return null
              })}
            </div>
          </div>
        ))}

        {isWaiting && <ThinkingLoader label="Thinking…" />}
        {status === "streaming" && runningLabel && (
          <ThinkingLoader label={runningLabel} />
        )}
      </div>

      <div className="input-bar">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && send()}
          placeholder="Ask about transfers, approvals, recommendations…"
          disabled={busy}
        />
        <button
          onClick={() => send()}
          disabled={busy || !input.trim()}
          className="send-btn"
        >{busy ? "…" : "↑"}</button>
      </div>
    </div>
  )
}