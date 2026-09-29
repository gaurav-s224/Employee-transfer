// src/app/recommend/page.js
// Demonstrates: useObject — Vercel AI SDK UI
// useObject reads the stream from /api/recommend-stream
// and updates the UI progressively as fields arrive

"use client"
import { useObject } from "@ai-sdk/react"
import { useState } from "react"

export default function RecommendPage() {
  const [employeeId, setEmployeeId] = useState("")

  // useObject — Vercel AI SDK UI hook
  // Connects to /api/recommend-stream
  // object updates field-by-field as the AI streams the JSON
  // isLoading is true while streaming
  const { object, submit, isLoading, stop } = useObject({
    api: "/api/recommend-stream",
  })

  function handleSubmit() {
    if (!employeeId.trim()) return
    submit({ employeeId: employeeId.trim() })
  }

  return (
    <div className="page" style={{ padding: "24px", maxWidth: 700, margin: "0 auto" }}>

      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>
          AI Transfer Recommendation
        </h2>
        <p style={{ color: "#6b7280", fontSize: 13 }}>
          Powered by <strong>streamObject + useObject</strong> — fields stream in as AI generates them
        </p>
      </div>

      {/* Input */}
      <div style={{ display: "flex", gap: 10, marginBottom: 24 }}>
        <input
          value={employeeId}
          onChange={e => setEmployeeId(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleSubmit()}
          placeholder="Enter Employee ID e.g. EMP-0006"
          style={{
            flex: 1, padding: "10px 14px", border: "1px solid #e8eaed",
            borderRadius: 8, fontSize: 14, outline: "none",
          }}
        />
        <button
          onClick={handleSubmit}
          disabled={isLoading || !employeeId.trim()}
          style={{
            padding: "10px 20px", background: "#7c3aed", color: "#fff",
            border: "none", borderRadius: 8, cursor: "pointer",
            opacity: isLoading ? 0.5 : 1, fontSize: 14, fontWeight: 600,
          }}
        >
          {isLoading ? "Analysing…" : "Analyse"}
        </button>
        {isLoading && (
          <button
            onClick={stop}
            style={{
              padding: "10px 20px", background: "#dc2626", color: "#fff",
              border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14,
            }}
          >
            Stop
          </button>
        )}
      </div>

      {/* Result — renders progressively as useObject streams fields in */}
      {object && (
        <div style={{
          border: "1px solid #e8eaed", borderRadius: 10, overflow: "hidden",
        }}>

          {/* Header — appears as soon as recommendation field streams in */}
          {object.recommendation && (
            <div style={{
              padding: "16px 20px",
              background: object.recommendation === "Recommended" ? "#d1fae5"
                : object.recommendation === "Not Recommended" ? "#fee2e2" : "#fef3c7",
              display: "flex", alignItems: "center", gap: 12,
            }}>
              <span style={{ fontSize: 24 }}>
                {object.recommendation === "Recommended" ? "✅"
                  : object.recommendation === "Not Recommended" ? "❌" : "⚠️"}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 16 }}>
                  {object.recommendation}
                </div>
              </div>
              {/* Score streams in separately */}
              {object.overallScore !== undefined && (
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1 }}>
                    {object.overallScore}
                  </div>
                  <div style={{ fontSize: 11, color: "#6b7280" }}>/100</div>
                </div>
              )}
            </div>
          )}

          {/* Reason — streams in word by word */}
          {object.reason && (
            <div style={{ padding: "14px 20px", borderBottom: "1px solid #e8eaed", fontSize: 14, lineHeight: 1.6 }}>
              {object.reason}
              {isLoading && <span style={{ opacity: 0.4 }}>▌</span>}
            </div>
          )}

          {/* Rule results grid — each rule appears as it streams */}
          {object.ruleResults && (
            <div style={{ padding: "14px 20px", borderBottom: "1px solid #e8eaed" }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", marginBottom: 8 }}>
                Rule Results
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                {Object.entries(object.ruleResults).map(([rule, result]) => (
                  result && (
                    <div key={rule} style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}>
                      <span style={{ color: result === "Pass" ? "#059669" : "#dc2626" }}>
                        {result === "Pass" ? "✓" : "✗"}
                      </span>
                      <span>{rule}</span>
                      <span style={{
                        marginLeft: "auto", fontSize: 10, fontWeight: 600,
                        color: result === "Pass" ? "#059669" : "#dc2626",
                      }}>
                        {result}
                      </span>
                    </div>
                  )
                ))}
              </div>
            </div>
          )}

          {/* Key Strengths — array streams in item by item */}
          {object.keyStrengths && object.keyStrengths.length > 0 && (
            <div style={{ padding: "14px 20px", borderBottom: "1px solid #e8eaed" }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#059669", textTransform: "uppercase", marginBottom: 8 }}>
                Key Strengths
              </div>
              {object.keyStrengths.map((s, i) => s && (
                <div key={i} style={{ fontSize: 13, marginBottom: 4 }}>
                  ✦ {s}
                </div>
              ))}
            </div>
          )}

          {/* Key Risks — streams in after strengths */}
          {object.keyRisks && object.keyRisks.length > 0 && (
            <div style={{ padding: "14px 20px" }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#dc2626", textTransform: "uppercase", marginBottom: 8 }}>
                Key Risks
              </div>
              {object.keyRisks.map((r, i) => r && (
                <div key={i} style={{ fontSize: 13, marginBottom: 4 }}>
                  ⚠ {r}
                </div>
              ))}
            </div>
          )}

        </div>
      )}

      {/* Link back to chat */}
      <div style={{ marginTop: 20, textAlign: "center" }}>
        <a href="/assistant" style={{ color: "#7c3aed", fontSize: 13 }}>
          ← Back to Assistant
        </a>
      </div>
    </div>
  )
}