import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { SECCIONES_TILDABLES, esSeccionClave, type SeccionClave } from "@/lib/secciones"

// Test a nivel FUENTE: deny-by-default de las rutas API y páginas del backoffice.
//
// 1. Rol «compras» (el de siempre): `roleRank` manda todo rol desconocido (y "compras") a 0, el mismo
//    rango que operator. Toda ruta/página tiene que referenciar un guard que lo deja afuera.
// 2. Permisos por sección (change `permisos-por-seccion`): todo archivo resuelve, por el prefijo más
//    largo de su carpeta, a una entrada del MAPA (carpeta nueva sin mapear = falla). En las carpetas
//    de SECCIÓN el archivo usa `requireSeccion(`/`accesoSeccion(` con claves incluidas en su entrada
//    y nunca un guard de rol pelado. Las carpetas que todavía usan los guards viejos están en
//    CARPETAS_PENDIENTES (se migran en S2b; el último PR la deja vacía).
const SRC = fileURLToPath(new URL("..", import.meta.url))
const API = "app/api/admin/"
const PAGINAS = "app/admin/(protected)/"

function archivos(dir: string, nombre: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir)) {
    const ruta = join(dir, e)
    if (statSync(ruta).isDirectory()) out.push(...archivos(ruta, nombre))
    else if (e === nombre) out.push(ruta)
  }
  return out
}

const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8")

// ---------------------------------------------------------------------------------------------
// 1. Rol «compras»
// ---------------------------------------------------------------------------------------------

// Guards que dejan afuera al rol "compras" (rank >= 1, allow-list de los tres roles conocidos, o la
// política por sección, que a «compras» sólo le concede Compras).
const GUARDS = [
  /\brequireSeccion\b/,
  /\baccesoSeccion\b/,
  /\brequireAdminPlus\b/,
  /\brequireOperatorPlus\b/,
  /\brequireSucursalesAccess\b/,
  /\baccesoCompras\b/, // páginas de Compras: wrapper de accesoSeccion("compras") (lib/compras-acceso.ts)
  /\brequireCorreoAdmin\b/,
  /\brequireCorreoLector\b/,
  /\brequireSuperadmin\w*\b/,
  /\bisKnownAdminRole\b/,
  /\bcanManageUsers\b/,
  /\broleRank\([^)]*\)\s*</, // comparación de rango mínimo (un `>= 1` suelto no es un gate)
  /\.role\s*!==\s*"superadmin"/,
]

// Excepciones: rutas que NO son del backoffice autenticado por rol (o que se autentican por otro
// medio). Cada una con su motivo.
const EXCEPCIONES: Record<string, string> = {
  // Login, logout, 2FA, expiración de sesión: corren ANTES de tener sesión (o la destruyen).
  "app/api/admin/auth/": "flujo de autenticación: no hay sesión todavía",
  // Autoservicio del PROPIO usuario (verificación en dos pasos, obligatoria para todos los
  // roles): no toca datos del tenant ni de otros usuarios.
  "app/api/admin/cuenta/2fa/": "2FA del propio usuario, todos los roles",
  "app/admin/(protected)/seguridad/": "pantalla de 2FA del propio usuario, todos los roles",
}

function auditarCompras(rels: string[]): string[] {
  return rels
    .filter((rel) => !Object.keys(EXCEPCIONES).some((p) => rel.startsWith(p)))
    .filter((rel) => !GUARDS.some((g) => g.test(leer(rel))))
    .sort()
}

// ---------------------------------------------------------------------------------------------
// 2. Mapa carpeta -> sección
// ---------------------------------------------------------------------------------------------

type Entrada =
  | { secciones: SeccionClave[] }
  | { comun: true; motivo: string }
  | { fijo: RegExp; motivo: string }

const SUPERADMIN = /\brequireSuperadmin\w*\(|\.role\s*!==\s*"superadmin"/

// Claves = carpeta (o subcarpeta) relativa a la raíz de la app. Se resuelve por el prefijo más
// largo (`settings/schedule` antes que `settings`). Las claves de sección de las rutas API son el
// mapeo de trabajo del diseño (D6); S2b las confirma leyendo cada consumidor al migrarlas.
const MAPA: Record<string, Entrada> = {
  // --- API: Operación
  [`${API}inbox`]: { secciones: ["inbox"] },
  [`${API}inbox/limits`]: { fijo: SUPERADMIN, motivo: "topes del bot: superadmin (guard propio, sin cambio)" },
  [`${API}inbox/usage`]: { fijo: SUPERADMIN, motivo: "gasto del bot: superadmin (sin cambio)" },
  [`${API}inbox/wa-costos`]: { fijo: SUPERADMIN, motivo: "costos de WhatsApp: superadmin (sin cambio)" },
  [`${API}whatsapp-numbers`]: { secciones: ["inbox"] },
  [`${API}correo`]: {
    fijo: /\brequireCorreo(Admin|Lector)\(/,
    motivo: "correo vive en Mensajes: requireCorreoAdmin/Lector exigen la sección inbox por dentro",
  },
  [`${API}pedidos`]: { secciones: ["pedidos"] },
  [`${API}carritos`]: { secciones: ["pedidos"] },
  [`${API}avisos-reingreso`]: { secciones: ["pedidos"] },
  [`${API}pagos-intentos`]: { secciones: ["pedidos"] },
  [`${API}comprobantes`]: { secciones: ["comprobantes"] },
  // El único consumidor es ReceiptsEmailForm, dentro de Sucursales (mail de respaldo de avisos):
  // se admite también Comprobantes porque el dato es el destino de sus avisos.
  [`${API}settings/receipts`]: { secciones: ["sucursales", "comprobantes"] },
  [`${API}compras`]: { secciones: ["compras"] },
  // --- API: Datos
  [`${API}catalogo`]: { secciones: ["catalogo"] },
  // El listado de productos (sólo GET) lo usa también Etiquetas (SelectorProductos) (S2b-ii, 2b.0).
  [`${API}catalogo/productos/route.ts`]: { secciones: ["catalogo", "etiquetas"] },
  [`${API}catalog`]: { secciones: ["catalogo"] }, // sync/upload de Alegra: SincronizarAlegra, en Catálogo
  // Campañas y cupones: CampaniasPanel y CuponesPanel, sólo solapas de Catálogo (S2b-ii, 2b.0).
  [`${API}campanias`]: { secciones: ["catalogo"] },
  [`${API}cupones`]: { secciones: ["catalogo"] },
  // Paneles de Catálogo (PreciosOnline, Listas, Historial, Retenidos, Campañas) y MediosPagoShopCard
  // (Pagos y cuotas: previsualizar/aplicar las cuotas por lista) (S2b-ii, 2b.0).
  [`${API}precios-online`]: { secciones: ["catalogo", "cuotas"] },
  // MediosPagoShopCard (Pagos y cuotas) y CuponesPanel (Catálogo, sólo lectura del GET) (S2b-ii, 2b.0).
  [`${API}medios-pago-shop`]: { secciones: ["cuotas", "catalogo"] },
  [`${API}cuentas-bancarias-shop`]: { secciones: ["cuotas"] }, // CuentasBancariasShopCard (Pagos y cuotas)
  // VentaSinStockCard (Envíos) y CatalogoShell (Catálogo, GET) (S2b-ii, 2b.0).
  [`${API}modalidades-sin-stock`]: { secciones: ["catalogo", "envios"] },
  [`${API}clientes-tienda`]: { secciones: ["clientes-tienda"] },
  // Consumidores: VincularContacto y ClienteTiendaDetalle (sólo Clientes de la tienda); Pedidos no
  // las usa, así que no se admite (S2b-i, 2b.0).
  [`${API}contactos-alegra`]: { secciones: ["clientes-tienda"] },
  [`${API}sucursales`]: { secciones: ["sucursales"] },
  [`${API}sucursales/zonas`]: { secciones: ["sucursales", "envios"] },
  // Único consumidor del GET: SucursalesTab (S2b-i, 2b.0). Se migra en S2b-iii.
  [`${API}alegra-cuentas`]: { secciones: ["sucursales"] },
  [`${API}reglas-venta`]: { secciones: ["sucursales"] },
  [`${API}envios`]: { secciones: ["envios"] },
  [`${API}despacho`]: { secciones: ["envios"] },
  [`${API}metodos-envio`]: { secciones: ["envios"] },
  [`${API}settings/schedule`]: { secciones: ["horarios"] },
  [`${API}settings/chat-tienda`]: { secciones: ["chat-tienda"] },
  [`${API}settings/tienda-online`]: { secciones: ["tienda-online"] },
  [`${API}etiquetas`]: { secciones: ["etiquetas"] },
  // --- API: fijas y comunes
  [`${API}templates`]: { fijo: SUPERADMIN, motivo: "plantillas de Meta: superadmin (sin cambio)" },
  [`${API}whatsapp-onboarding`]: { fijo: SUPERADMIN, motivo: "alta de números: superadmin (sin cambio)" },
  [`${API}usuarios`]: { comun: true, motivo: "self-edit del nombre para todo rol; la gestión exige canManageUsers" },
  [`${API}me`]: { comun: true, motivo: "disponibilidad del propio usuario" },
  [`${API}departments`]: { comun: true, motivo: "lista de departamentos, sin datos de sección" },
  [`${API}push`]: { comun: true, motivo: "suscripción push del propio usuario" },
  [`${API}pending-counts`]: { comun: true, motivo: "cada contador sale sólo si el usuario ve su sección" },
  [`${API}auth`]: { comun: true, motivo: "flujo de autenticación" },
  [`${API}cuenta/2fa`]: { comun: true, motivo: "2FA del propio usuario" },
  // --- Páginas
  [`${PAGINAS}page.tsx`]: { comun: true, motivo: "landing: redirige a la primera sección visible" },
  [`${PAGINAS}inbox`]: { secciones: ["inbox"] },
  [`${PAGINAS}correo`]: { fijo: /\bisKnownAdminRole\b/, motivo: "redirects viejos hacia Mensajes" },
  [`${PAGINAS}configuracion`]: { secciones: ["horarios"] },
  [`${PAGINAS}pedidos`]: { secciones: ["pedidos"] },
  [`${PAGINAS}comprobantes`]: { secciones: ["comprobantes"] },
  [`${PAGINAS}compras`]: { secciones: ["compras"] },
  [`${PAGINAS}catalogo`]: { secciones: ["catalogo"] },
  [`${PAGINAS}clientes-tienda`]: { secciones: ["clientes-tienda"] },
  [`${PAGINAS}sucursales`]: { secciones: ["sucursales"] },
  [`${PAGINAS}envios`]: { secciones: ["envios"] },
  [`${PAGINAS}cuotas`]: { secciones: ["cuotas"] },
  [`${PAGINAS}horarios`]: { secciones: ["horarios"] },
  [`${PAGINAS}chat-tienda`]: { secciones: ["chat-tienda"] },
  [`${PAGINAS}tienda-online`]: { secciones: ["tienda-online"] },
  [`${PAGINAS}etiquetas`]: { secciones: ["etiquetas"] },
  [`${PAGINAS}plantillas`]: { secciones: ["plantillas"] },
  [`${PAGINAS}usuarios`]: { secciones: ["usuarios"] },
  [`${PAGINAS}uso`]: { secciones: ["uso"] },
  [`${PAGINAS}seguridad`]: { comun: true, motivo: "2FA del propio usuario, todos los roles" },
}

// Carpetas de sección que todavía usan los guards de rol viejos (comportamiento idéntico con las
// columnas NULL). Exentas de la regla 2; cada PR de S2b achica la lista y el último la vacía.
const CARPETAS_PENDIENTES: string[] = [
  // S2b-iii
  `${API}inbox`,
  `${API}whatsapp-numbers`,
  `${API}sucursales`,
  `${API}sucursales/zonas`,
  `${API}alegra-cuentas`,
  `${API}reglas-venta`,
  `${API}envios`,
  `${API}despacho`,
  `${API}metodos-envio`,
  `${PAGINAS}sucursales`,
  `${PAGINAS}envios`,
]

const GUARDS_DE_ROL_PELADOS = /\b(requireAdminPlus|requireOperatorPlus|requireSucursalesAccess|requireComprasAccess)\b/

function entradaDe(rel: string): { clave: string; entrada: Entrada } | null {
  const candidatas = Object.keys(MAPA).filter((k) => rel === k || rel.startsWith(`${k}/`))
  if (candidatas.length === 0) return null
  const clave = candidatas.sort((a, b) => b.length - a.length)[0]
  return { clave, entrada: MAPA[clave] }
}

/** Claves literales pasadas a requireSeccion(req, …) / accesoSeccion(…). */
function clavesUsadas(fuente: string): string[] {
  const re = /(?:requireSeccion\(\s*\w+\s*,|accesoSeccion\()\s*(\[[^\]]*\]|"[^"]+")/g
  return [...fuente.matchAll(re)].flatMap((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]))
}

function auditarSecciones(rels: string[]): string[] {
  const errores: string[] = []
  for (const rel of rels) {
    const r = entradaDe(rel)
    if (!r) {
      errores.push(`${rel}: carpeta sin entrada en el MAPA`)
      continue
    }
    const fuente = leer(rel)
    const { clave, entrada } = r
    if ("secciones" in entrada) {
      if (CARPETAS_PENDIENTES.includes(clave)) continue
      // accesoCompras es el wrapper de accesoSeccion("compras").
      const usaGuard = /\b(requireSeccion|accesoSeccion)\(/.test(fuente) || (entrada.secciones.includes("compras") && /\baccesoCompras\(/.test(fuente))
      if (!usaGuard) errores.push(`${rel}: falta requireSeccion/accesoSeccion (sección esperada: ${entrada.secciones.join(" | ")})`)
      if (GUARDS_DE_ROL_PELADOS.test(fuente)) errores.push(`${rel}: guard de rol pelado en una carpeta de sección`)
      for (const c of clavesUsadas(fuente)) {
        if (!entrada.secciones.includes(c as SeccionClave)) errores.push(`${rel}: clave "${c}" fuera de ${entrada.secciones.join(" | ")}`)
      }
    } else if ("fijo" in entrada) {
      if (!entrada.fijo.test(fuente)) errores.push(`${rel}: falta el guard fijo (${entrada.motivo})`)
    }
  }
  return errores.sort()
}

describe("rutas-guard: deny-by-default", () => {
  const rutas = archivos(join(SRC, "app/api/admin"), "route.ts").map((f) => relative(SRC, f))
  const paginas = archivos(join(SRC, "app/admin/(protected)"), "page.tsx").map((f) => relative(SRC, f))

  it("encuentra las rutas y páginas (el test no es vacuo)", () => {
    expect(rutas.length).toBeGreaterThan(100)
    expect(paginas.length).toBeGreaterThan(15)
    expect(Object.keys(EXCEPCIONES)).toEqual([
      "app/api/admin/auth/",
      "app/api/admin/cuenta/2fa/",
      "app/admin/(protected)/seguridad/",
    ])
  })

  describe("rol «compras»", () => {
    it("toda ruta /api/admin/** referencia un guard que deja afuera a «compras»", () => {
      expect(auditarCompras(rutas)).toEqual([])
    })

    it("toda página /admin/(protected)/** referencia un guard que deja afuera a «compras»", () => {
      expect(auditarCompras(paginas)).toEqual([])
    })
  })

  describe("mapa carpeta -> sección", () => {
    it("toda ruta resuelve a una entrada del mapa y cumple su guard", () => {
      expect(auditarSecciones(rutas)).toEqual([])
    })

    it("toda página resuelve a una entrada del mapa y cumple su guard", () => {
      expect(auditarSecciones(paginas)).toEqual([])
    })

    it("las páginas no leen la cookie de sesión (rol, tenant): usan la fila fresca", () => {
      const lectores = paginas.filter((rel) => /\bgetIronSession\b|\bsession\.(role|tenantId)\b/.test(leer(rel)))
      expect(lectores).toEqual([])
    })

    it("las claves del mapa existen y toda sección tildable queda protegida por alguna entrada", () => {
      const usadas = new Set<string>()
      for (const e of Object.values(MAPA)) {
        if ("secciones" in e) for (const s of e.secciones) {
          expect(esSeccionClave(s), s).toBe(true)
          usadas.add(s)
        }
        else expect(e.motivo.length).toBeGreaterThan(0)
      }
      for (const s of SECCIONES_TILDABLES) expect(usadas.has(s.clave), s.clave).toBe(true)
    })

    it("CARPETAS_PENDIENTES sólo lista carpetas de sección del mapa, sin repetir", () => {
      expect(new Set(CARPETAS_PENDIENTES).size).toBe(CARPETAS_PENDIENTES.length)
      for (const c of CARPETAS_PENDIENTES) {
        const e = MAPA[c]
        expect(e && "secciones" in e, c).toBe(true)
      }
    })

    it("una carpeta pendiente sigue teniendo guards viejos (si ya migró, hay que sacarla de la lista)", () => {
      const migradas = CARPETAS_PENDIENTES.filter((c) => {
        const propios = [...rutas, ...paginas].filter((rel) => entradaDe(rel)?.clave === c)
        return propios.length > 0 && propios.every((rel) => !GUARDS_DE_ROL_PELADOS.test(leer(rel)) && /\b(requireSeccion|accesoSeccion)\(/.test(leer(rel)))
      })
      expect(migradas).toEqual([])
    })
  })
})
