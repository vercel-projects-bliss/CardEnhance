import { SectionLabel } from "@/components/section-label";

type PageHeaderProps = {
  index?: string;
  title: string;
  description: string;
};

export function PageHeader({ index, title, description }: PageHeaderProps) {
  return (
    <header className="mb-6 max-w-3xl">
      {index ? <SectionLabel index={index}>{title.toUpperCase()}</SectionLabel> : null}
      <h1 className="glow-text mt-2 text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">{description}</p>
    </header>
  );
}
