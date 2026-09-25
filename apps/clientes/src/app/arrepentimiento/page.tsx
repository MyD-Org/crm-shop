import type { Metadata } from "next";
import { connection } from "next/server";
import { PaginaLegal } from "@/components/legales/PaginaLegal";
import { getDatosLegales } from "@/lib/home-datos";
import { bloquesArrepentimiento } from "@/lib/legales/arrepentimiento";
import { FormArrepentimiento } from "./FormArrepentimiento";

export const metadata: Metadata = { title: "Botón de arrepentimiento" };

/**
 * Botón de arrepentimiento (Res. 424/2020). Pública, sin sesión: el proxy no
 * protege la ruta (solo el gate "Próximamente" mientras esté activo).
 */
/** Epoch ms del pedido: el form lo devuelve y la acción mide el tiempo de llenado. */
function marcaDeTiempo(): number {
  return Date.now();
}

export default async function ArrepentimientoPage() {
  // Por pedido, nunca del build: una marca prerenderizada envejece y la acción
  // rechazaría todos los envíos (más de 24 h).
  await connection();
  const iniciado = marcaDeTiempo();
  const datos = await getDatosLegales();
  return (
    <PaginaLegal
      titulo="Botón de arrepentimiento"
      bloques={bloquesArrepentimiento(datos)}
      datos={datos}
    >
      <section className="flex flex-col gap-4">
        <h2 className="font-display text-xl font-medium tracking-tight text-text">Solicitar la revocación</h2>
        <FormArrepentimiento iniciado={iniciado} />
      </section>
    </PaginaLegal>
  );
}
