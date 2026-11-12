import type { Metadata } from "next";
import { StudioView } from "@/components/studio/studio-view";

export const metadata: Metadata = {
  title: "Studio",
};

export default function StudioPage() {
  return <StudioView />;
}
