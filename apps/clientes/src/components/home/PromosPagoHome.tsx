import { connection } from "next/server";
import { ServiceCard } from "@myd-org/ui";
import type { PromosPagoContent } from "@/data/home-defaults";
import { campaniasVigentes } from "@/lib/campanias/vigentes";
import { destacadosHome } from "@/lib/catalogo-publico";
import { flagsPublicos } from "@/lib/flags-publicos";
import { promosPago, type PromoPago } from "@/lib/promos-pago";
import { dispCatalogo } from "@/lib/zona-servidor";
import { TituloSeccion } from "./TituloSeccion";

/**
 * Promos de pago de la home: hueco por request (flags y medios se evalúan acá, nunca en el shell).
 * Las cuotas salen de `mediosPrecio.cuotas` (las de Mercado Pago, de su cuenta) y el descuento del
 * medio destacado se deduce de los mismos productos que los destacados de la home: mismos argumentos
 * que `DestacadosHome`, así comparten la caché y no hay otra lectura del catálogo.
 * Sin avisos no dibuja nada.
 */
export async function PromosPagoHome({
  contenido,
  skus,
  cantidad,
}: {
  contenido: PromosPagoContent;
  skus: string[];
  cantidad: number;
}) {
  await connection();
  const [{ soloVisibles, variantes, mediosPrecio }, disp, campanias] = await Promise.all([
    flagsPublicos(),
    dispCatalogo(),
    campaniasVigentes(),
  ]);
  const productos = mediosPrecio?.destacado
    ? await destacadosHome({
        skus,
        cantidad,
        soloVisibles,
        ...(variantes ? { agrupar: true } : {}),
        disp,
        destacado: mediosPrecio.destacado,
        cuotas: mediosPrecio.cuotas,
        campanias,
      }).catch(() => [])
    : [];
  const avisos = promosPago({ cuotas: mediosPrecio?.cuotas, destacado: mediosPrecio?.destacado, productos });
  if (avisos.length === 0) return null;
  return <PromosPagoVista contenido={contenido} avisos={avisos} />;
}

export function PromosPagoVista({ contenido, avisos }: { contenido: PromosPagoContent; avisos: PromoPago[] }) {
  return (
    <section aria-label={contenido.titulo ? undefined : "Promociones de pago"} className="pt-[clamp(28px,4vw,48px)]">
      <TituloSeccion textos={contenido} />
      <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {avisos.map((a) => (
          <li key={a.tipo}>
            <ServiceCard className="h-full" icon={a.tipo === "cuotas" ? <IconoTarjeta /> : <IconoPorcentaje />} title={a.titulo} text={a.texto} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function IconoTarjeta() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18" />
    </svg>
  );
}

function IconoPorcentaje() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 5 5 19" />
      <circle cx="7" cy="7" r="2.5" />
      <circle cx="17" cy="17" r="2.5" />
    </svg>
  );
}
