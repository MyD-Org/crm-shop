/**
 * Tenant del Shop. SOLO servidor: ningún componente `"use client"` lo importa.
 *
 * El Shop comparte la base con el CRM y cada pedido se escribe y se lee con
 * `tenant_id`. El valor sale de `SHOP_TENANT_ID` (el slug de `tenants.id` del
 * CRM) y NO tiene valor por defecto a propósito: un "default" silencioso
 * guardaría pedidos que ningún operador ve en el admin, y nadie se enteraría
 * hasta que un cliente reclame. Sin tenant, el Shop no opera.
 *
 * Se lee en cada llamada y no a nivel de módulo: evaluarlo al importar rompería
 * el build y los tests de cualquier archivo que lo toque de rebote.
 */
export function shopTenantId(): string {
  const v = process.env.SHOP_TENANT_ID?.trim();
  if (!v) {
    throw new Error(
      "Falta SHOP_TENANT_ID en el entorno. El Shop no opera sin tenant: configure la variable (slug de tenants.id)."
    );
  }
  return v;
}
