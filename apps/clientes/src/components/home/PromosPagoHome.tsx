import { PromoBar, PromoTag } from "@myd-org/ui";
import { connection } from "next/server";
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
 *
 * `enHero`: van al pie del hero (barra translúcida del ancho del texto, sin título) en lugar de una
 * sección propia. La sección queda sólo para cuando el hero está oculto.
 */
export async function PromosPagoHome({
  contenido,
  skus,
  cantidad,
  enHero = false,
}: {
  contenido: PromosPagoContent;
  skus: string[];
  cantidad: number;
  enHero?: boolean;
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
  const avisos = promosPago({ cuotas: mediosPrecio?.cuotas, destacado: mediosPrecio?.destacado, productos, textos: contenido });
  if (avisos.length === 0) return null;
  if (enHero) return <PromosPagoBarra avisos={avisos} />;
  return <PromosPagoVista contenido={contenido} avisos={avisos} />;
}

export function PromosPagoBarra({ avisos }: { avisos: PromoPago[] }) {
  return (
    <PromoBar
      aria-label="Promociones de pago"
      items={avisos.map((a) =>
        a.tipo === "cuotas"
          ? { eyebrow: "Hasta", value: String(a.cuotas), title: "cuotas sin interés", text: a.texto }
          : // El descuento no anuncia porcentaje: el "%" es sólo el símbolo.
            { value: "%", decorativeValue: true, title: a.titulo, text: a.texto },
      )}
    />
  );
}

export function PromosPagoVista({ contenido, avisos }: { contenido: PromosPagoContent; avisos: PromoPago[] }) {
  return (
    <section aria-label={contenido.titulo ? undefined : "Promociones de pago"} className="pt-[clamp(28px,4vw,48px)]">
      <TituloSeccion textos={contenido} />
      {/* Una sola etiqueta: ancho completo en mobile, media fila en desktop (no se estira). */}
      <ul className={`grid gap-2.5 sm:grid-cols-2 sm:gap-4 ${avisos.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
        {avisos.map((a) => (
          <li key={a.tipo}>
            {a.tipo === "cuotas" ? (
              <PromoTag eyebrow="Hasta" value={String(a.cuotas)} title="cuotas sin interés" text={a.texto} />
            ) : (
              // El descuento no anuncia porcentaje: el "%" es sólo el símbolo de la etiqueta.
              <PromoTag value="%" decorativeValue title={a.titulo} text={a.texto} />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
