import { PreferencesForm } from "@/components/settings/preferences-form";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
        <p className="mt-2 text-muted-foreground">
          Configure your account and podcast preferences.
        </p>
      </div>
      <PreferencesForm />
    </div>
  );
}
