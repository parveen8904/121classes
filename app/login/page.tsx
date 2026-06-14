import { Suspense } from "react";
import LoginForm from "./login-form";

// Render at request time (never statically pre-render this auth page at build).
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
