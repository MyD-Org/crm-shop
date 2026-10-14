/**
 * Texto base de las páginas institucionales: genérico, en español de usted, sin
 * datos de ninguna empresa (ni nombres propios, ni teléfonos, domicilios, montos
 * o plazos). La marca entra solo por `marca.nombre`; el correo y el WhatsApp, solo
 * si el comercio los cargó. Función pura, así los tests cubren el texto sin DOM.
 *
 * Borrador sujeto a revisión: cada comercio debe reemplazarlo con su información
 * real desde `/editar-paginas` antes de publicar. No agregar plazos, beneficios ni
 * promesas legales acá.
 */
import type { DatosLegales } from "@/data/home-defaults";
import { hrefWhatsapp } from "@/data/footer";
import type { Bloque } from "@/lib/legales/comun";
import type { SlugInstitucional } from "./paginas";

const aviso = (nombre: string): Bloque => ({
  titulo: "Aviso",
  parrafos: [
    `Este texto es un borrador sujeto a revisión. ${nombre} puede reemplazarlo en cualquier momento con su información propia.`,
  ],
});

export function base(
  slug: SlugInstitucional,
  marca: { nombre: string },
  datos: Pick<DatosLegales, "email">,
  whatsapp: string,
): Bloque[] {
  const nombre = marca.nombre;
  switch (slug) {
    case "preguntas-frecuentes":
      return [
        {
          titulo: "¿Cómo realizo una compra?",
          parrafos: [
            "Seleccione los productos que le interesan, agréguelos al carrito y siga los pasos del pedido. Al finalizar recibirá la confirmación de su compra.",
          ],
        },
        {
          titulo: "¿Qué medios de pago puedo usar?",
          parrafos: [
            "Los medios de pago disponibles se muestran al momento de confirmar el pedido. Elija el que le resulte más conveniente.",
          ],
        },
        {
          titulo: "¿Cómo recibo mi pedido?",
          parrafos: [
            "Puede elegir la entrega o el retiro, según las opciones disponibles para su pedido. Consulte la sección de envíos y devoluciones para conocer los detalles.",
          ],
        },
        {
          titulo: "¿Qué hago si tengo una consulta?",
          parrafos: [`Comuníquese con ${nombre} por los medios de contacto indicados en este sitio y le responderemos a la brevedad.`],
        },
        aviso(nombre),
      ];
    case "garantia":
      return [
        {
          titulo: "Garantía de los productos",
          parrafos: [
            `Los productos comercializados por ${nombre} cuentan con la garantía legal que corresponde a cada caso, según la normativa vigente y las condiciones del fabricante.`,
          ],
        },
        {
          titulo: "Cómo hacer valer la garantía",
          parrafos: [
            "Conserve el comprobante de su compra y comuníquese con nosotros indicando el producto y el motivo del reclamo. Evaluaremos su caso y le indicaremos los pasos a seguir.",
          ],
        },
        {
          titulo: "Qué no cubre la garantía",
          parrafos: [
            "La garantía no cubre daños causados por un uso o una instalación inadecuados, ni el desgaste normal del producto.",
          ],
        },
        aviso(nombre),
      ];
    case "envios-y-devoluciones":
      return [
        {
          titulo: "Envíos",
          parrafos: [
            "Las opciones de entrega y su costo se informan al confirmar el pedido, según el destino que usted indique.",
          ],
        },
        {
          titulo: "Retiro en el local",
          parrafos: ["Cuando esta opción esté disponible, podrá retirar su pedido en el local una vez que se le avise que está listo."],
        },
        {
          titulo: "Cambios y devoluciones",
          parrafos: [
            "Si necesita cambiar o devolver un producto, comuníquese con nosotros y le indicaremos cómo proceder. Conserve el producto en su estado original y su comprobante de compra.",
            "Recuerde que también puede ejercer su derecho de arrepentimiento desde el botón disponible en el pie de página.",
          ],
        },
        aviso(nombre),
      ];
    case "nosotros":
      return [
        {
          titulo: `Quiénes somos`,
          parrafos: [
            `${nombre} es una tienda que ofrece sus productos a través de este sitio, con atención personalizada antes y después de la compra.`,
          ],
        },
        {
          titulo: "Nuestro compromiso",
          parrafos: [
            "Trabajamos para ofrecerle productos de calidad, información clara y una atención cordial en cada etapa de su compra.",
          ],
        },
        aviso(nombre),
      ];
    case "contacto": {
      const medios: Bloque = {
        titulo: "Medios de contacto",
        parrafos: [
          `Puede comunicarse con ${nombre} por los medios que se detallan a continuación.`,
          ...(datos.email ? [`Correo electrónico: ${datos.email}`] : []),
        ],
        ...(whatsapp ? { enlaces: [{ label: "Escribir por WhatsApp", href: hrefWhatsapp(whatsapp), external: true }] } : {}),
      };
      return [
        medios,
        {
          titulo: "Consultas",
          parrafos: ["Indique su consulta con el mayor detalle posible y le responderemos a la brevedad."],
        },
        aviso(nombre),
      ];
    }
  }
}
