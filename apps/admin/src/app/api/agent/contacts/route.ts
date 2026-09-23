import { authAgentTenantRequest } from "@/lib/agent-auth"
import { getTenantConfig } from "@/lib/tenant-context"
import { buscarPorTelefono, buscarPorTexto, crearContacto } from "@/lib/contactos"

// GET /api/agent/contacts?q=san+martin   → por nombre o CUIT/identificación
// GET /api/agent/contacts?phone=549223...  → por teléfono
//
// Busca clientes de Alegra en el ESPEJO (tabla alegra_contacts, ver lib/contactos.ts): por
// teléfono sin ninguna request a Alegra; por texto, 1 request solo si el espejo no tiene nada.
// Lo usa la tool del agente para resolver a qué contacto
// cotizarle antes de crear la cotización (POST /api/agent/quotes).
//
// La variante por teléfono es la que usa el bot de WhatsApp para saber quién le escribe
// sin preguntarle nada: el número llega verificado por Meta, un nombre lo escribe
// cualquiera. Puede devolver más de un contacto (mismo número cargado en varios); quien
// llama no debe elegir uno, es el caso ambiguo.
//
// POST /api/agent/contacts
//   body: { name, identification?, email?, phone? }
//   Crea un cliente nuevo en Alegra (y lo escribe en el espejo en el momento) cuando el que da su CUIT no existe todavía. Devuelve
//   el contacto (con su price_list_id / payment_term_id, si Alegra los asignó por defecto).
export async function GET(req: Request) {
  try {
    const tenant = await getTenantConfig()
    const auth = authAgentTenantRequest(req, tenant.id)
    if (!auth) {
      console.warn("[agent/contacts] 401 — request sin crm_token válido (Authorization Bearer)")
      return Response.json({ error: "unauthorized" }, { status: 401 })
    }

    const url = new URL(req.url)
    const q = url.searchParams.get("q")?.trim() ?? ""
    const phone = url.searchParams.get("phone")?.trim() ?? ""
    if (!q && !phone) return Response.json({ error: "q o phone es requerido" }, { status: 400 })

    // phone tiene prioridad: es el dato confiable cuando viene de un canal verificado.
    const contacts = phone ? await buscarPorTelefono(tenant, phone) : await buscarPorTexto(tenant, q)
    const criterio = phone ? `phone="${phone}"` : `q="${q}"`
    console.log(`[agent/contacts] tenant=${tenant.id} cliente=${auth.codigocliente} ${criterio} → ${contacts.length}`)

    return Response.json({
      contacts: contacts.map((c) => ({
        id: c.alegraId,
        name: c.name,
        identification: c.identification,
        email: c.email,
        phone: c.phone,
        price_list_id: c.priceListId,
        seller_id: c.sellerId,
        payment_term_id: c.paymentTermId,
      })),
    })
  } catch (err) {
    console.error("agent/contacts error:", err)
    return Response.json({ error: "internal_error" }, { status: 500 })
  }
}

interface CreateContactBody {
  name?: unknown
  identification?: unknown
  email?: unknown
  phone?: unknown
}

export async function POST(req: Request) {
  try {
    const tenant = await getTenantConfig()
    const auth = authAgentTenantRequest(req, tenant.id)
    if (!auth) {
      console.warn("[agent/contacts] 401 — request sin crm_token válido (Authorization Bearer)")
      return Response.json({ error: "unauthorized" }, { status: 401 })
    }

    const body = (await req.json().catch(() => null)) as CreateContactBody | null
    const name = typeof body?.name === "string" ? body.name.trim() : ""
    if (!name) return Response.json({ error: "name es requerido" }, { status: 400 })

    const contact = await crearContacto(tenant, {
      name,
      ...(typeof body?.identification === "string" && body.identification.trim()
        ? { identification: body.identification.trim() }
        : {}),
      ...(typeof body?.email === "string" && body.email.trim() ? { email: body.email.trim() } : {}),
      ...(typeof body?.phone === "string" && body.phone.trim() ? { phone: body.phone.trim() } : {}),
    })

    console.log(`[agent/contacts] POST tenant=${tenant.id} cliente=${auth.codigocliente} → creado ${contact.alegraId}`)

    return Response.json({
      id: contact.alegraId,
      name: contact.name,
      identification: contact.identification,
      email: contact.email,
      phone: contact.phone,
      price_list_id: contact.priceListId,
      seller_id: contact.sellerId,
      payment_term_id: contact.paymentTermId,
    })
  } catch (err) {
    console.error("agent/contacts POST error:", err)
    return Response.json({ error: "internal_error" }, { status: 500 })
  }
}
