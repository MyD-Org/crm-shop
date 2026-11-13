import { describe, it, expect } from "vitest"
import { dtoAForm, formACuerpo, formVacio, resumenMetodo, zonaVacia } from "./metodos-envio-form"
import { validarMetodoEnvio } from "./metodos-envio-validacion"
import type { MetodoEnvioDto } from "./metodos-envio-repo"
import type { Geometria } from "./geo-poligono"

const cuadrado = [[[[-57.6, -38.05], [-57.5, -38.05], [-57.5, -37.95], [-57.6, -37.95], [-57.6, -38.05]]]] as Geometria

const dto: MetodoEnvioDto = {
  id: "0b9f3a52-6f1c-4f5e-9d2a-1c2d3e4f5a6b",
  slug: "envio-en-el-dia",
  nombre: "Envío en el día",
  activo: true,
  orden: 0,
  provincia: "Buenos Aires",
  provinciaClave: "buenosaires",
  sucursalOrigen: "mdp",
  diasOperativos: [1, 2, 3, 4, 5],
  horaCorte: "09:00",
  margenMin: 15,
  promesa: "Entrega en el día",
  avisoFeriados: "Los feriados pueden modificar la fecha.",
  gratisAplica: false,
  itemAlegraId: "9001",
  itemAlegraIva: 21,
  zonas: [
    { id: "11111111-1111-4111-8111-111111111111", nombre: "Centro", precio: 3000, orden: 1, activa: true, geometria: cuadrado, entradas: [{ tipo: "cp", valor: "7600", etiqueta: "CP 7600" }] },
    { id: "22222222-2222-4222-8222-222222222222", nombre: "Costa", precio: 4500.5, orden: 2, activa: false, geometria: [], entradas: [{ tipo: "georef", valor: "9990001", etiqueta: "Ciudad Ejemplo — Buenos Aires" }] },
  ],
  localidades: [{ georefId: "9990001", etiqueta: "Ciudad Ejemplo — Buenos Aires", abreviaturas: ["ce", "cej"], centro: null, bbox: null }],
}

describe("formulario del método de envío", () => {
  it("un método guardado vuelve al servidor igual que salió (ida y vuelta)", () => {
    const cuerpo = formACuerpo(dtoAForm(dto))
    const r = validarMetodoEnvio(cuerpo)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.metodo).toMatchObject({
      slug: "envio-en-el-dia",
      provincia: "Buenos Aires",
      sucursalOrigen: "mdp",
      horaCorte: "09:00",
      margenMin: 15,
      itemAlegraId: "9001",
    })
    expect(r.metodo.zonas.map((z) => [z.id, z.nombre, z.precio, z.activa])).toEqual([
      ["11111111-1111-4111-8111-111111111111", "Centro", 3000, true],
      ["22222222-2222-4222-8222-222222222222", "Costa", 4500.5, false],
    ])
    expect(r.metodo.localidades[0].abreviaturas).toEqual(["ce", "cej"])
  })

  it("el formulario en blanco es un método nuevo, inactivo, de lunes a viernes con corte 09:00", () => {
    const f = formVacio()
    expect(f).toMatchObject({ activo: false, dias: [1, 2, 3, 4, 5], horaCorte: "09:00", provincia: "Buenos Aires", sucursalOrigen: "", gratisAplica: false })
    expect(f.id).toBeUndefined()
    expect(formACuerpo(f).sucursalOrigen).toBeNull()
  })

  it("una zona nueva arranca sin dibujo y con un nombre que sugiere el orden", () => {
    const a = zonaVacia([])
    const b = zonaVacia([a])
    expect(a.nombre).toBe("Zona 1")
    expect(b.nombre).toBe("Zona 2")
    expect(a.clave).not.toBe(b.clave)
    expect(b.geometria).toEqual([])
  })

  it("las abreviaturas se cargan separadas por coma", () => {
    const f = dtoAForm(dto)
    expect(f.localidades[0].abreviaturas).toBe("ce, cej")
    expect(formACuerpo(f).localidades[0].abreviaturas).toEqual(["ce", "cej"])
  })

  it("un margen no numérico llega como null para que el servidor lo rechace en usted", () => {
    const f = dtoAForm(dto)
    f.margenMin = "abc"
    const r = validarMetodoEnvio(formACuerpo(f))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.campo).toBe("margenMin")
  })
})

describe("resumenMetodo", () => {
  it("lo cuenta en lenguaje simple", () => {
    const lineas = resumenMetodo(dto)
    expect(lineas.join(" ")).toMatch(/Centro/)
    expect(lineas.join(" ")).toMatch(/\$3\.000/)
    expect(lineas.join(" ")).toMatch(/lunes a viernes/i)
    expect(lineas.join(" ")).toMatch(/09:00/)
  })
  it("marca las zonas inactivas y las que no tienen dibujo", () => {
    expect(resumenMetodo(dto).join(" ")).toMatch(/Costa.*sin dibujo|sin dibujo.*Costa/i)
  })
})
