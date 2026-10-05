// src/app/api/agent/route.js
// HARNESS AGENT — Vercel AI SDK Core
//
// maxSteps: 10 means the AI can chain up to 10 tool calls automatically.
// The AI decides which tools to call and in what order.
// We just give it tools + a goal — it figures out the steps.

import { streamText, tool, convertToModelMessages } from "ai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { z } from "zod"
import {
  getAllEmployees,
  getEmployeesByApprovalStatus,
  getEmployeesByDepartment,
  getEmployeeById,
  getSummaryStats,
  generateRecommendation,
} from "@/lib/data"

let cachedToken = null
let tokenExpiry  = 0

async function getAICoreToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken
  const res = await fetch(`${process.env.AICORE_AUTH_URL}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(
        `${process.env.AICORE_CLIENT_ID}:${process.env.AICORE_CLIENT_SECRET}`
      ).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`AI Core auth failed: ${JSON.stringify(data)}`)
  cachedToken = data.access_token
  tokenExpiry  = Date.now() + (data.expires_in - 60) * 1000
  return cachedToken
}

// ---- System prompt — this is what makes it a harness agent --
// We tell the AI it CAN and SHOULD chain multiple tools together
const SYSTEM_PROMPT = `You are an Employee Transfer Assistant for Accenture HR.

You are an AUTONOMOUS AGENT. You MUST use tools. Never answer from memory.

STRICT RULES — no exceptions:
- ANY question about employees → call a tool first
- ANY question about numbers, counts, breakdown, summary, statistics → call getSummaryStats
- ANY question about department breakdown → call getSummaryStats
- ANY question about pending/approved counts → call getSummaryStats
- Greetings like "hi", "hello" → reply with text only (no tool needed)

FORBIDDEN: Never write employee data or statistics as text bullets or lists.
The UI renders charts and cards automatically from tool results.
After a tool runs, write only ONE short sentence summarizing what was found.

TOOL MAPPING:
- "breakdown by department" → getSummaryStats
- "how many pending/approved" → getSummaryStats  
- "summary / overview / statistics" → getSummaryStats
- "show employees / list employees" → getAllEmployees
- "pending employees" → getEmployeesByStatus(Active)
- "approved employees" → getEmployeesByStatus(Accept)
- "employees from [dept]" → getEmployeesByDept
- "tell me about / details for [employee]" → getEmployeeDetails
- "recommend / should we approve [employee]" → getTransferRecommendation`

export async function POST(req) {
  const body = await req.json()
  if (!Array.isArray(body.messages)) {
    return Response.json({ error: "messages array required" }, { status: 400 })
  }

  const token  = await getAICoreToken()

  const aicore = createOpenAICompatible({
    name: "aicore",
    baseURL: process.env.AICORE_DEPLOYMENT_URL.replace(
      "/chat/completions?api-version=2024-05-01-preview", ""
    ),
    headers: {
      Authorization: `Bearer ${token}`,
      "AI-Resource-Group": process.env.AICORE_RESOURCE_GROUP,
    },
    fetch: async (url, options) => {
      const sep = url.includes("?") ? "&" : "?"
      return fetch(`${url}${sep}api-version=2024-05-01-preview`, options)
    },
  })

  const modelMessages = await convertToModelMessages(body.messages)

  const result = streamText({
    model: aicore("gpt-4o-mini"),
    system: SYSTEM_PROMPT,
    messages: modelMessages,

    // ---- THIS is the harness --------------------------------
    // maxSteps tells the SDK to keep the agent loop running.
    // After each tool call, the AI decides: am I done, or do
    // I need to call another tool? It keeps going until either:
    // 1. It decides it has enough information to answer
    // 2. It hits maxSteps (safety limit)
    maxSteps: 10,

    // onStepFinish — fires after EVERY tool call step
    // Great for logging/debugging the agent's chain of thought
    onStepFinish({ stepType, toolCalls, toolResults, finishReason, usage }) {
      console.log(`\n--- Agent Step: ${stepType} ---`)
      if (toolCalls?.length) {
        toolCalls.forEach(tc => {
          console.log(`  Tool called: ${tc.toolName}`)
          console.log(`  Input:`, JSON.stringify(tc.args))
        })
      }
      if (toolResults?.length) {
        toolResults.forEach(tr => {
          const preview = JSON.stringify(tr.result)?.slice(0, 100)
          console.log(`  Result preview: ${preview}...`)
        })
      }
      console.log(`  Finish reason: ${finishReason}`)
      console.log(`  Tokens used: ${usage?.totalTokens}`)
    },

    tools: {

      getAllEmployees: tool({
        description: "Get ALL employees with their transfer requests. Use this for overview questions or when you need to see everyone.",
        inputSchema: z.object({}),
        execute: async () => {
          console.log("[Tool] getAllEmployees called")
          return getAllEmployees()
        },
      }),

      getEmployeesByStatus: tool({
        description: 'Filter employees by approval status. "Active" = pending review, "Accept" = already approved. Use this when user asks about pending or approved transfers.',
        inputSchema: z.object({
          status: z.enum(["Active", "Accept"]).describe(
            "Active = pending transfers, Accept = approved transfers"
          ),
        }),
        execute: async ({ status }) => {
          console.log(`[Tool] getEmployeesByStatus: ${status}`)
          return getEmployeesByApprovalStatus(status)
        },
      }),

      getEmployeesByDept: tool({
        description: "Get employees by department. direction: 'from' = currently in that dept, 'to' = wants to move there, 'any' = either.",
        inputSchema: z.object({
          department: z.string().describe("e.g. Sales, HR, IT, Finance, Marketing, Operations"),
          direction: z.enum(["from", "to", "any"]).default("any"),
        }),
        execute: async ({ department, direction }) => {
          console.log(`[Tool] getEmployeesByDept: ${department} (${direction})`)
          return getEmployeesByDepartment(department, direction)
        },
      }),

      getEmployeeDetails: tool({
        description: "Get complete details for ONE specific employee by their ID. Always call this before getTransferRecommendation.",
        inputSchema: z.object({
          employeeId: z.string().describe("Employee ID like EMP-0006"),
        }),
        execute: async ({ employeeId }) => {
          console.log(`[Tool] getEmployeeDetails: ${employeeId}`)
          return getEmployeeById(employeeId)
        },
      }),

      getTransferRecommendation: tool({
        description: "Run an AI-powered recommendation analysis for an employee's transfer. Returns score 0-100, Pass/Fail for each rule, and Recommended/Not Recommended decision. Call getEmployeeDetails first.",
        inputSchema: z.object({
          employeeId: z.string().describe("Employee ID like EMP-0006"),
        }),
        execute: async ({ employeeId }) => {
          console.log(`[Tool] getTransferRecommendation: ${employeeId}`)
          return generateRecommendation(employeeId)
        },
      }),

      getSummaryStats: tool({
  description: `Get summary statistics for ALL transfer requests.
    ALWAYS call this for:
    - "breakdown by department"
    - "summary" or "overview"  
    - "how many pending" or "how many approved"
    - "statistics" or "counts"
    - any question asking for numbers about transfers
    Returns: total count, pending count, approved count, department breakdown.`,
  inputSchema: z.object({}),
  execute: async () => {
    console.log("[Tool] getSummaryStats called")
    return getSummaryStats()
  },
}),

    },
  })

  return result.toUIMessageStreamResponse()
}