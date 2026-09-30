// src/app/api/recommend/route.js
// Uses fast rule-based logic — instant response, no AI timeout issues.
// generateObject is demonstrated in /api/recommend-stream instead.

import { getEmployeeById } from "@/lib/data"

const SALARY_BANDS = {
  IT:         { min: 70000, max: 130000 },
  Finance:    { min: 65000, max: 110000 },
  HR:         { min: 55000, max: 95000 },
  Operations: { min: 60000, max: 100000 },
  Sales:      { min: 55000, max: 90000 },
  Marketing:  { min: 60000, max: 100000 },
}

export async function POST(req) {
  try {
    const body = await req.json()
    const { employeeId } = body

    if (!employeeId) {
      return Response.json({ error: "employeeId required" }, { status: 400 })
    }

    const emp = await getEmployeeById(employeeId)
    if (!emp) {
      return Response.json({ error: `Employee ${employeeId} not found` }, { status: 404 })
    }

    const tenure = Math.floor(
      (new Date() - new Date(emp.hireDate)) / (1000 * 60 * 60 * 24 * 30)
    )
    const salary = parseFloat(emp.salary)
    const band   = SALARY_BANDS[emp.TransferTo]

    const ruleResults = {
      isActive:        emp.status === "Active"                    ? "Pass" : "Fail",
      tenure:          tenure >= 12                               ? "Pass" : "Fail",
      targetDept:      emp.TransferTo !== emp.department          ? "Pass" : "Fail",
      salaryValid:     salary > 0                                 ? "Pass" : "Fail",
      recordComplete:  !!(emp.email && emp.phone && emp.hireDate) ? "Pass" : "Fail",
      tenurePreferred: tenure >= 24                               ? "Pass" : "Fail",
      crossFunctional: emp.TransferTo !== emp.department          ? "Pass" : "Fail",
      salaryBand:      band
        ? (salary >= band.min && salary <= band.max               ? "Pass" : "Fail")
        : "Pass",
      seniorityMatch:  /senior|lead|manager/i.test(emp.jobTitle) ? "Pass" : "Fail",
    }

    const weights = {
      isActive: 20, tenure: 15, targetDept: 10, salaryValid: 10,
      recordComplete: 5, tenurePreferred: 10, crossFunctional: 5,
      salaryBand: 15, seniorityMatch: 10,
    }
    const total        = Object.values(weights).reduce((a, b) => a + b, 0)
    const scored       = Object.entries(ruleResults)
      .reduce((s, [k, v]) => s + (v === "Pass" ? weights[k] : 0), 0)
    const overallScore = Math.round((scored / total) * 100)

    const hardFails = ["isActive","tenure","targetDept","salaryValid"]
      .filter(k => ruleResults[k] === "Fail")

    const recommendation = hardFails.length > 0 ? "Not Recommended"
      : overallScore >= 80 ? "Recommended" : "Conditionally Recommended"

    const reason = hardFails.length > 0
      ? `Does not meet minimum requirements. Failed: ${hardFails.join(", ")}.`
      : `Employee is ${emp.status} with ${tenure} months tenure. Salary $${salary.toLocaleString()} is ${
          ruleResults.salaryBand === "Pass" ? "within" : "outside"
        } the ${emp.TransferTo} band. Score: ${overallScore}/100.`

    const keyStrengths = Object.entries(ruleResults)
      .filter(([, v]) => v === "Pass").map(([k]) => k).slice(0, 3)
    const keyRisks = Object.entries(ruleResults)
      .filter(([, v]) => v === "Fail").map(([k]) => k)

    return Response.json({
      employeeId,
      employeeName: `${emp.firstName} ${emp.lastName}`,
      recommendation,
      reason,
      ruleResults,
      overallScore,
      tenure,
      keyStrengths,
      keyRisks,
    })

  } catch (err) {
    console.error("recommend route error:", err)
    return Response.json(
      { error: err.message || "Internal server error" },
      { status: 500 }
    )
  }
}