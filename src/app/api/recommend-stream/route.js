// src/app/api/recommend-stream/route.js
// Demonstrates: streamObject — Vercel AI SDK Core
// Same as /api/recommend but STREAMS the JSON field by field
// instead of waiting for the complete object

import { streamObject } from "ai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { z } from "zod"
import { getEmployeeById } from "@/lib/data"

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

const RecommendationSchema = z.object({
  recommendation: z.enum([
    "Recommended",
    "Not Recommended", 
    "Conditionally Recommended"
  ]),
  reason:       z.string().describe("2-3 sentence explanation"),
  overallScore: z.number().min(0).max(100),
  ruleResults: z.object({
    isActive:        z.enum(["Pass", "Fail"]),
    tenure:          z.enum(["Pass", "Fail"]),
    targetDept:      z.enum(["Pass", "Fail"]),
    salaryValid:     z.enum(["Pass", "Fail"]),
    recordComplete:  z.enum(["Pass", "Fail"]),
    tenurePreferred: z.enum(["Pass", "Fail"]),
    crossFunctional: z.enum(["Pass", "Fail"]),
    salaryBand:      z.enum(["Pass", "Fail"]),
    seniorityMatch:  z.enum(["Pass", "Fail"]),
  }),
  keyStrengths: z.array(z.string()).describe("Top 2-3 reasons to approve"),
  keyRisks:     z.array(z.string()).describe("Top concerns if any"),
})

export async function POST(req) {
  const { employeeId } = await req.json()
  if (!employeeId) {
    return Response.json({ error: "employeeId required" }, { status: 400 })
  }

  const emp = await getEmployeeById(employeeId)
  if (!emp) {
    return Response.json({ error: "Employee not found" }, { status: 404 })
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

  // streamObject — streams partial JSON as it generates
  // toTextStreamResponse() sends it to the client as a stream
  const result = streamObject({
    model: aicore("gpt-4o-mini"),
    schema: RecommendationSchema,
    prompt: `
      Analyze this employee transfer request and return a structured recommendation.

      Employee: ${emp.firstName} ${emp.lastName} (${emp.employeeId})
      Job Title: ${emp.jobTitle}
      Current Department: ${emp.department}
      Transfer To: ${emp.TransferTo}
      Status: ${emp.status}
      Hire Date: ${emp.hireDate}
      Salary: $${emp.salary}
      Phone: ${emp.phone || "Not provided"}

      Salary bands: IT(70k-130k), Finance(65k-110k), HR(55k-95k),
      Operations(60k-100k), Sales(55k-90k), Marketing(60k-100k)
      
      Tenure months: ${Math.floor((new Date() - new Date(emp.hireDate)) / (1000 * 60 * 60 * 24 * 30))}

      Score each rule Pass/Fail, give overall score 0-100, decide recommendation.
    `,
  })

  // toTextStreamResponse — sends the object stream to the client
  // useObject on the client reads this stream
  return result.toTextStreamResponse()
}