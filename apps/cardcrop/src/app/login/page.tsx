import { Suspense } from "react";
import { LoginPanel } from "@/components/login-panel";

export default function LoginPage() {
  return (
    <Suspense fallback={<p className="main">Loading sign-in…</p>}>
      <LoginPanel />
    </Suspense>
  );
}
