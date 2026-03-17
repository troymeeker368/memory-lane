import { Button } from "@/components/ui/button";

export function SignOutForm() {
  return (
    <form method="post" action="/auth/signout">
      <Button type="submit" className="w-full bg-[#8099B6] text-white hover:opacity-95">
        Sign Out
      </Button>
    </form>
  );
}
