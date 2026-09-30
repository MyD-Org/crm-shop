import { createContactRaw, findContactByIdentifier, type AlegraContactInput } from "./alegra"
import { crearContacto } from "./contactos"
import type { TenantConfig } from "./tenants"

// Contacto de Alegra del cliente de un pedido en la cuenta con la que se factura (change
// `sucursales-igz-mdp`, rebanada D). `orders.cliente_codigo` es el id del contacto en la cuenta
// PRINCIPAL; en una secundaria ese id no existe y NUNCA se reutiliza: se busca por documento y, si
// no está, se crea. Crear en una secundaria NO escribe el espejo de contactos (que es el padrón de
// la principal del tenant): un contacto de otra cuenta lo ensuciaría.

/** Crea el contacto en la cuenta de `config`; sólo la principal escribe el espejo (write-through). */
export async function crearContactoEnCuenta(
  config: TenantConfig,
  input: AlegraContactInput,
  cuentaPrincipal: boolean,
): Promise<{ alegraId: string }> {
  if (cuentaPrincipal) return crearContacto(config, input)
  const raw = await createContactRaw(config, input)
  return { alegraId: String(raw.id) }
}

/**
 * Contacto del pedido en la cuenta. Principal: el `cliente_codigo` del pedido. Otra cuenta: por
 * documento o creado. Devuelve `null` si no hay forma de identificarlo (sin documento ni nombre).
 */
export async function contactoDelPedidoEnCuenta(
  config: TenantConfig,
  pedido: { clienteCodigo: string | null; facturacionNroDoc: string | null; facturacionRazonSocial: string | null; contactoNombre: string; clienteEmail: string | null },
  cuentaPrincipal: boolean,
): Promise<{ alegraId: string; esNuevo: boolean } | null> {
  if (cuentaPrincipal && pedido.clienteCodigo) return { alegraId: pedido.clienteCodigo, esNuevo: false }
  const documento = pedido.facturacionNroDoc?.trim()
  if (documento) {
    const existente = await findContactByIdentifier(config, documento)
    if (existente) return { alegraId: existente.alegraId, esNuevo: false }
  }
  const nombre = pedido.facturacionRazonSocial?.trim() || pedido.contactoNombre
  if (!nombre) return null
  const creado = await crearContactoEnCuenta(
    config,
    { name: nombre, identification: documento || undefined, email: pedido.clienteEmail?.trim() || undefined },
    cuentaPrincipal,
  )
  return { alegraId: creado.alegraId, esNuevo: true }
}
