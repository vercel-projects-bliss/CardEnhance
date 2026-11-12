import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { StudioView } from "@/components/studio/studio-view";

export const metadata: Metadata = {
  title: "Studio",
};

export default function StudioPage() {
  return (
    <>
      <PageHeader
        title="Studio"
        description="Upload scans, then crop, rectify, read, restore, and export a batch."
      />
      <StudioView />
    </>
  );
}
