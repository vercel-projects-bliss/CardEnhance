import type { Metadata } from "next";
import { CardThumbnailGrid } from "@/components/card-thumbnail-grid";
import { PageHeader } from "@/components/page-header";

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
      <CardThumbnailGrid
        label="Library"
        message="No cards in the library yet. Thumbnails will appear in this grid when cards are added."
        count={10}
      />
    </>
  );
}
