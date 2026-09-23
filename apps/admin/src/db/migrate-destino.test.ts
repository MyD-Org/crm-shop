import { describe, expect, it } from "vitest"
import { destinoMigracion } from "./migrate-destino"

describe("destinoMigracion", () => {
  it("local: localhost y 127.0.0.1", () => {
    expect(destinoMigracion("postgres://localhost:5432/crm")).toEqual({ host: "localhost", base: "crm", local: true })
    expect(destinoMigracion("postgres://u:p@127.0.0.1/crm_test").local).toBe(true)
  })

  it("remota: cualquier otro host, sin exponer la contraseña", () => {
    const d = destinoMigracion("postgres://owner:s3cr3t-placeholder@db.plataforma.example/neondb?sslmode=require")
    expect(d).toEqual({ host: "db.plataforma.example", base: "neondb", local: false })
    expect(JSON.stringify(d)).not.toContain("s3cr3t-placeholder")
  })
})
