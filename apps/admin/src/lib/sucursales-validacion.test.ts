import { describe, it, expect } from "vitest"
import { validarSlug, validarSucursalCambios, validarSucursalNueva, validarZona } from "@/lib/sucursales-validacion"
import { claveProvincia, provinciaCanonica, PROVINCIAS } from "@/lib/provincias"

// Datos inventados. Los mensajes van en usted (regla de UI del producto).

describe("provincias", () => {
  it("son 24 jurisdicciones con clave única", () => {
    expect(PROVINCIAS).toHaveLength(24)
    expect(new Set(PROVINCIAS.map(claveProvincia)).size).toBe(24)
  })

  it("normaliza variantes de escritura a la clave y al nombre canónico", () => {
    for (const v of ["misiones", " Misiones ", "MISIONES", "Misiónes"]) {
      expect(provinciaCanonica(v), v).toEqual({ clave: "misiones", nombre: "Misiones" })
    }
    expect(provinciaCanonica("Río Negro")?.clave).toBe("rionegro")
    expect(provinciaCanonica("rio negro")?.nombre).toBe("Río Negro")
  })

  it("una provincia desconocida o vacía no resuelve", () => {
    expect(provinciaCanonica("Atlantida")).toBeNull()
    expect(provinciaCanonica("  ")).toBeNull()
    expect(provinciaCanonica(null)).toBeNull()
  })
})

describe("validarSlug", () => {
  it("acepta minúsculas, números y guiones de 2 a 20 caracteres", () => {
    for (const s of ["aa", "sur-2", "a".repeat(20)]) expect(validarSlug(s), s).toEqual({ ok: true, slug: s })
  })

  it("rechaza formato inválido y el slug reservado 'zonas'", () => {
    for (const s of ["A1", "x", "con espacio", "a".repeat(21), "ñandú", "zonas", "", 5]) {
      const r = validarSlug(s)
      expect(r.ok, String(s)).toBe(false)
    }
  })
})

describe("validarSucursalNueva", () => {
  it("un alta mínima toma los valores por defecto", () => {
    const r = validarSucursalNueva({ slug: "aaa", nombre: " Sucursal Aaa " })
    expect(r).toEqual({
      ok: true,
      valor: {
        slug: "aaa",
        nombre: "Sucursal Aaa",
        direccion: "",
        ciudad: "",
        provincia: "",
        whatsapp: "",
        aceptaRetiro: true,
        aceptaEnvio: true,
        envioCiudades: [],
        orden: 0,
        activa: true,
        predeterminada: false,
        maestra: false,
      },
    })
  })

  it("exige nombre, en usted", () => {
    expect(validarSucursalNueva({ slug: "aaa", nombre: "  " })).toEqual({
      ok: false,
      campo: "nombre",
      error: "Ingrese el nombre de la sucursal.",
    })
  })

  it("normaliza la provincia y rechaza una que no es de la lista", () => {
    const ok = validarSucursalNueva({ slug: "aaa", nombre: "A", provincia: "misiones" })
    expect(ok.ok && ok.valor.provincia).toBe("Misiones")
    const mal = validarSucursalNueva({ slug: "aaa", nombre: "A", provincia: "Narnia" })
    expect(mal).toEqual({ ok: false, campo: "provincia", error: "Seleccione una provincia de la lista." })
  })

  it("valida WhatsApp, ciudades de envío y orden", () => {
    expect(validarSucursalNueva({ slug: "aaa", nombre: "A", whatsapp: "no es un numero" }).ok).toBe(false)
    expect(validarSucursalNueva({ slug: "aaa", nombre: "A", whatsapp: "+54 9 000 000-0000" }).ok).toBe(true)
    const c = validarSucursalNueva({ slug: "aaa", nombre: "A", envioCiudades: [" Ciudad Uno ", "ciudad uno", "", "Ciudad Dos"] })
    expect(c.ok && c.valor.envioCiudades).toEqual(["Ciudad Uno", "Ciudad Dos"])
    expect(validarSucursalNueva({ slug: "aaa", nombre: "A", envioCiudades: "x" }).ok).toBe(false)
    expect(validarSucursalNueva({ slug: "aaa", nombre: "A", orden: -1 })).toEqual({
      ok: false,
      campo: "orden",
      error: "Ingrese un número entero igual o mayor que cero.",
    })
    expect(validarSucursalNueva({ slug: "aaa", nombre: "A", orden: 1.5 }).ok).toBe(false)
  })

  it("ignora un `horario` viejo en el body (el texto libre ya no se edita)", () => {
    const largo = "x".repeat(600)
    const alta = validarSucursalNueva({ slug: "aaa", nombre: "A", horario: largo })
    expect(alta.ok).toBe(true)
    expect(alta.ok && "horario" in alta.valor).toBe(false)
    expect(validarSucursalCambios({ horario: "Lun a Vie" })).toEqual({
      ok: false,
      campo: "body",
      error: "No hay cambios para guardar.",
    })
    const c = validarSucursalCambios({ nombre: "B", horario: "Lun a Vie" })
    expect(c).toEqual({ ok: true, cambios: { nombre: "B" } })
  })

  it("rechaza tipos incorrectos y un cuerpo que no es objeto", () => {
    expect(validarSucursalNueva({ slug: "aaa", nombre: "A", aceptaRetiro: "si" }).ok).toBe(false)
    expect(validarSucursalNueva(null).ok).toBe(false)
    expect(validarSucursalNueva([]).ok).toBe(false)
  })
})

describe("validarSucursalCambios", () => {
  it("el slug no se puede modificar", () => {
    expect(validarSucursalCambios({ slug: "otro" })).toEqual({
      ok: false,
      campo: "slug",
      error: "El identificador de una sucursal no se puede modificar.",
    })
  })

  it("acepta cambios parciales y rechaza un cuerpo sin cambios", () => {
    expect(validarSucursalCambios({ activa: false })).toEqual({ ok: true, cambios: { activa: false } })
    expect(validarSucursalCambios({}).ok).toBe(false)
  })

  it("un nombre vacío en un cambio se rechaza", () => {
    expect(validarSucursalCambios({ nombre: "" }).ok).toBe(false)
  })
})

describe("validarZona", () => {
  it("sin sucursal: 'Seleccione una sucursal.'", () => {
    expect(validarZona({ provincia: "Misiones" })).toEqual({ ok: false, campo: "sucursal", error: "Seleccione una sucursal." })
    expect(validarZona({ provincia: "Misiones", sucursal: "  " })).toEqual({
      ok: false,
      campo: "sucursal",
      error: "Seleccione una sucursal.",
    })
  })

  it("provincia con variantes de escritura coincide y se guarda canónica", () => {
    const r = validarZona({ provincia: " misiones ", sucursal: "aaa" })
    expect(r).toEqual({
      ok: true,
      valor: { provinciaClave: "misiones", provincia: "Misiones", sucursal: "aaa", facturaSucursal: null },
    })
  })

  it("provincia desconocida", () => {
    expect(validarZona({ provincia: "Narnia", sucursal: "aaa" })).toEqual({
      ok: false,
      campo: "provincia",
      error: "Seleccione una provincia de la lista.",
    })
  })

  it("factura_sucursal es opcional", () => {
    const r = validarZona({ provincia: "Chaco", sucursal: "aaa", facturaSucursal: "bbb" })
    expect(r.ok && r.valor.facturaSucursal).toBe("bbb")
    const vacio = validarZona({ provincia: "Chaco", sucursal: "aaa", facturaSucursal: "" })
    expect(vacio.ok && vacio.valor.facturaSucursal).toBeNull()
  })
})
