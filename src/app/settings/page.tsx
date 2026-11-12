import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { SettingsForm } from "@/components/settings-form";

export const metadata: Metadata = {
  title: "Settings",
};

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        index="01"
        title="Settings"
        description="Session defaults for the batch editor inspector. Nothing here is written to the database."
      />
      <SettingsForm />
    </>
  );
}
