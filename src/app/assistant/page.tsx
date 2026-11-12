import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { SectionLabel } from "@/components/section-label";

export const metadata: Metadata = {
  title: "Assistant",
};

const topics = [
  {
    index: "02",
    title: "CHROME / FOIL",
    body: "A specular-highlight heuristic flags scans that look like chrome or foil so descratch can be limited to those cards when the inspector checkbox is on.",
  },
  {
    index: "03",
    title: "SCRATCH REMOVAL",
    body: "Descratch median-filters thin bright and dark scanner scratches before denoise, so later smoothing does not bake the scratch into the card.",
  },
  {
    index: "04",
    title: "DENOISE",
    body: "A 3×3 box average is blended back over the original. The default is kept low (0.20) so fine print and foil texture stay intact.",
  },
  {
    index: "05",
    title: "SHARPNESS DELTA",
    body: "After an unsharp mask, the editor measures a sharpness delta against the source. Positive values show in laser green once a card has been processed.",
  },
  {
    index: "06",
    title: "RESOLUTION UPSCALE",
    body: "Scale runs from 1× to 4× (default 2×) with high-quality smoothing. The long edge is capped at 2200px. Audit records will show in→out pixel size.",
  },
] as const;

export default function AssistantPage() {
  return (
    <>
      <PageHeader
        index="01"
        title="Assistant"
        description="A restoration assistant for the batch editor’s degradation metrics. There is no chat transcript here, and no invented results."
      />

      <div className="grid gap-3 md:grid-cols-2">
        {topics.map((topic) => (
          <section key={topic.index} className="panel p-4">
            <SectionLabel index={topic.index}>{topic.title}</SectionLabel>
            <p className="mt-3 text-sm leading-relaxed text-ink-muted">{topic.body}</p>
          </section>
        ))}
      </div>
    </>
  );
}
