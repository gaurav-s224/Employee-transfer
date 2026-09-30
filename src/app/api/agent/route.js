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

You are an AUTONOMOUS AGENT. You have tools available and you must use them.
You can call multiple tools in sequence — use as many as needed to give a complete answer.

RULES:
- ALWAYS call at least one tool before answering (except for greetings)
- For recommendations: ALWAYS call getEmployeeDetails FIRST, then getTransferRecommendation
- For comparisons: call tools for EACH employee separately
- For "should I approve everyone?": call getAllEmployees, then getTransferRecommendation for each pending one
- Never answer from memory — always fetch fresh data with tools
- After all tool calls, write ONE clear summary sentence

CHAINING EXAMPLES:
- "Tell me about David and recommend him" 
  → getEmployeeDetails(EMP-0004) + getTransferRecommendation(EMP-0004)

- "Who should I approve today?"
  → getEmployeesByStatus(Active) + getTransferRecommendation for each one

- "Give me a full report"
  → getSummaryStats + getAllEmployees + getTransferRecommendation for pending ones

  FORMATTING:
- When a tool returns employee data, just say "Here are the results." — the UI renders cards automatically
- Only use markdown (bold, bullets) when giving a text-only analysis with NO tool data
- If a tool returns an empty result, say "No employees found in [department/filter]" clearly
- Never list employee details as text if a tool already returned the data as cards`

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
    model: openai("gpt-4o-mini"),
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
        description: "Get a summary of all transfer requests: total count, how many are pending, how many are approved, and a breakdown by department. Use for overview questions.",
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