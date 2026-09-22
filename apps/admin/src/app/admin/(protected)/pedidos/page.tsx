import { notFound } from "next/navigation"
import { getGuardedAdminSession } from "@/lib/admin-session"
import { PEDIDOS_DEFAULT_LIMIT, listarPedidos, toPedidoDto } from "@/lib/pedidos-repo"
import { isKnownAdminRole } from "@/lib/roles"
import { PedidosShell } from "@/components/admin/pedidos/PedidosShell"

export const dynamic = "force-dynamic"

// Sección abierta desde operator: misma lista explícita de roles que `requireOperatorPlus` en
// la API (operator | admin | superadmin); cualquier otro rol → 404. El layout protegido ya
// corrió el guard y redirige si no hay sesión; acá se repite para tener el tenant verificado
// por host y el rol FRESCO de la base, nunca los de la cookie.
export default async function PedidosPage() {
  const guard = await getGuardedAdminSession()
  if (!guard.ok || !isKnownAdminRole(guard.user.role)) notFound()

  // Primera página sin filtro, directo del repo (no se le pega a la propia API). El shell
  // refetcha por la API al montar y al cambiar de filtro/página.
  const { items, total } = await listarPedidos(guard.tenantId, { estado: "todos" })

  return (
    <div className="p-4 md:p-6">
      {/* pl-10 md:pl-0: en mobile corre el título para que no lo tape el botón ☰ del sidebar. */}
      <div className="mb-4 md:mb-6 pl-10 md:pl-0">
        <h1 className="text-lg font-semibold" style={{ color: "var(--ink)" }}>Pedidos</h1>
        <p className="hidden md:block text-sm mt-0.5" style={{ color: "var(--ink-soft)" }}>
          Pedidos realizados desde la tienda
        </p>
      </div>
      <PedidosShell
        initialItems={items.map(toPedidoDto)}
        initialTotal={total}
        pageSize={PEDIDOS_DEFAULT_LIMIT}
      />
    </div>
  )
}
