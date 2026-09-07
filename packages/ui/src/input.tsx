import type { InputHTMLAttributes } from "react";
import { cn } from "./cn";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 shadow-xs transition-colors",
        "placeholder:text-zinc-400 hover:border-zinc-400",
        "focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none",
        "dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:hover:border-zinc-600 dark:focus:border-blue-500",
        className,
      )}
      {...props}
    />
  );
}
