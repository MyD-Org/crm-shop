import { notFound } from "next/navigation"
import { getGuardedAdminSession } from "@/lib/admin-session"
import { roleRank } from "@/lib/roles"
import { listarPiezas } from "@/lib/marketing/piezas-repo"
import { agruparPorDia, rangoSemana } from "@/lib/marketing/semana"
import { CalendarioSemanal } from "@/components/admin/marketing/CalendarioSemanal"

export const dynamic = "force-dynamic"

export default async function MarketingPage({ searchParams }: { searchParams: Promise<{ semana?: string }> }) {
  const guard = await getGuardedAdminSession()
  if (!guard.ok || roleRank(guard.user.role) < 1) notFound()
  const { semana } = await searchParams
  const { desde, hasta, dias } = rangoSemana(semana)
  const [programadas, sinFecha] = await Promise.all([
    listarPiezas(guard.tenantId, { desde, hasta }),
    listarPiezas(guard.tenantId, { estado: "esperando_material" }),
  ])
  const grupos = agruparPorDia([...programadas, ...sinFecha.filter((p) => !p.programadaPara)], dias)
  return (
    <div className="p-4 md:p-6">
      <div className="mb-6 pl-10 md:pl-0">
        <h1 className="text-lg font-semibold" style={{ color: "var(--ink)" }}>Marketing</h1>
        <p className="text-sm" style={{ color: "var(--ink-soft)" }}>Revise y apruebe las piezas de la semana.</p>
      </div>
      <CalendarioSemanal dias={dias} grupos={grupos} />
    </div>
  )
}
