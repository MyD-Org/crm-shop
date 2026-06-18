import Link from "next/link";
import Image from "next/image";

export function Footer() {
  return (
    <footer className="mt-auto bg-surface-dark text-on-surface-dark">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:grid-cols-2 lg:grid-cols-4">
        {/* Brand */}
        <div>
          <div className="mb-4 flex items-center gap-3">
            <Image
              src="/central-led-avatar.jpg"
              alt="Central LED"
              width={40}
              height={40}
              className="rounded-full"
            />
            <span className="text-lg font-bold tracking-tight text-info">
              CENTRAL LED
            </span>
          </div>
          <p className="text-sm leading-relaxed text-white/50">
            Materiales eléctricos e iluminación en Puerto Iguazú, Misiones.
          </p>
        </div>

        {/* Rubros */}
        <div>
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide">
            Rubros
          </h3>
          <ul className="space-y-2.5 text-sm text-white/50">
            <li>
              <Link href="/catalogo?categoria=Iluminación+LED" className="hover:text-white">
                Iluminación LED
              </Link>
            </li>
            <li>
              <Link href="/catalogo?categoria=Tableros" className="hover:text-white">
                Tableros
              </Link>
            </li>
            <li>
              <Link href="/catalogo?categoria=Cables" className="hover:text-white">
                Cables
              </Link>
            </li>
            <li>
              <Link href="/catalogo?categoria=Automatización" className="hover:text-white">
                Automatización
              </Link>
            </li>
          </ul>
        </div>

        {/* Mi cuenta */}
        <div>
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide">
            Mi cuenta
          </h3>
          <ul className="space-y-2.5 text-sm text-white/50">
            <li>
              <Link href="/cuenta/pedidos" className="hover:text-white">
                Mis pedidos
              </Link>
            </li>
            <li>
              <Link href="/cuenta/cuenta-corriente" className="hover:text-white">
                Cuenta corriente
              </Link>
            </li>
            <li>
              <Link href="/cuenta/facturas" className="hover:text-white">
                Facturas
              </Link>
            </li>
          </ul>
        </div>

        {/* Contacto */}
        <div>
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide">
            Contacto
          </h3>
          <ul className="space-y-2.5 text-sm text-white/50">
            <li>
              <span className="hover:text-white">WhatsApp</span>
            </li>
            <li>
              <Link href="/envios" className="hover:text-white">
                Envíos y pagos
              </Link>
            </li>
            <li>
              <span className="hover:text-white">Ubicación</span>
            </li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
