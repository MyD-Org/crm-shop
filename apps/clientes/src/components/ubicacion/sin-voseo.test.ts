import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { REGISTRO, infracciones } from "@/test/registro-usted";
import { TEXTOS_UBICACION } from "@/lib/ubicacion";

/**
 * Registro formal de usted (CLAUDE.md raíz) para el selector "Enviar a": los componentes de
 * `src/components/ubicacion/**` y los textos centralizados `TEXTOS_UBICACION`.
 */
const SRC = fileURLToPath(new URL("../..", import.meta.url));
const CARPETA = join(SRC, "components", "ubicacion");

describe("selector Enviar a: registro de usted", () => {
  it("sin voseo/tuteo ni coloquialismos en los componentes", () => {
    const encontrados = readdirSync(CARPETA)
      .filter((n) => n.endsWith(".tsx"))
      .flatMap((n) => infracciones(readFileSync(join(CARPETA, n), "utf8"), REGISTRO).map((m) => `${n}:${m}`));
    expect(encontrados, encontrados.join("\n")).toEqual([]);
  });

  it("sin voseo/tuteo en TEXTOS_UBICACION", () => {
    const malos = Object.entries(TEXTOS_UBICACION).filter(([, v]) =>
      REGISTRO.test(typeof v === "function" ? v("Local Ejemplo") : v),
    );
    expect(malos).toEqual([]);
  });

  it("textos aprobados del header y del modal", () => {
    expect(TEXTOS_UBICACION.tituloModal).toBe("Seleccione dónde recibir su compra");
    expect(TEXTOS_UBICACION.indiqueUbicacion).toBe("Indique su ubicación");
    expect(TEXTOS_UBICACION.agregarDireccion).toBe("Agregar nueva dirección");
    expect(TEXTOS_UBICACION.retirarEnElLocal).toBe("Retirar en el local");
  });
});

describe("disparadores existentes abren el modal nuevo", () => {
  it("la ficha y el carrito siguen usando SelectorUbicacion (mismo import y props)", () => {
    for (const archivo of ["EnvioProductoUbicacion.tsx", "EntregaProducto.tsx"]) {
      const f = readFileSync(join(SRC, "components", "producto", archivo), "utf8");
      expect(f).toContain('import { SelectorUbicacion } from "@/components/ubicacion/SelectorUbicacion";');
      expect(f).toMatch(/<SelectorUbicacion className=/);
    }
  });
});
