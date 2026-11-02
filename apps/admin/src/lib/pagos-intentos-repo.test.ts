import { describe, expect, it } from "vitest"
import { CLASE_INTENTO_SQL_TEXTO, foldResumen } from "./pagos-intentos-repo"

describe("foldResumen", () => {
  it("3 aprobados y 1 error del proveedor en MP/igz => tasa de fallo 25 %, causas separadas", () => {
    const [fila, ...resto] = foldResumen([
      { proveedor: "mercadopago", cuenta: "igz", clase: "aprobado", n: 3 },
      { proveedor: "mercadopago", cuenta: "igz", clase: "error_proveedor", n: 1 },
    ])
    expect(resto).toEqual([])
    expect(fila).toMatchObject({
      proveedor: "mercadopago",
      cuenta: "igz",
      total: 4,
      aprobados: 3,
      errorProveedor: 1,
      rechazoBanco: 0,
      credenciales: 0,
      reservaAbandonada: 0,
      pendientes: 0,
      tasaFallo: 0.25,
    })
  })

  it("los pendientes (en curso) no entran en el denominador de la tasa", () => {
    const [fila] = foldResumen([
      { proveedor: "payway", cuenta: "mdp", clase: "aprobado", n: 1 },
      { proveedor: "payway", cuenta: "mdp", clase: "rechazo_banco", n: 1 },
      { proveedor: "payway", cuenta: "mdp", clase: "pendiente", n: 10 },
    ])
    expect(fila.pendientes).toBe(10)
    expect(fila.total).toBe(12)
    expect(fila.tasaFallo).toBe(0.5)
  })

  it("denominador 0 (solo pendientes) => tasaFallo null, nunca NaN", () => {
    const [fila] = foldResumen([{ proveedor: "mercadopago", cuenta: "sin_cuenta", clase: "pendiente", n: 2 }])
    expect(fila.tasaFallo).toBeNull()
  })

  it("separa por proveedor y por cuenta, y suma cada causa por su lado", () => {
    const filas = foldResumen([
      { proveedor: "mercadopago", cuenta: "igz", clase: "credenciales", n: 2 },
      { proveedor: "mercadopago", cuenta: "mdp", clase: "reserva_abandonada", n: 1 },
      { proveedor: "payway", cuenta: "igz", clase: "aprobado", n: 5 },
    ])
    expect(filas).toHaveLength(3)
    expect(filas.find((f) => f.proveedor === "mercadopago" && f.cuenta === "igz")).toMatchObject({
      credenciales: 2,
      tasaFallo: 1,
    })
    expect(filas.find((f) => f.cuenta === "mdp")).toMatchObject({ reservaAbandonada: 1 })
    expect(filas.find((f) => f.proveedor === "payway")).toMatchObject({ aprobados: 5, tasaFallo: 0 })
  })

  it("sin filas => lista vacía", () => {
    expect(foldResumen([])).toEqual([])
  })
})

describe("CLASE_INTENTO_SQL", () => {
  it("define la precedencia en un solo CASE: pagado, credenciales, error del proveedor, reserva, rechazo", () => {
    const t = CLASE_INTENTO_SQL_TEXTO
    const orden = ["THEN 'aprobado'", "THEN 'credenciales'", "THEN 'error_proveedor'", "THEN 'reserva_abandonada'", "THEN 'rechazo_banco'", "ELSE 'pendiente'"]
    const pos = orden.map((c) => t.indexOf(c))
    expect(pos.every((p) => p >= 0)).toBe(true)
    expect(pos).toEqual([...pos].sort((a, b) => a - b))
  })
})
