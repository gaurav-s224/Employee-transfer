"use client"
import { useState, useRef, useEffect } from "react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"

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

function EmployeeCard({ emp }) {
  return (
    <div className="emp-card">
      <div className="emp-head">
        <div className="avatar">{emp.firstName[0]}{emp.lastName[0]}</div>
        <div className="emp-info">
          <div className="emp-name">
            {emp.firstName} {emp.lastName}
            <span className="emp-id">{emp.employeeId}</span>
          </div>
          <div className="emp-role">{emp.jobTitle}</div>
        </div>
        <StatusBadge status={emp.approvalStatus} />
      </div>
      <div className="transfer-row">
        <span className="dept from">{emp.department}</span>
        <span className="arrow">→</span>
        <span className="dept to">{emp.TransferTo}</span>
      </div>
      <div className="emp-meta">
        <span>✉ {emp.email}</span>
        <span>💰 ${Number(emp.salary).toLocaleString()}</span>
        <span>📅 {new Date(emp.hireDate).toLocaleDateString("en-US",{month:"short",year:"numeric"})}</span>
      </div>
    </div>
  )
}

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
  if (!data) return null

  // Array of employees
  if (Array.isArray(data) && data[0]?.employeeId) {
    return (
      <div className="tool-result">
        <div className="result-label">
          {data.length} employee{data.length !== 1 ? "s" : ""}
        </div>
        {data.map(emp => <EmployeeCard key={emp.employeeId} emp={emp} />)}
      </div>
    )
  }
  // Single employee
  if (data?.employeeId && !data.recommendation) {
    return <div className="tool-result"><EmployeeCard emp={data} /></div>
  }
  // Recommendation
  if (data?.recommendation) {
    return <div className="tool-result"><RecommendationPanel rec={data} /></div>
  }
  // Stats
  if (data?.total !== undefined) {
    return <div className="tool-result"><StatsPanel stats={data} /></div>
  }
  return <pre className="raw">{JSON.stringify(data, null, 2)}</pre>
}

const SUGGESTIONS = [
  "Show all transfer requests",
  "Who has been approved?",
  "Who is still pending?",
  "Recommendation for David Lee",
  "Show employees from Sales",
  "Give me a summary",
]

export default function AssistantPage() {
  const [input, setInput] = useState("")
  const scrollRef = useRef(null)

  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: "/api/agent" }),
  })

  const busy = status === "streaming"

  useEffect(() => {
    if (scrollRef.current)
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages])

  function send(text) {
    const msg = (text || input).trim()
    if (!msg || busy) return
    setInput("")
    sendMessage({ text: msg })
  }

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

        // Plain text
        if (part.type === "text") {
          return <div key={i} className="bubble-text">{part.text}</div>
        }

        // Tool part — your SDK uses "tool-{toolName}" as the type
        // e.g. "tool-getAllEmployees", "tool-getTransferRecommendation"
        if (part.type?.startsWith("tool-")) {

          // Still running
          if (part.state !== "output-available") {
            const toolName = part.type.replace("tool-", "")
            return (
              <div key={i} className="tool-trace">
                <span className="dot" />
                {TOOL_LABELS[toolName] || toolName}…
              </div>
            )
          }

          // Finished — data is in part.output
          const toolName = part.type.replace("tool-", "")
          return (
            <ToolOutput key={i} toolName={toolName} data={part.output} />
          )
        }

        // step-start marker — ignore it
        if (part.type === "step-start") return null

        return null
      })}

    </div>
  </div>
))}

        {busy && (
          <div className="row assistant">
            <div className="bubble assistant">
              <div className="bubble-label">Assistant</div>
              <div className="typing"><span /><span /><span /></div>
            </div>
          </div>
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
        >↑</button>
      </div>
    </div>
  )
}