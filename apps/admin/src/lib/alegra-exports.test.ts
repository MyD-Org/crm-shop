import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"
import * as alegra from "./alegra"

// Guarda: NADIE recorre el padrón de contactos de Alegra fuera de la sync del espejo.
//
// `/contacts` admite ~5 requests por minuto por cuenta (400 con {"code":429} al pasarse) y el
// login del portal y el bot comparten ese cupo. Un recorrido completo son ~200 requests para
// Central LED: uno solo deja sin servicio al portal y al bot. Las lecturas de usuario van por
// lib/contactos.ts (espejo + a lo sumo unas pocas requests acotadas); el padrón lo recorre
// solo lib/alegra-contacts-sync.ts, de a una página, con `paginaDeContactos`.
//
// Si este test falla: no se arregla relajándolo. Leé del espejo (lib/contactos.ts).

const RAIZ = join(__dirname, "..", "..")

function fuentes(dir: string): string[] {
  const out: string[] = []
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre)
    if (statSync(ruta).isDirectory()) out.push(...fuentes(ruta))
    else if (/\.(ts|tsx)$/.test(nombre) && !/\.test\.tsx?$/.test(nombre)) out.push(ruta)
  }
  return out
}

const archivos = [...fuentes(join(RAIZ, "src")), ...fuentes(join(RAIZ, "scripts"))].map((ruta) => ({
  ruta: relative(RAIZ, ruta).split("\\").join("/"),
  codigo: readFileSync(ruta, "utf8"),
}))

describe("nadie recorre /contacts fuera de la sync", () => {
  it("alegra.ts ya no exporta los recorridos del padrón", () => {
    expect("listAllContacts" in alegra).toBe(false)
    expect("searchContactsByPhone" in alegra).toBe(false)
  })

  it("ningún archivo define o usa listAllContacts / searchContactsByPhone", () => {
    const usos = archivos.filter((a) => /\b(listAllContacts|searchContactsByPhone)\b/.test(a.codigo)).map((a) => a.ruta)
    expect(usos).toEqual([])
  })

  it("ningún paginado de alegra.ts (fetchAllPages / fetchWindow) apunta a /contacts", () => {
    const { codigo } = archivos.find((a) => a.ruta === "src/lib/alegra.ts")!
    expect(codigo).not.toMatch(/fetch(AllPages|Window)\s*(<[^>]*>)?\([^)]*["'`]\/contacts/)
  })

  it("paginaDeContactos (la única que pagina /contacts) solo la usa la sync", () => {
    const usos = archivos
      .filter((a) => a.ruta !== "src/lib/alegra.ts" && /\bpaginaDeContactos\b/.test(a.codigo))
      .map((a) => a.ruta)
    expect(usos).toEqual(["src/lib/alegra-contacts-sync.ts"])
  })

  it("en alegra.ts, el único `start` sobre /contacts es el de paginaDeContactos", () => {
    const { codigo } = archivos.find((a) => a.ruta === "src/lib/alegra.ts")!
    // Cada llamada a alegraFetch sobre "/contacts" (sin id) con un parámetro `start`.
    const llamadas = [...codigo.matchAll(/alegraFetch\(\s*config,\s*["'`]\/contacts["'`][\s\S]*?\)\)/g)].map((m) => m[0])
    const conStart = llamadas.filter((l) => /\bstart\b/.test(l))
    expect(conStart).toHaveLength(1)
    const inicio = codigo.indexOf(conStart[0])
    const funcion = codigo.lastIndexOf("export async function", inicio)
    expect(codigo.slice(funcion, funcion + 60)).toContain("paginaDeContactos")
  })
})
