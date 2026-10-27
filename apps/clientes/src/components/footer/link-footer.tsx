"use client";

import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import type { RenderLink, RenderLinkProps } from "@myd-org/ui";
import { rutaIngreso } from "@/lib/ingreso";
import { LINKS_SIN_SESION } from "@/lib/legales/footer";

/**
 * `renderLink` del footer. El footer va en el shell estático (no sabe si hay
 * sesión), así que la columna "Mi cuenta" se resuelve acá, en el navegador:
 * sin sesión, "Mis pedidos" pasa a "Ingresar" y "Facturas" a "Crear cuenta".
 * Mientras Clerk carga se muestra la versión sin sesión (la más común).
 */
export const linkFooter: RenderLink = (props) => <LinkFooter {...props} />;

function LinkFooter(props: RenderLinkProps) {
  const { userId } = useAuth();
  const sinSesion = LINKS_SIN_SESION[props.href];
  if (!sinSesion || userId) return <Link {...props} />;
  const href = sinSesion.ingreso ? rutaIngreso(props.href) : (sinSesion.href ?? props.href);
  return (
    <Link {...props} href={href}>
      {sinSesion.label}
    </Link>
  );
}
