import { Link } from "@/i18n/navigation";

export function AuthFooterLink({
  prompt,
  linkLabel,
  pathname,
  next,
}: {
  prompt: string;
  linkLabel: string;
  pathname: "/login" | "/signup";
  next?: string;
}) {
  return (
    <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">
      {prompt}{" "}
      <Link
        href={next ? { pathname, query: { next } } : pathname}
        className="font-medium text-blue-600 hover:underline dark:text-blue-400"
      >
        {linkLabel}
      </Link>
    </p>
  );
}
