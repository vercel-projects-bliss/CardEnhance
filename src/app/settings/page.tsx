import type { Metadata } from "next";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = {
  title: "Settings",
};

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Settings"
        description="Preferences for this app will appear here."
      />
      <EmptyState
        title="No settings yet"
        description="Options will be listed here in a later step."
      />
    </>
  );
}
