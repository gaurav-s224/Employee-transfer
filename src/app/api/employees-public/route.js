
import { getAllEmployees } from "@/lib/data"

export async function GET() {
  try {
    const employees = await getAllEmployees()
    return Response.json({ value: employees })
  } catch (err) {
    console.error("employees-public error:", err)
    return Response.json({ value: [] }, { status: 500 })
  }
}