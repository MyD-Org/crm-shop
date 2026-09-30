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
        "No los cedemos a terceros, salvo a los proveedores necesarios para prestar el servicio (por ejemplo, facturación, cobros, envío de correos o medición del sitio, según se detalla en «Cookies y herramientas de análisis») o cuando la ley lo exija.",
      ],
    },
    {
      titulo: "Cookies y herramientas de análisis",
      parrafos: [
        "Para saber cómo se usa la tienda y medir nuestras campañas utilizamos cookies y herramientas de análisis de terceros: Vercel Web Analytics y Speed Insights (visitas y rendimiento de las páginas, sin cookies), Google Analytics, el píxel de Meta (Facebook e Instagram) y PostHog (uso del sitio y grabaciones de sesión anónimas).",
        "Estas herramientas registran datos de navegación como las páginas que visita, los productos que ve o agrega al carrito, los pedidos que confirma (número y monto), el tipo de dispositivo y navegador, y su ubicación aproximada. En las grabaciones de sesión todo lo que usted escribe en los formularios queda oculto, y en las páginas de ingreso y registro no se registra nada.",
        "Estos proveedores pueden procesar la información en servidores ubicados fuera de la República Argentina.",
        "Usted puede bloquear o borrar las cookies desde la configuración de su navegador, y administrar los anuncios que ve desde las preferencias de su cuenta de Meta o de Google. Bloquearlas no le impide comprar en la tienda.",
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
