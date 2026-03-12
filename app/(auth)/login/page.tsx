import { LoginForm } from "@/components/login-form";
import { Card } from "@/components/ui/card";

function getAuthIssueMessage(reason: string | undefined) {
  if (reason === "no-auth-user") {
    return "No authenticated user session was found. Please sign in.";
  }

  if (reason === "no-linked-profile") {
    return "You are authenticated, but no linked profile row exists in public.profiles for this user.";
  }

  if (reason === "inactive-profile") {
    return "Your linked profile exists but is marked inactive. Contact an administrator.";
  }

  return null;
}

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const params = await searchParams;
  const authIssueMessage = getAuthIssueMessage(params.reason);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-4">
      <Card className="w-full bg-white">
        <h1 className="text-xl font-bold">Memory Lane Staff Login</h1>
        <p className="mt-1 text-sm text-muted">Town Square Fort Mill</p>
        {authIssueMessage ? <p className="mt-3 text-sm text-danger">{authIssueMessage}</p> : null}
        <div className="mt-5">
          <LoginForm />
        </div>
      </Card>
    </main>
  );
}
