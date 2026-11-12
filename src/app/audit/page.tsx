import type { Metadata } from "next";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = {
  title: "Audit",
};

export default function AuditPage() {
  return (
    <>
      <PageHeader
        title="Audit"
        description="A record of changes will appear here."
      />
      <EmptyState
        title="No activity yet"
        description="When actions are recorded, they will be listed on this page."
      />
    </>
  );
}
