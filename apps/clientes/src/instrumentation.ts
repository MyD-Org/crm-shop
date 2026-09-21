import { shopTenantId } from "@/lib/tenant";

/**
 * Next llama a `register` una vez por instancia del server, y tiene que
 * terminar antes de atender el primer request. Se usa para que un deploy sin
 * `SHOP_TENANT_ID` falle al arrancar y no recién cuando alguien confirma un
 * pedido: `shopTenantId()` tira igual en cada uso, pero ese error aparecería
 * como un 500 en el checkout de un cliente.
 *
 * Durante `next build` no se exige: ahí no se atiende a nadie y la variable
 * puede no estar (CI). Next ya saltea `register` en esa fase; la condición queda
 * explícita para no depender de ese detalle interno.
 */
export function register(): void {
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  shopTenantId();
}
