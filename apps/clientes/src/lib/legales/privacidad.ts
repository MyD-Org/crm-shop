/**
 * Política de privacidad (Ley 25.326). Borrador sujeto a revisión legal.
 * No afirma número de inscripción de la base: se agrega cuando exista.
 */
import type { DatosLegales } from "@/data/home-defaults";
import { comoContactar, identificacionComercio, type Bloque } from "./comun";

export function bloquesPrivacidad(d: DatosLegales): Bloque[] {
  const identificacion = identificacionComercio(d);
  const bloques: Bloque[] = [];

  if (identificacion.length > 0) {
    bloques.push({ titulo: "Responsable de los datos", parrafos: identificacion });
  }

  bloques.push(
    {
      titulo: "Qué datos recopilamos",
      parrafos: [
        "Recopilamos los datos que usted nos proporciona al crear su cuenta, realizar pedidos, comunicarse con el comercio o presentar una solicitud de arrepentimiento: nombre, correo electrónico, teléfono, domicilio de entrega y datos de facturación.",
      ],
    },
    {
      titulo: "Para qué los usamos",
      parrafos: [
        "Utilizamos esos datos para gestionar su cuenta y sus pedidos, facturar, coordinar entregas, responder sus consultas y cumplir obligaciones legales.",
        "No los cedemos a terceros, salvo a los proveedores necesarios para prestar el servicio (por ejemplo, facturación, cobros o envío de correos) o cuando la ley lo exija.",
      ],
    },
    {
      titulo: "Sus derechos",
      parrafos: [
        "Usted puede solicitar el acceso, la rectificación, la actualización o la supresión de sus datos personales (Ley 25.326). El acceso es gratuito a intervalos no inferiores a seis meses, salvo que se acredite un interés legítimo (art. 14, inc. 3, de la Ley 25.326).",
        `Para ejercer estos derechos, comuníquese con el comercio ${comoContactar(d)}.`,
      ],
    },
    {
      titulo: "Autoridad de control",
      parrafos: [
        "La Agencia de Acceso a la Información Pública (AAIP), en su carácter de órgano de control de la Ley 25.326, tiene la atribución de atender las denuncias y reclamos de quienes resulten afectados en sus derechos por incumplimiento de las normas vigentes en materia de protección de datos personales.",
      ],
    },
  );

  return bloques;
}
