import { adminNotFoundResponse, requireAdminPlus } from "@/lib/admin-route-guard"
import { avisarShop, conflictoResponse, NO_STORE } from "@/lib/catalogo-admin"
import { leerAtributos, upsertAtributos } from "@/lib/catalogo-atributos-repo"
import { ErrorLecturaFicha, leerFichaPdf, MODELO_FICHA } from "@/lib/catalogo-atributos-pdf"
import { detalleProducto } from "@/lib/catalogo-overlay-repo"
import { R2TooLargeError } from "@/lib/r2"
import { getShopMediaR2 } from "@/lib/shop-media"
import { tomarLectura } from "@/lib/catalogo-atributos-lectura-guarda"

// POST /api/admin/catalogo/productos/[alegraId]/atributos/leer-ficha — botón "Leer ficha técnica".
//
// Lee el PDF de la ficha del producto (la KEY en R2 de `catalog_overlay.ficha_tecnica`, bucket
// público de medios), lo manda a Claude Haiku con un esquema cerrado de salida y guarda lo leído
// con `fuente = 'pdf'`. La precedencia la aplica el upsert: un valor `manual` NO se pisa (se
// informa como `protegidos`). A pedido y de a un producto; el lote masivo es un script aparte.
//
// admin+ (operator → 404). Tenant = el del guard. El PDF nunca pasa por el navegador.
// Cada lectura es una llamada paga: una sola en curso por producto y un tope por tenant por minuto
// (`catalogo-atributos-lectura-guarda.ts`), así los clics repetidos no disparan varias.

export const maxDuration = 60

/** Mismo tope que la subida de la ficha. */
const MAX_BYTES_FICHA = 10 * 1024 * 1024

interface Params {
  params: Promise<{ alegraId: string }>
}

const errorResponse = (error: string, status: number) => Response.json({ error }, { status, headers: NO_STORE })

export async function POST(req: Request, { params }: Params) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const { alegraId } = await params
  const producto = await detalleProducto(guard.tenantId, alegraId)
  if (!producto) return adminNotFoundResponse()
  if (!producto.fichaTecnica) {
    return conflictoResponse("Este producto no tiene ficha técnica cargada. Suba el PDF primero.", "sin_ficha")
  }

  const r2 = getShopMediaR2()
  if (!r2) return errorResponse("El almacenamiento de archivos no está configurado. Avise al administrador.", 503)

  const permiso = tomarLectura(guard.tenantId, alegraId)
  if (!permiso.ok) {
    return permiso.motivo === "en_curso"
      ? errorResponse("Ya se está leyendo la ficha de este producto. Espere a que termine.", 409)
      : errorResponse("Se alcanzó el límite de lecturas por minuto. Inténtelo de nuevo en un momento.", 429)
  }
  try {
    return await leerYGuardar(guard.tenantId, alegraId, producto.nombreEfectivo || alegraId, producto.fichaTecnica.key, r2)
  } finally {
    permiso.liberar()
  }
}

async function leerYGuardar(
  tenantId: string,
  alegraId: string,
  nombre: string,
  key: string,
  r2: NonNullable<ReturnType<typeof getShopMediaR2>>,
): Promise<Response> {
  let pdf: Uint8Array | null
  try {
    pdf = await r2.getObject(key, { maxBytes: MAX_BYTES_FICHA })
  } catch (err) {
    if (err instanceof R2TooLargeError) return errorResponse("La ficha técnica supera el tamaño que se puede leer.", 422)
    console.error(`[leer-ficha] tenant=${tenantId} R2: ${err instanceof Error ? err.name : "error"}`)
    return errorResponse("No se pudo leer el archivo de la ficha técnica. Inténtelo de nuevo.", 502)
  }
  if (!pdf) return errorResponse("No se encontró el archivo de la ficha técnica. Vuelva a subirlo.", 404)

  let lectura
  try {
    lectura = await leerFichaPdf(pdf, nombre)
  } catch (err) {
    if (err instanceof ErrorLecturaFicha) {
      console.warn(`[leer-ficha] tenant=${tenantId} producto=${alegraId} ${err.message}`)
      return errorResponse(err.paraUsuario, err.estado ?? 502)
    }
    throw err
  }

  const escritas = await upsertAtributos(
    tenantId,
    lectura.atributos.map((a) => ({ alegraId, ...a })),
    "pdf",
  )
  if (escritas > 0) await avisarShop(tenantId)
  console.info(
    `[leer-ficha] tenant=${tenantId} producto=${alegraId} modelo=${MODELO_FICHA} leidos=${lectura.atributos.length} ` +
      `escritos=${escritas} tokens=${lectura.uso.entrada}/${lectura.uso.salida}`,
  )

  const atributos = await leerAtributos(tenantId, alegraId)
  return Response.json(
    {
      atributos,
      leidos: lectura.atributos.length,
      // Leídos que no se guardaron porque había un valor manual (o el mismo valor ya guardado).
      sinCambios: lectura.atributos.length - escritas,
    },
    { headers: NO_STORE },
  )
}
