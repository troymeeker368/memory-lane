import Link from "next/link";

type CarePlanStatusLinkProps = {
  status: string;
  href: string;
};

export function CarePlanStatusLink({ status, href }: CarePlanStatusLinkProps) {
  if (status === "Due Soon" || status === "Overdue") {
    return (
      <Link className="font-semibold text-brand underline" href={href}>
        {status}
      </Link>
    );
  }

  return <span>{status}</span>;
}
