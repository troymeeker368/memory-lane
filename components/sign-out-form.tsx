import { signOutAction } from "@/app/actions";
import { Button } from "@/components/ui/button";

export function SignOutForm() {
  return (
    <form action={signOutAction}>
      <Button type="submit" className="w-full bg-[#8099B6] text-white hover:opacity-95">
        Sign Out
      </Button>
    </form>
  );
}
