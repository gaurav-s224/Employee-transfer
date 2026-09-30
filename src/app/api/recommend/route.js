// src/app/api/recommend/route.js
// Fetches recommendation ONLY from CAP EmployeeRecommendations entity.
// No fallback — if no CAP data exists, returns 404.

import { getEmployeeById } from "@/lib/data"

const CAP_BASE_URL = process.env.CAP_BASE_URL

export async function POST(req) {
  try {
    const body = await req.json()
    const { employeeId } = body

    if (!employeeId) {
      return Response.json({ error: "employeeId required" }, { status: 400 })
    }

    // Get employee name from Employees entity
    const emp = await getEmployeeById(employeeId)
    if (!emp) {
      return Response.json({ error: `Employee ${employeeId} not found` }, { status: 404 })
    }

    // Fetch recommendation from CAP
    const res = await fetch(
      `${CAP_BASE_URL}/employee/EmployeeRecommendations('${employeeId}')`,
      { headers: { Accept: 'application/json' }, cache: 'no-store' }
    )

    if (!res.ok) {
      return Response.json(
        { error: `No recommendation found for ${employeeId}. Please add it via the CAP service.` },
        { status: 404 }
      )
    }

    const capRec = await res.json()

    // Compute tenure months from hireDate
    const tenure = Math.floor(
      (new Date() - new Date(emp.hireDate)) / (1000 * 60 * 60 * 24 * 30)
    )

    // Reshape CAP flat fields → ruleResults object the UI expects
    return Response.json({
      employeeId,
      employeeName: `${emp.firstName} ${emp.lastName}`,
      recommendation: capRec.recommendation,
      reason:         capRec.reason,
      overallScore:   capRec.overallScore,
      tenure,
      createdAt:      capRec.createdAt,
      ruleResults: {
        isActive:        capRec.isActive,
        tenure:          capRec.tenure,
        targetDept:      capRec.targetDept,
        salaryValid:     capRec.salaryValid,
        recordComplete:  capRec.recordComplete,
        tenurePreferred: capRec.tenurePreferred,
        crossFunctional: capRec.crossFunctional,
        salaryBand:      capRec.salaryBand,
        seniorityMatch:  capRec.seniorityMatch,
      },
    })

  } catch (err) {
    console.error("recommend route error:", err)
    return Response.json(
      { error: err.message || "Internal server error" },
      { status: 500 }
    )
  }
}