import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

// Test a nivel FUENTE (patrón de nav-grupos.test.ts): deny-by-default para roles nuevos.
//
// `roleRank` manda todo rol desconocido (y "compras") a 0, el mismo rango que operator. Una ruta
// o página que no compare contra una allow-list o contra un rango mínimo queda ABIERTA para el
// rol "compras". Este test recorre TODAS las rutas API y páginas del admin y exige que cada
// archivo referencie un guard que sí lo deja afuera, o que figure en la lista de excepciones.
const SRC = fileURLToPath(new URL("..", import.meta.url))

function archivos(dir: string, nombre: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir)) {
    const ruta = join(dir, e)
    if (statSync(ruta).isDirectory()) out.push(...archivos(ruta, nombre))
    else if (e === nombre) out.push(ruta)
  }
  return out
}

// Guards que dejan afuera al rol "compras" (rank >= 1, o allow-list de los tres roles conocidos).
// `requireComprasAccess` es la única puerta que lo admite, y sólo para el módulo Compras.
const GUARDS = [
  /\brequireAdminPlus\b/,
  /\brequireOperatorPlus\b/,
  /\brequireSucursalesAccess\b/,
  /\brequireComprasAccess\b/,
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

function auditar(archivosFuente: string[]): string[] {
  return archivosFuente
    .map((f) => relative(SRC, f))
    .filter((rel) => !Object.keys(EXCEPCIONES).some((p) => rel.startsWith(p)))
    .filter((rel) => {
      const fuente = readFileSync(join(SRC, rel), "utf8")
      return !GUARDS.some((g) => g.test(fuente))
    })
    .sort()
}

describe("rutas-guard: deny-by-default para el rol «compras»", () => {
  const rutas = archivos(join(SRC, "app/api/admin"), "route.ts")
  const paginas = archivos(join(SRC, "app/admin/(protected)"), "page.tsx")

  it("encuentra las rutas y páginas (el test no es vacuo)", () => {
    expect(rutas.length).toBeGreaterThan(100)
    expect(paginas.length).toBeGreaterThan(15)
  })

  it("toda ruta /api/admin/** referencia un guard que deja afuera a «compras»", () => {
    expect(auditar(rutas)).toEqual([])
  })

  it("toda página /admin/(protected)/** referencia un guard que deja afuera a «compras»", () => {
    expect(auditar(paginas)).toEqual([])
  })
})
