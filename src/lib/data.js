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
  // Fetch ONLY from CAP — no fallback
  const emp = await getEmployeeById(employeeId)
  if (!emp) return null

  const res = await fetch(
    `${process.env.CAP_BASE_URL}/employee/EmployeeRecommendations('${employeeId}')`,
    { headers: { Accept: 'application/json' }, cache: 'no-store' }
  )

  if (!res.ok) {
    return {
      employeeId,
      employeeName: `${emp.firstName} ${emp.lastName}`,
      error: `No recommendation found in CAP for ${employeeId}.`,
    }
  }

  const capRec = await res.json()

  const tenure = Math.floor(
    (new Date() - new Date(emp.hireDate)) / (1000 * 60 * 60 * 24 * 30)
  )

  return {
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
  }
}

// ---- Fetch recommendation from CAP EmployeeRecommendations --
export async function getRecommendationFromCAP(employeeId) {
  try {
    const data = await cap(`EmployeeRecommendations('${employeeId}')`)
    if (!data?.employeeId) return null
    return data
  } catch {
    return null  // 404 or any error → return null → agent uses fallback
  }
}