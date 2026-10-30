import { IconoWhatsapp } from "@/components/IconoWhatsapp";
import { hrefInstagram, type RedFooter } from "@/data/footer";

function InstagramIcon() {
  return (
    <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" />
    </svg>
  );
}

/**
 * Cuentas de Instagram (campo `redes` de la fila `footer`) como íconos con el
 * nombre corto al lado: con dos cuentas, un ícono solo no dice cuál es cuál.
 * Va en la barra superior (layout) y en la barra inferior del footer, las dos
 * sobre `bg-primary`; mismo estilo que los links del footer del DS. Sin
 * cuentas no se pinta nada. Server component.
 *
 * "Seguinos" adelante: sin él, "Mar del Plata · Iguazú" en la barra superior
 * se lee como las ubicaciones de los locales. Va en vos a pedido del dueño de
 * la tienda (excepción al registro de usted de CLAUDE.md): es el mismo tono
 * de las cuentas de Instagram.
 *
 * `whatsapp` (link ya armado) suma el WhatsApp de la tienda al final, con el mismo estilo: lo pasa
 * solo la barra superior, que es donde está a mano antes de bajar (después, en la barra compacta
 * del header). Para que todo entre en una línea en el celular, el espacio entre links es menor y en
 * las pantallas más angostas (menos de 380px) WhatsApp queda solo con el ícono.
 */
export function RedesSociales({
  redes,
  whatsapp = null,
  className = "",
}: {
  redes: RedFooter[];
  whatsapp?: string | null;
  className?: string;
}) {
  if (redes.length === 0 && !whatsapp) return null;
  return (
    <ul className={`flex flex-wrap items-center gap-x-3 gap-y-1 md:gap-x-4 ${className}`}>
      {redes.length > 0 ? <li className="text-[12.5px] font-semibold text-on-primary/55">Seguinos</li> : null}
      {redes.map((r) => (
        <li key={r.usuario}>
          <a
            href={hrefInstagram(r.usuario)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Instagram ${r.nombre} (@${r.usuario})`}
            className={CLASE_LINK}
          >
            <InstagramIcon />
            {r.nombre}
          </a>
        </li>
      ))}
      {whatsapp ? (
        <li>
          <a href={whatsapp} target="_blank" rel="noopener noreferrer" className={CLASE_LINK}>
            <IconoWhatsapp className="size-4 shrink-0" />
            <span className="max-[379px]:sr-only">WhatsApp</span>
          </a>
        </li>
      ) : null}
    </ul>
  );
}

const CLASE_LINK =
  "flex items-center gap-1.5 text-[12.5px] font-semibold text-on-primary/85 transition-colors hover:text-highlight";
