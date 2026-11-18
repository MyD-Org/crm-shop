import { requireSeccion } from "@/lib/admin-route-guard"
import { parearItemEnCuentaPorCodigo } from "@/lib/alegra-items-cuenta"
import { configAlegraDeCuenta, cuentaActivaPorSlug, MSG_CUENTA_NO_EXISTE } from "@/lib/compras-config-repo"
import { fail, ok, responderError } from "@/lib/compras-http"
import {
  cuitConGuiones,
  digitosCuit,
  elegirProductoPorCodigo,
  ErrorLecturaFactura,
  leerFacturaTexto,
  netoCalculado,
  textoPorRenglones,
  type LineaLeida,
} from "@/lib/compras-leer-factura"
import { buscarProductosCompra, type ProductoCompraDto } from "@/lib/compras-productos-repo"
import { buscarProveedores, type ProveedorDto } from "@/lib/compras-proveedores-repo"
import { extraerItemsPaginas, PdfIlegible } from "@/lib/catalogo-ficha-texto"

// POST /api/admin/compras/leer-pdf (multipart: `archivo` PDF + `cuenta` slug) — lee la factura o
// remito del proveedor y devuelve los datos para PRELLENAR «Nueva compra». No escribe nada: ni en
// la base ni en Alegra. El usuario revisa y corrige antes de registrar.

export const maxDuration = 60

const MAX_BYTES = 10 * 1024 * 1024

export async function POST(req: Request) {
  const guard = await requireSeccion(req, "compras")
  if (!guard.ok) return guard.response

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return fail(400, "pedido_invalido", "Adjunte el PDF de la factura.")
  }
  const archivo = form.get("archivo")
  const slug = String(form.get("cuenta") ?? "").trim()
  if (!(archivo instanceof File) || archivo.size === 0) return fail(400, "sin_archivo", "Adjunte el PDF de la factura.")
  if (archivo.size > MAX_BYTES) return fail(413, "archivo_grande", "El PDF supera los 10 MB.")
  const cuenta = slug ? await cuentaActivaPorSlug(guard.tenantId, slug) : null
  if (!cuenta) return fail(404, "cuenta_inexistente", MSG_CUENTA_NO_EXISTE)

  let texto: string
  try {
    const paginas = await extraerItemsPaginas(new Uint8Array(await archivo.arrayBuffer()))
    texto = paginas.map(textoPorRenglones).join("\n\n").trim()
  } catch (err) {
    if (err instanceof PdfIlegible) return fail(422, "pdf_ilegible", "No se pudo abrir el PDF. Verifique el archivo o cargue la compra a mano.")
    return responderError(err, { tenant: guard.tenantId })
  }
  if (texto.length < 40) {
    return fail(422, "pdf_sin_texto", "El PDF no tiene texto (parece escaneado). Cargue la compra a mano.")
  }

  try {
    const factura = await leerFacturaTexto(texto)
    const destino = { id: cuenta.id, slug: cuenta.slug, nombre: cuenta.nombre, principal: cuenta.principal }

    // Proveedor por CUIT (con guiones o sólo dígitos, según cómo esté en el espejo).
    let proveedor: ProveedorDto | null = null
    if (factura.cuitEmisor) {
      for (const q of [cuitConGuiones(factura.cuitEmisor), digitosCuit(factura.cuitEmisor)]) {
        const r = await buscarProveedores(guard.tenantId, cuenta, q, null, 2)
        if (r.proveedores.length === 1) {
          proveedor = r.proveedores[0]
          break
        }
      }
    }

    // Productos por código. Se agrupan las líneas repetidas del mismo producto y costo.
    const items: { producto: ProductoCompraDto; linea: LineaLeida }[] = []
    let config: Awaited<ReturnType<typeof configAlegraDeCuenta>> | undefined
    const sinProducto: (LineaLeida & { motivo: string })[] = []
    for (const linea of factura.lineas) {
      if (!linea.codigo) {
        sinProducto.push({ ...linea, motivo: "Sin código en el documento" })
        continue
      }
      const candidatos = await buscarProductosCompra(guard.tenantId, destino, linea.codigo, 20)
      const p = elegirProductoPorCodigo(linea.codigo, candidatos)
      if (!p) {
        sinProducto.push({ ...linea, motivo: "No se encontró el producto en el catálogo" })
        continue
      }
      let producto = p
      if (p.sinItemEnCuenta) {
        // Como «Buscar en Alegra»: busca el ítem por código en la cuenta (sólo lectura) y guarda el par.
        config ??= await configAlegraDeCuenta(guard.tenantId, cuenta)
        const r = await parearItemEnCuentaPorCodigo(guard.tenantId, config, destino, p.alegraId).catch(() => null)
        if (!r?.ok) {
          sinProducto.push({ ...linea, motivo: r?.error ?? `No se pudo buscar ${p.codigo ?? "el producto"} en ${cuenta.nombre}` })
          continue
        }
        producto = { ...p, itemIdCuenta: r.id, sinItemEnCuenta: false }
      }
      const previo = items.find((x) => x.producto.alegraId === producto.alegraId)
      if (previo && previo.linea.costo === linea.costo) previo.linea = { ...previo.linea, cantidad: previo.linea.cantidad + linea.cantidad }
      else if (previo) sinProducto.push({ ...linea, motivo: "Producto repetido con otro costo" })
      else items.push({ producto, linea })
    }

    return ok({
      tipoDocumento: factura.tipoDocumento,
      proveedor,
      proveedorLeido: factura.cuitEmisor || factura.razonSocialEmisor ? { cuit: factura.cuitEmisor, nombre: factura.razonSocialEmisor } : null,
      numeroFactura: factura.numeroFactura,
      fecha: factura.fecha,
      vencimiento: factura.vencimiento,
      descuentoGeneralPct: factura.descuentoGeneralPct,
      items: items.map(({ producto, linea }) => ({
        alegraId: producto.alegraId,
        nombre: producto.nombre,
        codigo: producto.codigo,
        cantidad: linea.cantidad,
        costo: linea.costo,
        ivaPct: linea.ivaPct ?? producto.ivaPorcentaje,
      })),
      sinProducto,
      percepciones: factura.percepciones,
      control: {
        netoCalculado: netoCalculado(factura.lineas),
        subtotalNetoLeido: factura.subtotalNetoLeido,
        totalLeido: factura.totalLeido,
      },
    })
  } catch (err) {
    if (err instanceof ErrorLecturaFactura) {
      console.error("[compras/leer-pdf]", err.message)
      return fail(err.estado, "lectura_fallida", err.paraUsuario)
    }
    return responderError(err, { tenant: guard.tenantId })
  }
}
