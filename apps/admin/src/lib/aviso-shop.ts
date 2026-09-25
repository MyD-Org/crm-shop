import { registrarAvisoShop } from "@/lib/catalogo-overlay-repo"
import { pingShopRevalidarCatalogo } from "@/lib/shop-revalidar"

// Aviso al Shop de que el catálogo cambió. Vive en un módulo chico propio para que la sync de
// Alegra y el drenaje de stock lo usen sin arrastrar las piezas de los route handlers del panel
// (catalogo-admin.ts lo reexporta, así los llamadores del panel no cambian).
//
// Disparadores (contrato platform/contracts/crm-shop-base/v1, ping de revalidación):
//   - guardado del overlay o de la taxonomía en el panel (/api/admin/catalogo/*)
//   - fin de una sync de Alegra que terminó bien (lib/alegra-sync.ts)
//   - fin de un drenaje de stock con cambios (lib/alegra-stock-cola.ts)

/**
 * Aviso al Shop DESPUÉS de persistir. Nunca bloquea el guardado: el Shop lee estas tablas
 * directo, así que el cambio ya está a la vista; el aviso sólo le hace descartar lo que tenga
 * en caché. De paso registra la frescura que el panel muestra (decisión D1: el CRM informa su
 * propio último aviso entregado, no le pregunta al Shop cuándo sincronizó).
 */
export async function avisarShop(tenantId: string): Promise<{ propagado: boolean }> {
  const { propagado } = await pingShopRevalidarCatalogo()
  try {
    await registrarAvisoShop(tenantId, propagado)
  } catch (err) {
    // La frescura es informativa: que no se pueda registrar no puede tumbar un guardado que ya
    // se persistió.
    console.warn(`[catalogo] no se pudo registrar el aviso al Shop: ${err instanceof Error ? err.name : "error"}`)
  }
  return { propagado }
}
