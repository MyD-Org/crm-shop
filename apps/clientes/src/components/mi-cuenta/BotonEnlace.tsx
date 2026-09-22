"use client";

import { Button, type ButtonProps } from "@myd-org/ui";
import { linkNext } from "@/components/catalogo/link-next";

/**
 * `Button` del DS con `href`, navegando con `next/link`. Existe para que las
 * páginas de servidor puedan poner un enlace con aspecto de botón sin pasarle
 * una función (`renderLink`) a un componente de cliente: sólo reciben props
 * serializables.
 */
export function BotonEnlace(props: Omit<ButtonProps, "renderLink"> & { href: string }) {
  return <Button {...props} renderLink={linkNext} />;
}
