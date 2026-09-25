/**
 * Texto de la página del Botón de arrepentimiento (/arrepentimiento). Borrador
 * sujeto a revisión legal. SOLO el mínimo legal (art. 34 Ley 24.240, arts.
 * 1110–1116 CCyC, Res. 424/2020): ningún plazo ni beneficio extra.
 */
import type { DatosLegales } from "@/data/home-defaults";
import { comoContactar, identificacionComercio, type Bloque } from "./comun";

export function bloquesArrepentimiento(d: DatosLegales): Bloque[] {
  const identificacion = identificacionComercio(d);
  const bloques: Bloque[] = [
    {
      titulo: "Su derecho",
      parrafos: [
        "Si usted compró como consumidor final, puede revocar la compra dentro de los 10 días corridos contados desde la entrega del producto o desde la celebración del contrato, lo que ocurra último, sin necesidad de indicar el motivo (art. 34 de la Ley 24.240 y arts. 1110 a 1116 del Código Civil y Comercial de la Nación).",
        "La revocación no tiene costo para usted: los gastos de devolución son a cargo del comercio (art. 34 de la Ley 24.240 y art. 1115 del Código Civil y Comercial de la Nación).",
      ],
    },
    {
      titulo: "Excepciones",
      parrafos: [
        "Conforme al art. 1116 del Código Civil y Comercial de la Nación, el derecho de revocación no se aplica a los productos confeccionados según las especificaciones del consumidor o claramente personalizados (por ejemplo, cortados o fraccionados a pedido), ni a los que por su naturaleza no pueden ser devueltos o pueden deteriorarse con rapidez.",
        "No alcanza a las compras realizadas para una actividad comercial o profesional.",
      ],
    },
    {
      titulo: "Cómo sigue el trámite",
      parrafos: [
        "Complete el formulario de esta página. Al enviarlo verá en pantalla el código de su solicitud y le enviaremos una copia al correo electrónico que indique.",
        `El comercio se comunicará con usted para coordinar la devolución del producto. Ante cualquier consulta puede comunicarse ${comoContactar(d)}, indicando el código de su solicitud.`,
      ],
    },
  ];

  if (identificacion.length > 0) {
    bloques.push({ titulo: "Identificación del comercio", parrafos: identificacion });
  }
  return bloques;
}
