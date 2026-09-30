// src/lib/data.js

import { z } from "zod"

const CAP_BASE_URL = process.env.CAP_BASE_URL

// ---- fetch helper -----------------------------------------
async function cap(path) {
  const res = await fetch(`${CAP_BASE_URL}/employee/${path}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`CAP error ${res.status}: ${text}`)
  }
  const json = await res.json()
  return json.value !== undefined ? json.value : json
}

function normalize(emp) {
  return {
    ...emp,
    TransferTo: emp.transferTo,
    approvalStatus:
      emp.approvalStatus === 'Pending' ? 'Active' :
      emp.approvalStatus,
  }
}

// ---- Salary bands -----------------------------------------
const SALARY_BANDS = {
  IT:         { min: 70000, max: 130000 },
  Finance:    { min: 65000, max: 110000 },
  HR:         { min: 55000, max: 95000 },
  Operations: { min: 60000, max: 100000 },
  Sales:      { min: 55000, max: 90000 },
  Marketing:  { min: 60000, max: 100000 },
}

// ---- AI Core token (shared) --------------------------------
let cachedToken = null
let tokenExpiry  = 0





// ---- Data functions ----------------------------------------

export async function getAllEmployees() {
  const data = await cap('Employees')
  return data.map(normalize)
}

export async function getEmployeesByApprovalStatus(status) {
  const capStatus = status === 'Active' ? 'Pending' : status
  const data = await cap(`Employees?$filter=approvalStatus eq '${capStatus}'`)
  return data.map(normalize)
}

export async function getEmployeesByDepartment(dept, direction = 'any') {
  const d = dept.toLowerCase()
  const all = await getAllEmployees()
  return all.filter(e => {
    const isFrom = e.department?.toLowerCase() === d
    const isTo   = e.TransferTo?.toLowerCase() === d
    if (direction === 'from') return isFrom
    if (direction === 'to')   return isTo
    return isFrom || isTo
  })
}

export async function getEmployeeById(employeeId) {
  const emp = await cap(`Employees('${employeeId}')`)
  return normalize(emp)
}

export async function getSummaryStats() {
  const all = await getAllEmployees()
  const byDept = {}
  all.forEach(e => {
    byDept[e.department] = (byDept[e.department] || 0) + 1
  })
  return {
    total:    all.length,
    pending:  all.filter(e => e.approvalStatus === 'Active').length,
    approved: all.filter(e => e.approvalStatus === 'Accept').length,
    byDept,
  }
}

export async function generateRecommendation(employeeId) {
  // Fast rule-based recommendation — no AI call needed here
  // generateObject is used in /api/recommend for the dedicated page
  const emp = await getEmployeeById(employeeId)
  if (!emp) return null

  const tenure = Math.floor(
    (new Date() - new Date(emp.hireDate)) / (1000 * 60 * 60 * 24 * 30)
  )
  const salary = parseFloat(emp.salary)
  const band   = SALARY_BANDS[emp.TransferTo]

  const ruleResults = {
    isActive:        emp.status === 'Active'                    ? 'Pass' : 'Fail',
    tenure:          tenure >= 12                               ? 'Pass' : 'Fail',
    targetDept:      emp.TransferTo !== emp.department          ? 'Pass' : 'Fail',
    salaryValid:     salary > 0                                 ? 'Pass' : 'Fail',
    recordComplete:  !!(emp.email && emp.phone && emp.hireDate) ? 'Pass' : 'Fail',
    tenurePreferred: tenure >= 24                               ? 'Pass' : 'Fail',
    crossFunctional: emp.TransferTo !== emp.department          ? 'Pass' : 'Fail',
    salaryBand:      band
      ? (salary >= band.min && salary <= band.max               ? 'Pass' : 'Fail')
      : 'Pass',
    seniorityMatch:  /senior|lead|manager/i.test(emp.jobTitle) ? 'Pass' : 'Fail',
  }

  const weights = {
    isActive: 20, tenure: 15, targetDept: 10, salaryValid: 10,
    recordComplete: 5, tenurePreferred: 10, crossFunctional: 5,
    salaryBand: 15, seniorityMatch: 10,
  }

  const total        = Object.values(weights).reduce((a, b) => a + b, 0)
  const scored       = Object.entries(ruleResults)
    .reduce((s, [k, v]) => s + (v === 'Pass' ? weights[k] : 0), 0)
  const overallScore = Math.round((scored / total) * 100)


  const hardFails    = ['isActive','tenure','targetDept','salaryValid']
    .filter(k => ruleResults[k] === 'Fail')

  const recommendation = hardFails.length > 0 ? 'Not Recommended'
    : overallScore >= 80 ? 'Recommended' : 'Conditionally Recommended'

  const reason = hardFails.length > 0
    ? `Does not meet minimum requirements. Failed: ${hardFails.join(', ')}.`
    : `Employee is ${emp.status} with ${tenure} months tenure. Salary $${salary.toLocaleString()} is ${
        ruleResults.salaryBand === 'Pass' ? 'within' : 'outside'
      } the ${emp.TransferTo} band. Score: ${overallScore}/100.`

      
  return {
    employeeId,
    employeeName: `${emp.firstName} ${emp.lastName}`,
    recommendation,
    reason,
    ruleResults,
    overallScore,
    tenure,
    keyStrengths: Object.entries(ruleResults)
      .filter(([, v]) => v === 'Pass').map(([k]) => k).slice(0, 3),
    keyRisks: Object.entries(ruleResults)
      .filter(([, v]) => v === 'Fail').map(([k]) => k),
  }
}