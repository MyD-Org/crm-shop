import { createContactRaw, findContactByIdentifier, type AlegraContactInput } from "./alegra"
import { crearContacto } from "./contactos"
import type { TenantConfig } from "./tenants"

// Contacto de Alegra del cliente de un pedido en la cuenta con la que se factura (change
// `sucursales-igz-mdp`, rebanada D). `orders.cliente_codigo` es el id del contacto en la cuenta
// PRINCIPAL; en una secundaria ese id no existe y NUNCA se reutiliza: se busca por documento y, si
// no está, se crea. Crear en una secundaria NO escribe el espejo de contactos (que es el padrón de
// la principal del tenant): un contacto de otra cuenta lo ensuciaría.

// Condición de IVA del Shop (`orders.facturacion_condicion_iva`) → la de Alegra. Mismo mapeo que
// `apps/clientes/src/lib/contacto-alegra.ts`. Sin dato se usa consumidor final: algunas cuentas de
// Alegra (AR) rechazan el alta sin condición de IVA (code 2055).
const IVA_SHOP_A_ALEGRA: Record<string, string> = {
  consumidor_final: "FINAL_CONSUMER",
  responsable_inscripto: "IVA_RESPONSABLE",
  monotributo: "UNIQUE_TRIBUTE_RESPONSABLE",
  exento: "IVA_EXEMPT",
}
// Tipos de documento que Alegra acepta en `identificationObject.type` (no tiene CUIL).
const TIPOS_DOC_ALEGRA = new Set(["CUIT", "DNI"])

type PedidoParaContacto = {
  clienteCodigo: string | null
  facturacionNroDoc: string | null
  facturacionTipoDoc?: string | null
  facturacionCondicionIva?: string | null
  facturacionRazonSocial: string | null
  contactoNombre: string
  clienteEmail: string | null
}

/** Datos para crear en Alegra el contacto de un pedido (nombre, documento, condición de IVA, email). */
export function contactoInputDelPedido(pedido: PedidoParaContacto): AlegraContactInput {
  const documento = pedido.facturacionNroDoc?.trim() || undefined
  const tipo = pedido.facturacionTipoDoc?.trim().toUpperCase()
  return {
    name: pedido.facturacionRazonSocial?.trim() || pedido.contactoNombre,
    identification: documento,
    identificationType: documento && tipo && TIPOS_DOC_ALEGRA.has(tipo) ? tipo : undefined,
    ivaCondition: IVA_SHOP_A_ALEGRA[pedido.facturacionCondicionIva?.trim() ?? ""] ?? "FINAL_CONSUMER",
    email: pedido.clienteEmail?.trim() || undefined,
  }
}

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
  pedido: PedidoParaContacto,
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
  const creado = await crearContactoEnCuenta(config, contactoInputDelPedido(pedido), cuentaPrincipal)
  return { alegraId: creado.alegraId, esNuevo: true }
}
