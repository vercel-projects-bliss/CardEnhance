import type { Metadata } from "next";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = {
  title: "Studio",
};

export default function StudioPage() {
  return (
    <>
      <PageHeader
        title="Studio"
        description="Open a scan when you are ready to work on a card."
      />
      <EmptyState
        title="No scan open"
        description="The workspace will appear here once a card is opened."
      />
    </>
  );
}
