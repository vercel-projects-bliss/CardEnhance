import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export default function NotFound() {
  return (
    <>
      <PageHeader
        title="Page not found"
        description="That address is not part of this app."
      />
      <EmptyState
        title="Nothing here"
        description="Check the URL, or use the sidebar to go to a page that exists."
        action={
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-lg bg-accent/10 px-4 py-2 text-sm font-medium text-accent ring-1 ring-inset ring-accent/20 transition-colors hover:bg-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Back to Dashboard
          </Link>
        }
      />
    </>
  );
}
