/**
 * Términos y condiciones de compra. Borrador sujeto a revisión legal.
 * Garantía y revocación: SOLO el mínimo legal (art. 11 y 34 Ley 24.240,
 * arts. 1110–1116 CCyC). Ningún plazo ni beneficio extra.
 */
import type { DatosLegales } from "@/data/home-defaults";
import { ENLACE_DEFENSA_CONSUMIDOR, comoContactar, identificacionComercio, type Bloque } from "./comun";

export function bloquesTerminos(d: DatosLegales, ctx: { cuotas: boolean }): Bloque[] {
  const identificacion = identificacionComercio(d);
  const bloques: Bloque[] = [];

  if (identificacion.length > 0) {
    bloques.push({ titulo: "Identificación del comercio", parrafos: identificacion });
  }

  bloques.push(
    {
      titulo: "Alcance",
      parrafos: [
        "Estos términos y condiciones rigen las compras realizadas en esta tienda en línea. Al confirmar un pedido, usted declara conocerlos y aceptarlos.",
      ],
    },
    {
      titulo: "Precios y disponibilidad",
      parrafos: [
        "Los precios se expresan en pesos argentinos.",
        "La disponibilidad de los productos está sujeta a stock al momento de confirmar el pedido. Si un producto no estuviera disponible, el comercio se comunicará con usted.",
      ],
    },
    {
      titulo: "Medios de pago",
      parrafos: [
        "Los medios de pago disponibles se informan durante la compra y en la página Envíos y pagos.",
        ...(ctx.cuotas
          ? ["Cuando se ofrezca el pago en cuotas, el costo financiero total (CFT) se informa antes de confirmar la compra."]
          : []),
      ],
    },
    {
      titulo: "Garantía legal",
      parrafos: [
        "Los productos nuevos cuentan con la garantía legal de 6 meses desde su entrega por defectos o vicios, conforme al art. 11 de la Ley 24.240 de Defensa del Consumidor.",
      ],
    },
    {
      titulo: "Derecho de revocación (arrepentimiento)",
      parrafos: [
        "Si usted compra como consumidor final, puede revocar la aceptación de la compra dentro de los 10 días corridos contados desde la entrega del producto o desde la celebración del contrato, lo que ocurra último, sin necesidad de indicar el motivo (art. 34 de la Ley 24.240 y arts. 1110 a 1116 del Código Civil y Comercial de la Nación).",
        "El ejercicio de este derecho no tiene costo para usted: los gastos de devolución son a cargo del comercio (art. 34 de la Ley 24.240 y art. 1115 del Código Civil y Comercial de la Nación).",
        `Para ejercerlo, utilice el Botón de arrepentimiento del sitio o comuníquese con el comercio ${comoContactar(d)}.`,
      ],
      enlaces: [{ label: "Botón de arrepentimiento", href: "/arrepentimiento" }],
    },
    {
      titulo: "Excepciones",
      parrafos: [
        "Conforme al art. 1116 del Código Civil y Comercial de la Nación, el derecho de revocación no se aplica a los productos confeccionados según las especificaciones del consumidor o claramente personalizados (por ejemplo, cortados o fraccionados a pedido), ni a los que por su naturaleza no pueden ser devueltos o pueden deteriorarse con rapidez.",
        "El derecho de revocación corresponde a quien compra como consumidor final. No alcanza a las compras realizadas para una actividad comercial o profesional.",
      ],
    },
    {
      titulo: "Consultas y reclamos",
      parrafos: [
        `Ante cualquier consulta o reclamo puede comunicarse con el comercio ${comoContactar(d)}. También puede presentar su reclamo ante la Ventanilla Federal de Defensa del Consumidor.`,
      ],
      enlaces: [ENLACE_DEFENSA_CONSUMIDOR],
    },
  );

  return bloques;
}
