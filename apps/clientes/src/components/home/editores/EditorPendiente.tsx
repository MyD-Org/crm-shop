"use client";

import { Alert } from "@myd-org/ui";

/** Placeholder para secciones que se editan recién en la rebanada B2. */
export function EditorPendiente(_props: { valor: unknown; onChange: (v: unknown) => void }) {
  void _props;
  return (
    <Alert tone="neutral" title="Próximamente">
      Esta sección se podrá editar en una próxima versión.
    </Alert>
  );
}
