import type { Metadata } from "next";
import { Suspense } from "react";
import { AuditLog } from "@/components/audit-log";
import { PageHeader } from "@/components/page-header";
import { listAuditLogs } from "@/lib/data";

export const metadata: Metadata = {
  title: "Audit",
};

export default function AuditPage() {
  return (
    <>
      <PageHeader
        index="01"
        title="Audit"
        description="Restoration records for chrome/foil detection, scratch removal, denoise, sharpness delta, and in→out resolution."
      />
      <Suspense fallback={<p className="text-sm text-ink-muted">Loading audit log…</p>}>
        <AuditBody />
      </Suspense>
    </>
  );
}

async function AuditBody() {
  const rows = await listAuditLogs();
  return <AuditLog rows={rows} />;
}
