"use client";

import Link from "next/link";
import type { RenderLink } from "@myd-org/ui";

/**
 * Enchufe de `next/link` para los componentes del DS que aceptan `renderLink`
 * (Breadcrumb, Pagination, ProductCard). Único lugar donde el catálogo le
 * presta el router de Next al DS: el DS recibe href, clases y aria ya
 * resueltos y sólo cambia el `<a>` por el `<Link>`.
 */
export const linkNext: RenderLink = (props) => <Link {...props} />;
