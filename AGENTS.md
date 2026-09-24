<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (dentro de la app en la que esté trabajando) before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Monorepo crm-shop

- `apps/admin` = CRM (backoffice + portal + `/api/agent/*`). `apps/clientes` = Shop.
- **No hay workspaces**: cada app tiene su `package.json`, su `package-lock.json` y su `node_modules`. Todos los comandos (`npm ci`, `npm run dev`, tests, `db:*`) se corren **parados en la carpeta de la app**. No crear `package.json` ni lockfile en la raíz.
- Cada app tiene su propio proyecto de Vercel (Root Directory = carpeta de la app). Comparten **una** base Postgres: el CRM es dueño del esquema `public` (y de sus migraciones, en `apps/admin/drizzle`); el Shop, del esquema `shop` (`apps/clientes/drizzle`). El Shop lee/escribe tablas de `public` sólo con los permisos mínimos que concede una migración del CRM, y las declara en `apps/clientes/src/db/crm.ts` (contrato de columnas en `apps/clientes/src/db/__fixtures__/crm-contrato.json`).
- La cuenta corriente del cliente de la tienda vive en **Mi cuenta** del Shop. El portal de clientes del CRM (`/portal`) queda para las empresas sin tienda: el Shop no lo enlaza.
- Un cambio no debería tocar las dos apps salvo que sea un contrato entre ellas.
- **Repo público**: nada de secretos, planillas, datos reales ni URLs de producción. Nunca `git add -A`; agregar rutas explícitas. `.github/scripts/repo-guard.sh tree` debe pasar.
- Workflows en `.github/workflows/` con prefijo `admin-` / `clientes-`; los secrets llevan prefijo `ADMIN_` / `CLIENTES_`.
- `packages/` está reservado para código compartido futuro: hoy no tiene código.
- Prohibido: `git add -A` / `git add .`, leer o imprimir archivos `.env*`, y `git push --force` sobre este remoto. Contenido prohibido: secretos, planillas y volcados de datos, datos de clientes reales, URLs y dominios de producción.
- En tests, docs, comentarios y ejemplos use siempre dominios reservados `.example` (RFC 2606): `cliente.example`, `plataforma.example`. Nunca dominios reales de clientes ni de la plataforma.

# Ecosistema MyD-Org

Estas apps son parte de varios productos de MyD-Org pensados para integrarse entre sí pero también venderse por separado. El contexto compartido (mapa de productos, contratos de integración y decisiones) vive en el repo [`MyD-Org/platform`](https://github.com/MyD-Org/platform).

**Antes de trabajar en una integración, leé el contrato correspondiente en `platform`.** Si cambiás un contrato, actualizá el doc en `platform` en el mismo cambio y avisá al otro proyecto.

Lo específico de cada app está en `apps/<app>/AGENTS.md`.
