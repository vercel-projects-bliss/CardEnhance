import { ActionLink } from "@/components/action-link";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export default function NotFound() {
  return (
    <>
      <PageHeader
        index="00"
        title="Page not found"
        description="That address is not part of this app."
      />
      <EmptyState
        compact
        title="Nothing here"
        description="Check the URL, or use the sidebar to go to a page that exists."
        action={<ActionLink href="/">Back to Dashboard</ActionLink>}
      />
    </>
  );
}
