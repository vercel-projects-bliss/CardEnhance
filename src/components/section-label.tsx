type SectionLabelProps = {
  index: string;
  children: string;
};

export function SectionLabel({ index, children }: SectionLabelProps) {
  return (
    <p className="font-mono text-[11px] tracking-wide text-laser">
      <span>// {index}</span>
      <span className="ml-2 text-ink">{children}</span>
    </p>
  );
}
