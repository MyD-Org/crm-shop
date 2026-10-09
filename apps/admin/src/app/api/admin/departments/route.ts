import { NextResponse } from "next/server"
import { asc, eq } from "drizzle-orm"
import { getDb } from "@/db"
import { departments } from "@/db/schema"
import { requireOperatorPlus } from "@/lib/admin-route-guard"

// Catálogo de departamentos del tenant, usado por el select del alta/edición de usuarios.
// Antes estaba hardcodeado en UserList.tsx; ahora vive en la tabla `departments` para que
// sea configurable por tenant y compartible con ai-api (ver /api/internal/departments).
export async function GET(req: Request) {
  const guard = await requireOperatorPlus(req)
  if (!guard.ok) return guard.response

  const rows = await getDb()
    .select({ key: departments.key, label: departments.label })
    .from(departments)
    .where(eq(departments.tenantId, guard.tenantId))
    .orderBy(asc(departments.label))

  return NextResponse.json(rows)
}
