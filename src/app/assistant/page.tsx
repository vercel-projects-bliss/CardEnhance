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
        description="Ask for help with a card from this page."
      />
      <EmptyState
        title="Assistant is not connected"
        description="A conversation will appear here once this page is wired up."
      />
    </>
  );
}
