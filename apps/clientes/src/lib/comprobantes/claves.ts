// Portado de `receiptKeys` de apps/admin/src/lib/r2.ts. MISMO formato de keys
// que el portal del CRM: el backoffice lee `file_key` del mismo bucket y la
// lifecycle rule del bucket matchea por prefijo (`tmp/` se borra a 1 día,
// `receipts/` no expira: respaldo contable). Nunca nombre original,
// codigocliente ni CUIT en la key.

const TENANT_ID_RE = /^[a-z0-9-]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertKeyPart(label: string, value: string, re: RegExp): void {
  if (!re.test(value)) throw new Error(`${label} inválido para key de R2: ${JSON.stringify(value)}`);
}

export const claves = {
  tmp: (tenantId: string, id: string): string => {
    assertKeyPart("tenantId", tenantId, TENANT_ID_RE);
    assertKeyPart("id", id, UUID_RE);
    return `tmp/receipts/${tenantId}/${id}`;
  },
  final: (tenantId: string, id: string, ext: string, submittedAt: Date): string => {
    assertKeyPart("tenantId", tenantId, TENANT_ID_RE);
    assertKeyPart("id", id, UUID_RE);
    const yyyyMm = `${submittedAt.getUTCFullYear()}-${String(submittedAt.getUTCMonth() + 1).padStart(2, "0")}`;
    return `receipts/${tenantId}/${yyyyMm}/${id}.${ext}`;
  },
};

/** Un id que no es UUID se trata como inexistente (nunca llega a la base). */
export function esUuid(id: string): boolean {
  return UUID_RE.test(id);
}
