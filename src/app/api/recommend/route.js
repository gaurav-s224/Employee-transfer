// src/app/api/recommend/route.js
// Demonstrates: generateObject — Vercel AI SDK Core
// generateObject forces the AI to return structured JSON matching a Zod schema.
// No free-text — guaranteed shape every time.

import { generateObject } from "ai"
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

// This Zod schema is the contract — generateObject GUARANTEES this shape
const RecommendationSchema = z.object({
  recommendation: z.enum([
    "Recommended",
    "Not Recommended",
    "Conditionally Recommended"
  ]),
  reason: z.string().describe("2-3 sentence explanation of the decision"),
  overallScore: z.number().min(0).max(100).describe("Score out of 100"),
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
  keyStrengths:  z.array(z.string()).describe("Top 2-3 reasons to approve"),
  keyRisks:      z.array(z.string()).describe("Top 1-2 concerns if any"),
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

  // generateObject — unlike streamText, this returns a guaranteed JSON object
  // matching the RecommendationSchema. No parsing, no validation needed.
  const { object } = await generateObject({
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
      Email: ${emp.email}
      Phone: ${emp.phone || "Not provided"}

      Rules to evaluate:
      - isActive: employee status must be "Active"
      - tenure: must have worked 12+ months
      - targetDept: TransferTo must be different from current department
      - salaryValid: salary must be greater than 0
      - recordComplete: email, phone, and hireDate must all be present
      - tenurePreferred: 24+ months is preferred
      - crossFunctional: moving across different departments is good
      - salaryBand: salary should fit the target department's typical range
      - seniorityMatch: job title should match a senior/lead/manager level

      Salary bands: IT(70k-130k), Finance(65k-110k), HR(55k-95k), 
      Operations(60k-100k), Sales(55k-90k), Marketing(60k-100k)

      Score each rule Pass or Fail, give an overall score 0-100, 
      and decide: Recommended / Conditionally Recommended / Not Recommended.
    `,
  })

  return Response.json({
    employeeId,
    employeeName: `${emp.firstName} ${emp.lastName}`,
    tenure: Math.floor(
      (new Date() - new Date(emp.hireDate)) / (1000 * 60 * 60 * 24 * 30)
    ),
    ...object,
  })
}