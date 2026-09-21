# crm-shop

Monorepo con dos aplicaciones Next.js independientes:

| Carpeta | Qué es |
|---|---|
| `apps/admin` | CRM: backoffice, portal de clientes y API para agentes |
| `apps/clientes` | Shop: tienda online |
| `packages/` | Reservado para código compartido (todavía vacío) |

No hay `package.json` ni lockfile en la raíz: cada app se instala y se corre **parada en su carpeta**.

    cd apps/admin && npm ci && npm run dev
    cd apps/clientes && npm ci && npm run dev

Los workflows viven en `.github/workflows/` con prefijo por app (`admin-*`, `clientes-*`) y filtros `paths:`.

**Este repo es público.** Nunca se commitean planillas, archivos `.env*`, datos reales ni URLs de producción: `scripts/repo-guard.sh` y el workflow `guard` lo verifican. Nunca usar `git add -A`.
