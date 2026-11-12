import type { Metadata } from "next";
import { Suspense } from "react";
import { LibraryBrowser } from "@/components/library-browser";
import { PageHeader } from "@/components/page-header";
import { listStoredCards } from "@/lib/data";

export const metadata: Metadata = {
  title: "Library",
};

export default function LibraryPage() {
  return (
    <>
      <PageHeader
        title="Library"
        description="Browse the cards in your library."
      />
      <Suspense fallback={<p className="text-sm text-ink-muted">Loading library…</p>}>
        <LibraryBody />
      </Suspense>
    </>
  );
}

async function LibraryBody() {
  const cards = await listStoredCards();
  return <LibraryBrowser cards={cards} />;
}
