import { notFound } from "next/navigation"
import { getGuardedAdminSession } from "@/lib/admin-session"
import { listarCategoriasConUso, listarTags } from "@/lib/catalogo-overlay-repo"
import { basePublicaFotos } from "@/lib/shop-media"
import { roleRank } from "@/lib/roles"
import { CatalogoShell } from "@/components/admin/catalogo/CatalogoShell"

export const dynamic = "force-dynamic"

// Panel de catálogo: admin+ (operator → 404, igual que Comprobantes y Configuración). No pide
// superadmin a propósito: curar el catálogo es trabajo diario, no una configuración del sistema.
//
// La primera página de productos la pide el shell por API (tiene sus propios filtros); acá sólo
// se siembran la taxonomía y las etiquetas, que las tres solapas comparten.
export default async function CatalogoPage() {
  const guard = await getGuardedAdminSession()
  if (!guard.ok || roleRank(guard.user.role) < 1) notFound()

  const [categorias, tags] = await Promise.all([
    listarCategoriasConUso(guard.tenantId),
    listarTags(guard.tenantId),
  ])

  // La url se compone acá, al servir: en la base sólo vive la key.
  const base = basePublicaFotos()
  const conUrlDeImagen = categorias.map((c) => ({
    ...c,
    imagenUrl: base && c.imagenKey ? `${base}/${c.imagenKey}` : null,
  }))

  return (
    <div className="p-4 md:p-6">
      {/* pl-10 md:pl-0: en mobile corre el título para que no lo tape el botón de navegación. */}
      <div className="mb-4 md:mb-6 pl-10 md:pl-0">
        <h1 className="text-lg font-semibold" style={{ color: "var(--ink)" }}>Catálogo</h1>
        <p className="hidden md:block text-sm mt-0.5" style={{ color: "var(--ink-soft)" }}>
          Qué muestra la tienda: nombres, categorías, etiquetas y publicación
        </p>
      </div>
      <CatalogoShell initialCategorias={conUrlDeImagen} initialTags={tags} />
    </div>
  )
}
