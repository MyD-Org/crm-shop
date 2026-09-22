"use client";

import { useRouter } from "next/navigation";
import { useClerk, useUser } from "@clerk/nextjs";
import { Avatar, DropdownMenu, type DropdownMenuEntry } from "@myd-org/ui";
import {
  ENTRADAS_MENU,
  HREF_FAVORITOS,
  HREF_MIS_DATOS,
  HREF_MIS_PEDIDOS,
  RUTA_PANEL_SEGURIDAD,
  etiquetaBotonMenu,
  type IdEntradaMenu,
} from "@/lib/menu-usuario";

function IconoPersona({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function IconoPedidos() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 8 12 3 3 8l9 5 9-5Z" />
      <path d="M3 8v8l9 5 9-5V8" />
      <path d="M12 13v8" />
    </svg>
  );
}

function IconoFavoritos() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
    </svg>
  );
}

function IconoSeguridad() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3 4 6v6c0 4.5 3.2 8 8 9 4.8-1 8-4.5 8-9V6l-8-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function IconoSalir() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}

const ICONOS: Record<IdEntradaMenu, React.ReactNode> = {
  pedidos: <IconoPedidos />,
  favoritos: <IconoFavoritos />,
  datos: <IconoPersona />,
  seguridad: <IconoSeguridad />,
  salir: <IconoSalir />,
};

/**
 * Único avatar del header: reemplaza al link "Mi cuenta" + <UserButton> de
 * Clerk. El menú es nuestro. "Mis pedidos" y "Mis datos" son páginas del
 * sitio; solo "Seguridad" abre el panel de Clerk, que sigue siendo el dueño de
 * contraseña, correo, verificación en dos pasos y sesiones.
 */
export function MenuUsuario({ nombre }: { nombre: string | null }) {
  const router = useRouter();
  const clerk = useClerk();
  const { user } = useUser();

  const nombreVisible = nombre ?? user?.fullName ?? null;
  const email = user?.primaryEmailAddress?.emailAddress;

  function alSeleccionar(id: IdEntradaMenu) {
    switch (id) {
      case "pedidos":
        router.push(HREF_MIS_PEDIDOS);
        break;
      case "favoritos":
        router.push(HREF_FAVORITOS);
        break;
      case "datos":
        router.push(HREF_MIS_DATOS);
        break;
      case "seguridad":
        clerk.openUserProfile({ __experimental_startPath: RUTA_PANEL_SEGURIDAD });
        break;
      case "salir":
        void clerk.signOut({ redirectUrl: "/" });
        break;
    }
  }

  const items: DropdownMenuEntry[] = [
    {
      type: "label",
      label: (
        <span className="block min-w-0">
          <span className="block truncate text-sm font-semibold text-text">
            {nombreVisible ?? "Mi cuenta"}
          </span>
          {email && (
            <span className="block truncate text-xs font-normal text-muted">{email}</span>
          )}
        </span>
      ),
    },
    { type: "separator" },
    ...ENTRADAS_MENU.flatMap((entrada): DropdownMenuEntry[] => {
      const item: DropdownMenuEntry = {
        label: entrada.label,
        icon: ICONOS[entrada.id],
        tone: entrada.tone,
        onSelect: () => alSeleccionar(entrada.id),
      };
      // Cerrar sesión va separado del resto.
      return entrada.id === "salir" ? [{ type: "separator" }, item] : [item];
    }),
  ];

  return (
    <DropdownMenu items={items} align="end" className="min-w-[14rem] max-w-[18rem]">
      <button
        type="button"
        aria-label={etiquetaBotonMenu(nombreVisible)}
        className="flex cursor-pointer items-center gap-2 rounded-full text-[13.5px] font-bold text-text transition-colors hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {user?.hasImage ? (
          <Avatar src={user.imageUrl} name={nombreVisible ?? "Mi cuenta"} size="sm" />
        ) : (
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border bg-surface">
            <IconoPersona />
          </span>
        )}
        <span className="hidden max-w-[14ch] truncate sm:inline">
          {nombreVisible ?? "Mi cuenta"}
        </span>
      </button>
    </DropdownMenu>
  );
}
