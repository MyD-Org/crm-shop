import { describe, it, expect } from "vitest"
import { validarMetodoEnvio } from "./metodos-envio-validacion"

const cuadrado = (w: number, s: number, e: number, n: number) => [[[[w, s], [e, s], [e, n], [w, n], [w, s]]]]

const base = () => ({
  slug: "envio-en-el-dia",
  nombre: "Envío en el día",
  activo: true,
  provincia: "Buenos Aires",
  sucursalOrigen: "mdp",
  diasOperativos: [1, 2, 3, 4, 5],
  horaCorte: "09:00",
  margenMin: 0,
  promesa: "Entrega en el día",
  avisoFeriados: "",
  gratisAplica: false,
  itemAlegraId: "9001",
  itemAlegraIva: 21,
  zonas: [
    { nombre: "Centro", precio: 3000, orden: 1, activa: true, geometria: cuadrado(-57.6, -38.05, -57.5, -37.95), entradas: [] },
    { nombre: "Costa", precio: "4500,50", orden: 2, activa: true, geometria: cuadrado(-57.5, -38.05, -57.4, -37.95), entradas: [{ tipo: "cp", valor: "7600" }] },
  ],
  localidades: [{ georefId: "9990001", etiqueta: "Ciudad Ejemplo — Buenos Aires", abreviaturas: ["ce"] }],
})

function falla(cuerpo: unknown) {
  const r = validarMetodoEnvio(cuerpo)
  if (r.ok) throw new Error("se esperaba un rechazo")
  return r
}

describe("validarMetodoEnvio: caso feliz", () => {
  it("normaliza y devuelve el método sin avisos", () => {
    const r = validarMetodoEnvio(base())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.metodo).toMatchObject({
      slug: "envio-en-el-dia",
      provinciaClave: "buenosaires",
      horaCorte: "09:00",
      diasOperativos: [1, 2, 3, 4, 5],
      itemAlegraId: "9001",
    })
    expect(r.metodo.zonas[1].precio).toBe(4500.5)
    expect(r.metodo.zonas[1].entradas).toEqual([{ tipo: "cp", valor: "7600", etiqueta: "CP 7600" }])
    expect(r.metodo.localidades[0].abreviaturas).toEqual(["ce"])
    // Contiguas por el borde: no es un solape.
    expect(r.avisos).toEqual([])
  })
  it("conserva el id de una zona ya guardada y descarta uno inválido", () => {
    const b = base()
    b.zonas[0] = { ...b.zonas[0], id: "0b9f3a52-6f1c-4f5e-9d2a-1c2d3e4f5a6b" } as never
    b.zonas[1] = { ...b.zonas[1], id: "no-es-uuid" } as never
    const r = validarMetodoEnvio(b)
    expect(r.ok && r.metodo.zonas[0].id).toBe("0b9f3a52-6f1c-4f5e-9d2a-1c2d3e4f5a6b")
    expect(r.ok && r.metodo.zonas[1].id).toBeUndefined()
  })
  it("deriva el slug del nombre si falta", () => {
    const r = validarMetodoEnvio({ ...base(), slug: "" })
    expect(r.ok && r.metodo.slug).toBe("envio-en-el-dia")
  })
})

describe("validarMetodoEnvio: rechazos", () => {
  it.each([
    ["precio negativo", { precio: -5 }],
    ["precio cero", { precio: 0 }],
    ["precio no numérico", { precio: "abc" }],
    ["precio vacío", { precio: "" }],
  ])("zona con %s", (_n, cambio) => {
    const b = base()
    b.zonas[0] = { ...b.zonas[0], ...cambio } as never
    const r = falla(b)
    expect(r.campo).toBe("zonas.0.precio")
    expect(r.error).toMatch(/precio/i)
  })

  it("corte inválido", () => {
    expect(falla({ ...base(), horaCorte: "25:00" }).campo).toBe("horaCorte")
    expect(falla({ ...base(), horaCorte: "9:00" }).campo).toBe("horaCorte")
  })
  it("margen negativo, mayor a 240 o no entero", () => {
    expect(falla({ ...base(), margenMin: -1 }).campo).toBe("margenMin")
    expect(falla({ ...base(), margenMin: 241 }).campo).toBe("margenMin")
    expect(falla({ ...base(), margenMin: 1.5 }).campo).toBe("margenMin")
  })
  it("días fuera de lunes a sábado o vacíos (el domingo no se puede elegir)", () => {
    expect(falla({ ...base(), diasOperativos: [1, 7] }).campo).toBe("diasOperativos")
    expect(falla({ ...base(), diasOperativos: [1, 7] }).error).toBe("Seleccione al menos un día de lunes a sábado.")
    expect(falla({ ...base(), diasOperativos: [0] }).campo).toBe("diasOperativos")
    expect(falla({ ...base(), diasOperativos: [] }).campo).toBe("diasOperativos")
  })
  it("zona sin dibujo ni entradas", () => {
    const b = base()
    b.zonas[0] = { ...b.zonas[0], geometria: [] }
    const r = falla(b)
    expect(r.campo).toBe("zonas.0")
    expect(r.error).toMatch(/Centro/)
  })
  it("zona con sólo entradas de respaldo es válida", () => {
    const b = base()
    b.zonas[0] = { ...b.zonas[0], geometria: [], entradas: [{ tipo: "georef", valor: "9990001" }] } as never
    expect(validarMetodoEnvio(b).ok).toBe(true)
  })
  it("geometría inválida se rechaza con el motivo", () => {
    const b = base()
    b.zonas[0] = { ...b.zonas[0], geometria: [[[[-57.6, -38.05], [-57.5, -38.05], [-57.5, -37.95]]]] }
    const r = falla(b)
    expect(r.campo).toBe("zonas.0.geometria")
    expect(r.error).toMatch(/Centro/)
  })
  it("CP repetido entre zonas nombra la zona donde ya está", () => {
    const b = base()
    b.zonas[0] = { ...b.zonas[0], entradas: [{ tipo: "cp", valor: "7600" }] } as never
    const r = falla(b)
    expect(r.campo).toBe("zonas.1.entradas")
    expect(r.error).toMatch(/Centro/)
  })
  it("CP repetido normalizando espacios y mayúsculas", () => {
    const b = base()
    b.zonas[0] = { ...b.zonas[0], entradas: [{ tipo: "cp", valor: " 7600 " }] } as never
    expect(falla(b).campo).toBe("zonas.1.entradas")
  })
  it("localidad de Georef repetida entre zonas", () => {
    const b = base()
    b.zonas[0] = { ...b.zonas[0], entradas: [{ tipo: "georef", valor: "9990001", etiqueta: "Ciudad Ejemplo" }] } as never
    b.zonas[1] = { ...b.zonas[1], entradas: [{ tipo: "georef", valor: "9990001", etiqueta: "Ciudad Ejemplo" }] } as never
    expect(falla(b).campo).toBe("zonas.1.entradas")
  })
  it("entrada con formato inválido", () => {
    const b = base()
    const zona = b.zonas[1]
    b.zonas[1] = { ...zona, entradas: [{ tipo: "cp", valor: "76" }] } as never
    expect(falla(b).campo).toBe("zonas.1.entradas")
    b.zonas[1] = { ...zona, entradas: [{ tipo: "nombre", valor: "Barrio" }] } as never
    expect(falla(b).campo).toBe("zonas.1.entradas")
  })
  it("nombres de zona repetidos", () => {
    const b = base()
    b.zonas[1] = { ...b.zonas[1], nombre: " centro " }
    expect(falla(b).campo).toBe("zonas.1.nombre")
  })
  it("activar sin ítem de Alegra o sin zonas", () => {
    expect(falla({ ...base(), itemAlegraId: "" }).campo).toBe("itemAlegraId")
    expect(falla({ ...base(), zonas: [] }).campo).toBe("zonas")
  })
  it("inactivo puede guardarse sin ítem de Alegra", () => {
    expect(validarMetodoEnvio({ ...base(), activo: false, itemAlegraId: null }).ok).toBe(true)
  })
  it("provincia desconocida, nombre vacío, slug inválido, alícuota fuera de rango", () => {
    expect(falla({ ...base(), provincia: "Narnia" }).campo).toBe("provincia")
    expect(falla({ ...base(), nombre: "  " }).campo).toBe("nombre")
    expect(falla({ ...base(), slug: "Mal Slug!" }).campo).toBe("slug")
    expect(falla({ ...base(), itemAlegraIva: 150 }).campo).toBe("itemAlegraIva")
  })
  it("cuerpo que no es un objeto", () => {
    expect(falla(null).campo).toBe("body")
  })
  it("localidad atendida con id inválido", () => {
    expect(falla({ ...base(), localidades: [{ georefId: "x", etiqueta: "A" }] }).campo).toBe("localidades.0.georefId")
  })
  it("los mensajes están en usted, nunca en voseo ni tuteo", () => {
    const mensajes = [
      falla({ ...base(), horaCorte: "25:00" }).error,
      falla({ ...base(), margenMin: -1 }).error,
      falla({ ...base(), itemAlegraId: "" }).error,
      falla({ ...base(), diasOperativos: [] }).error,
    ]
    for (const m of mensajes) expect(m).not.toMatch(/\b(tu|tus|vos|ingresá|elegí|poné)\b/i)
  })
})

describe("validarMetodoEnvio: avisos", () => {
  it("polígonos de zonas distintas que se pisan avisan y no rechazan", () => {
    const b = base()
    b.zonas[1] = { ...b.zonas[1], geometria: cuadrado(-57.55, -38.05, -57.45, -37.95) }
    const r = validarMetodoEnvio(b)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.avisos).toHaveLength(1)
    expect(r.avisos[0]).toMatch(/Centro/)
    expect(r.avisos[0]).toMatch(/Costa/)
  })
  it("una zona contenida en otra también avisa", () => {
    const b = base()
    b.zonas[1] = { ...b.zonas[1], geometria: cuadrado(-57.58, -38.0, -57.52, -37.98) }
    const r = validarMetodoEnvio(b)
    expect(r.ok && r.avisos).toHaveLength(1)
  })
})
