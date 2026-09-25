import { describe, expect, it } from "vitest";
import { REGISTRO, infracciones } from "@/test/registro-usted";
import { armarMailArrepentimientoCliente, armarMailArrepentimientoComercio } from "./arrepentimiento-mail";

const cliente = armarMailArrepentimientoCliente({
  codigo: "ARR-000042",
  nombre: "Ana Pérez",
  pedido: "PED-00001000",
  motivo: "No era lo que esperaba",
  comercio: "Tienda Ejemplo",
  logoUrl: null,
});

const comercio = armarMailArrepentimientoComercio({
  codigo: "ARR-000042",
  nombre: "Ana Pérez",
  email: "ana@cliente.example",
  telefono: "3757 400000",
  pedido: "PED-00001000",
  motivo: "No era lo que esperaba",
  fecha: new Date("2026-09-25T15:30:00Z"),
});

describe("mail al cliente", () => {
  it("asunto con el código; el código, los datos y los próximos pasos en html y texto", () => {
    expect(cliente.subject).toBe("Recibimos su solicitud de arrepentimiento ARR-000042");
    for (const parte of [cliente.html, cliente.text]) {
      expect(parte).toContain("ARR-000042");
      expect(parte).toContain("PED-00001000");
      expect(parte).toContain("No era lo que esperaba");
      expect(parte).toContain("se comunicará con usted");
    }
    expect(cliente.html).toContain("Tienda Ejemplo");
  });

  it("sin pedido ni motivo no muestra etiquetas vacías", () => {
    const m = armarMailArrepentimientoCliente({ codigo: "ARR-000001", nombre: "Ana" });
    expect(m.text).not.toContain("Pedido:");
    expect(m.text).not.toContain("Motivo:");
    expect(m.html).not.toContain("Pedido");
  });
});

describe("aviso al comercio", () => {
  it("asunto con el código y todos los datos de contacto", () => {
    expect(comercio.subject).toBe("Nueva solicitud de arrepentimiento ARR-000042");
    for (const parte of [comercio.html, comercio.text]) {
      for (const dato of ["ARR-000042", "Ana Pérez", "ana@cliente.example", "3757 400000", "PED-00001000", "No era lo que esperaba"]) {
        expect(parte).toContain(dato);
      }
    }
    // Hora argentina, no la del servidor (UTC).
    expect(comercio.text).toContain("25/09/2026");
    expect(comercio.text).toContain("12:30");
  });
});

describe("ambos mails", () => {
  it("escapan el HTML que tipea la persona", () => {
    const motivo = '<script>alert("x")</script>';
    const c = armarMailArrepentimientoCliente({ codigo: "ARR-000001", nombre: "<b>Ana</b>", motivo });
    const k = armarMailArrepentimientoComercio({
      codigo: "ARR-000001",
      nombre: "<b>Ana</b>",
      email: "ana@cliente.example",
      telefono: "1",
      motivo,
      fecha: new Date(),
    });
    for (const html of [c.html, k.html]) {
      expect(html).not.toContain("<script>");
      expect(html).not.toContain("<b>Ana</b>");
      expect(html).toContain("&lt;script&gt;");
    }
  });

  it("en usted: sin voseo ni tuteo", () => {
    for (const parte of [cliente.subject, cliente.html, cliente.text, comercio.subject, comercio.html, comercio.text]) {
      expect(infracciones(parte, REGISTRO)).toEqual([]);
    }
  });
});
