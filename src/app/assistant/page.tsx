import type { Metadata } from "next";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = {
  title: "Assistant",
};

export default function AssistantPage() {
  return (
    <>
      <PageHeader
        title="Assistant"
        description="This page is reserved for later. The working app does not include an assistant."
      />
      <EmptyState
        compact
        title="No assistant in the working app"
        description="There are no assistant controls to show yet, so this page stays empty rather than inventing a chat that would not work."
      />
    </>
  );
}
