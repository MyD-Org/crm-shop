import { RedesSociales } from "@/components/footer/RedesSociales";
import { IconoWhatsapp } from "@/components/IconoWhatsapp";
import { hrefWhatsapp, type RedFooter } from "@/data/footer";
import { clasesVisibilidad, type Visibilidad } from "@/data/home-defaults";

/**
 * Barra superior del layout: anuncio global (contenido administrable) al medio y, a la derecha,
 * las cuentas de Instagram (`redes` del footer del SITIO: un sitio con marca propia muestra sólo
 * las suyas) y el WhatsApp. Dónde se ve el anuncio lo decide el editor; las redes y el WhatsApp
 * se ven siempre. Sin anuncio visible, sin redes y sin WhatsApp, no hay barra.
 * Grilla: con un anuncio largo, el texto se achica y parte línea; la derecha conserva su ancho.
 */
export function BarraSuperior({
  anuncio,
  visibilidad,
  redes,
  whatsapp: numeroWhatsapp,
  seguinos = true,
}: {
  /** Texto del anuncio ya filtrado por visibilidad "nunca" (undefined = sin anuncio). */
  anuncio: string | undefined;
  visibilidad: Visibilidad;
  redes: RedFooter[];
  /** Número en dígitos; vacío = sin link. */
  whatsapp: string;
  /** "Seguinos" adelante del Instagram: sólo la marca de Central. */
  seguinos?: boolean;
}) {
  const whatsapp = numeroWhatsapp ? hrefWhatsapp(numeroWhatsapp) : null;
  if (!anuncio && redes.length === 0 && !whatsapp) return null;
  // Qué esconde la barra entera: con redes o WhatsApp se ve siempre; si no, lo que pida el anuncio.
  const clasesBarra = redes.length > 0 || whatsapp ? "" : clasesVisibilidad(visibilidad);
  return (
    <div className={`bg-primary text-on-primary ${clasesBarra}`}>
      <div className="mx-auto flex max-w-contenido flex-col items-center gap-1.5 px-[clamp(18px,4vw,48px)] py-2.5 md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,max-content)_minmax(max-content,1fr)] md:gap-4">
        <span aria-hidden className="max-md:hidden" />
        {anuncio ? (
          <p className={`text-center text-[12.5px] font-semibold tracking-wide ${clasesVisibilidad(visibilidad)}`}>{anuncio}</p>
        ) : (
          <span aria-hidden className="max-md:hidden" />
        )}
        <div className="flex items-center justify-center gap-x-4 md:gap-x-5 md:justify-end">
          <RedesSociales redes={redes} className="flex-nowrap justify-center md:justify-end" claseSeguinos="max-md:hidden" seguinos={seguinos} />
          {whatsapp ? (
            <a
              href={whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              className="flex shrink-0 items-center gap-1.5 text-[12.5px] font-semibold text-on-primary/85 transition-colors hover:text-highlight"
            >
              <IconoWhatsapp className="size-4 text-[#25D366]" />
              WhatsApp
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
