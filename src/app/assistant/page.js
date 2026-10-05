"use client"
import { useState, useRef, useEffect } from "react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import ReactMarkdown from "react-markdown"
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts"



import { Sparkles, SendHorizontal } from "lucide-react"


import { createContext, useContext } from "react"
const ChatContext = createContext(null)

const TOOL_LABELS = {
  getAllEmployees: "Reading all employees",
  getEmployeesByStatus: "Filtering by approval status",
  getEmployeesByDept: "Filtering by department",
  getEmployeeDetails: "Looking up employee",
  getTransferRecommendation: "Running recommendation",
  getSummaryStats: "Calculating stats",
}

function StatusBadge({ status }) {
  const cls = status === "Active" ? "pending" : status === "Accept" ? "approved" : "onleave"
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
        <span>📅 {new Date(emp.hireDate).toLocaleDateString("en-US", { month: "short", year: "numeric" })}</span>
      </div>
    </div>
  )
}

// Add this function above InlineRecommendation
function highlightNumbers(text) {
  if (!text) return text
  // Matches: $72,000 | 44 months | 90/100 | 12+ | 65k-110k | 85,000.00
  const parts = text.split(/(\$[\d,]+(?:\.\d+)?(?:k)?|[\d,]+(?:\.\d+)?(?:k)?(?:\+)?(?:\s*(?:months|years|%))?|\d+\/\d+|\d+k-\d+k)/gi)
  return parts.map((part, i) => {
    const isNumber = /(\$[\d,]+|\d+[\w\/\-+%k]|\d+\s*(months|years|%)|\d+\/\d+|\d+k-\d+k)/i.test(part)
    return isNumber
      ? <strong key={i} style={{
        fontWeight: 700,
        color: "var(--teal-700)",
        background: "var(--teal-50)",
        padding: "0 3px",
        borderRadius: "3px",
        fontSize: "12px",
      }}>{part}</strong>
      : part
  })
}

// ---- Recommendation panel that sits beside all cards ----
function InlineRecommendation({ rec, loading }) {
  if (loading) {
    return (
      <div className="side-rec-panel loading">
        <div className="side-rec-loading">
          <div className="typing"><span /><span /><span /></div>
          <span>Analysing transfer request…</span>
        </div>
      </div>
    )
  }

  if (!rec) return null

  if (rec.error) {
    return (
      <div className="side-rec-panel warn">
        <div className="side-rec-head" style={{ background: "var(--amber-lt)" }}>
          <span style={{ fontSize: 20 }}>📭</span>
          <div>
            <div className="side-rec-title">No Recommendation Yet</div>
            <div className="side-rec-sub">{rec.error}</div>
          </div>
        </div>
        <p className="side-rec-reason" style={{ color: "var(--muted)", fontStyle: "italic" }}>
          Add a recommendation for this employee via the CAP service to see results here.
        </p>
      </div>
    )
  }

  const cls = rec.recommendation === "Recommended" ? "good"
    : rec.recommendation === "Not Recommended" ? "bad" : "warn"
  const icon = cls === "good" ? "✅" : cls === "bad" ? "❌" : "⚠️"

  return (
    <div className={`side-rec-panel ${cls}`}>
      {/* Header */}
      <div className="side-rec-head">
        <span style={{ fontSize: 20 }}>{icon}</span>
        <div style={{ flex: 1 }}>
          <div className="side-rec-title">{rec.recommendation}</div>
          <div className="side-rec-sub">{rec.employeeName}</div>
        </div>
        <div className="side-rec-score">
          <span className="side-score-num">{rec.overallScore}</span>
          <span style={{ fontSize: 10, color: "var(--muted)" }}>/100</span>
        </div>
      </div>

      {/* Reason */}
      <p className="side-rec-reason">{highlightNumbers(rec.reason)}</p>

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
  const [rec, setRec] = useState(null)
  const [loading, setLoading] = useState(false)

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
      const res = await fetch("/api/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: emp.employeeId }),
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
  const recCls = rec?.recommendation === "Recommended" ? "good"
    : rec?.recommendation === "Not Recommended" ? "bad"
      : rec && !rec.error ? "warn" : ""

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
  const cls = rec.recommendation === "Recommended" ? "good"
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



// Custom tooltip for pie chart — shows employee names + emails
function PieTooltipContent({ active, payload }) {
  if (!active || !payload?.length) return null
  const entry = payload[0]
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-title" style={{ color: entry.payload.color }}>
        {entry.name} — {entry.value} employees
      </div>
      {entry.payload.employees?.map(emp => (
        <div key={emp.employeeId} className="chart-tooltip-row">
          <span className="chart-tooltip-name">
            {emp.firstName} {emp.lastName}
          </span>
          <span className="chart-tooltip-email">{emp.email}</span>
        </div>
      ))}
      <div className="chart-tooltip-hint">Click to view in chat</div>
    </div>
  )
}

// Custom tooltip for bar chart — shows employee names
function BarTooltipContent({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const entry = payload[0]
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-title" style={{ color: "#0d9488" }}>
        {label} — {entry.value} employee{entry.value !== 1 ? "s" : ""}
      </div>
      {entry.payload.employees?.map(emp => (
        <div key={emp.employeeId} className="chart-tooltip-row">
          <span className="chart-tooltip-name">
            {emp.firstName} {emp.lastName}
          </span>
          <span className="chart-tooltip-email">{emp.jobTitle}</span>
        </div>
      ))}
      <div className="chart-tooltip-hint">Click to view in chat</div>
    </div>
  )
}

const CHART_COLORS = [
  "#0d9488",   // teal — IT
  "#8b5cf6",   // violet — Finance  
  "#f59e0b",   // amber — Marketing
  "#3b82f6",   // blue — HR
  "#ec4899",   // pink — Sales
  "#10b981",   // emerald — Operations
]

function StatsPanel({ stats }) {
  const { send, busy } = useContext(ChatContext)
  const [allEmployees, setAllEmployees] = useState([])

  // Fetch employees once to power the tooltips
  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_CAP_BASE_URL}/employee/Employees`, {
      headers: { Accept: "application/json" }
    })
      .then(r => r.json())
      .then(d => setAllEmployees(d.value || []))
      .catch(() => {})
  }, [])

  // Build pie data with employee lists attached
  const pendingEmps  = allEmployees.filter(e => e.approvalStatus === "Pending")
  const approvedEmps = allEmployees.filter(e => e.approvalStatus === "Accept")

  const pieData = [
    { name: "Pending",  value: stats.pending,  color: "#d97706", employees: pendingEmps },
    { name: "Approved", value: stats.approved, color: "#059669", employees: approvedEmps },
  ]

  // Build bar data with employee lists attached
  const deptData = Object.entries(stats.byDept).map(([dept, count], i) => ({
    dept,
    count,
    fill: CHART_COLORS[i % CHART_COLORS.length],
    employees: allEmployees.filter(
    e => e.department?.toLowerCase() === dept.toLowerCase()  // ← case insensitive
  ),
  }))

  // Click handlers — trigger chat message
  function handlePieClick(data) {
    if (!data || busy) return
    const status = data.name  // "Pending" or "Approved"
    if (status === "Pending") {
      send("Show me all employees who are pending approval")
    } else {
      send("Show me all employees who have been approved")
    }
  }

  function handleBarClick(data) {
    if (!data || busy) return
    send(`Show me all employees from the ${data.dept} department`)
  }

  return (
    <div className="stats-panel-new">

      {/* KPI row */}
      <div className="stats-kpis-row">
        <div className="stats-kpi">
          <span className="stats-kpi-num total">{stats.total}</span>
          <span className="stats-kpi-lbl">Total Requests</span>
        </div>
        <div className="stats-kpi">
          <span className="stats-kpi-num pending">{stats.pending}</span>
          <span className="stats-kpi-lbl">Pending</span>
        </div>
        <div className="stats-kpi">
          <span className="stats-kpi-num approved-num">{stats.approved}</span>
          <span className="stats-kpi-lbl">Approved</span>
        </div>
      </div>

      {/* Charts */}
      <div className="stats-charts-row">

        {/* Pie chart */}
        <div className="stats-chart-card">
          <div className="stats-chart-title">Approval Status</div>
          <div className="chart-hint">Hover for details · Click to explore</div>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={75}
                paddingAngle={4}
                dataKey="value"
                onClick={handlePieClick}
                style={{ cursor: "pointer" }}
              >
                {pieData.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={entry.color}
                    stroke="none"
                    style={{ outline: "none" }}
                  />
                ))}
              </Pie>
              <Tooltip content={<PieTooltipContent />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="pie-legend">
            {pieData.map((entry, i) => (
              <div
                key={i}
                className="pie-legend-item clickable"
                onClick={() => handlePieClick(entry)}
              >
                <span className="pie-dot" style={{ background: entry.color }} />
                <span>{entry.name}</span>
                <span className="pie-val">{entry.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Bar chart */}
        <div className="stats-chart-card">
          <div className="stats-chart-title">By Department</div>
          <div className="chart-hint">Hover for details · Click to explore</div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart
              data={deptData}
              margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
              barSize={32}
              onClick={(data) => data?.activePayload && handleBarClick(data.activePayload[0].payload)}
              style={{ cursor: "pointer" }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis
                dataKey="dept"
                tick={{ fontSize: 11, fill: "#64748b" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 11, fill: "#64748b" }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<BarTooltipContent />}
              cursor={{ fill: "rgba(13,148,136,0.08)" }} />
              <Bar dataKey="count" radius={[8,8,0,0]}>
                {deptData.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

      </div>
    </div>
  )
}

const TOOL_SECTION_LABELS = {
  getAllEmployees: { icon: "👥", label: "All Employees" },
  getEmployeesByStatus: { icon: "🔍", label: "Filtered Employees" },
  getEmployeesByDept: { icon: "🏢", label: "Department Filter" },
  getEmployeeDetails: { icon: "👤", label: "Employee Details" },
  getTransferRecommendation: { icon: "⚡", label: "Transfer Recommendation" },
  getSummaryStats: { icon: "📊", label: "Summary Statistics" },
}

function ToolOutput({ toolName, data }) {
  if (data === null || data === undefined) return null

  const section = TOOL_SECTION_LABELS[toolName] || { icon: "📋", label: toolName }

  if (Array.isArray(data) && data.length === 0) {
    return (
      <div className="tool-section">
        <div className="tool-section-header">
          <span className="tool-section-icon">{section.icon}</span>
          <span className="tool-section-label">{section.label}</span>
        </div>
        <div className="empty-result">No employees found for this query.</div>
      </div>
    )
  }

  if (Array.isArray(data) && data[0]?.employeeId) {
    return (
      <div className="tool-section">
        <div className="tool-section-header">
          <span className="tool-section-icon">{section.icon}</span>
          <span className="tool-section-label">{section.label}</span>
          <span className="tool-section-count">
            {data.length} employee{data.length !== 1 ? "s" : ""}
          </span>
        </div>
        <EmployeeList employees={data} />
      </div>
    )
  }

  if (data?.employeeId && !data.recommendation) {
    return (
      <div className="tool-section">
        <div className="tool-section-header">
          <span className="tool-section-icon">{section.icon}</span>
          <span className="tool-section-label">{section.label}</span>
        </div>
        <EmployeeList employees={[data]} />
      </div>
    )
  }

  if (data?.recommendation) {
    return (
      <div className="tool-section">
        <div className="tool-section-header">
          <span className="tool-section-icon">{section.icon}</span>
          <span className="tool-section-label">{section.label}</span>
        </div>
        <RecommendationPanel rec={data} />
      </div>
    )
  }

  if (data?.total !== undefined) {
    return (
      <div className="tool-section">
        <div className="tool-section-header">
          <span className="tool-section-icon">{section.icon}</span>
          <span className="tool-section-label">{section.label}</span>
        </div>
        <StatsPanel stats={data} />
      </div>
    )
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

  const busy = status === "streaming" || status === "submitted"
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

  const lastMessage = messages[messages.length - 1]
  const runningTool = lastMessage?.role === "assistant"
    ? lastMessage.parts?.find(p =>
      p.type?.startsWith("tool-") && p.state !== "output-available"
    )
    : null
  const runningLabel = runningTool
    ? TOOL_LABELS[runningTool.type?.replace("tool-", "")] || "Working…"
    : null

  return (
    <ChatContext.Provider value={{ send, busy }}>
    <div className="page">
      <header className="header">
        <div className="header-icon">
          <Sparkles size={22} color="#fff" />
        </div>
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

                  const hasToolsBefore = message.parts
                    .slice(0, i)
                    .some(p => p.type?.startsWith("tool-") && p.state === "output-available")

                  return (
                    <div key={i}>
                      {hasToolsBefore && <div className="text-divider" />}
                      <div className="bubble-text markdown-body">
                        <ReactMarkdown>{part.text}</ReactMarkdown>
                      </div>
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
        >
          {busy ? "…" : <SendHorizontal size={18} color="#fff" />}
        </button>
      </div>
    </div>
    </ChatContext.Provider>
  )
}