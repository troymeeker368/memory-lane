import { LoginForm } from "@/components/login-form";
import { Card } from "@/components/ui/card";

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-4">
      <Card className="w-full bg-white">
        <h1 className="text-xl font-bold">Memory Lane Staff Login</h1>
        <p className="mt-1 text-sm text-muted">Town Square Fort Mill</p>
        <div className="mt-5">
          <LoginForm />
        </div>
      </Card>
    </main>
  );
}
