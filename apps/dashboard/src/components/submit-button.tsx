"use client";

import { Button, type ButtonProps } from "@tracki/ui";
import { useFormStatus } from "react-dom";

export function SubmitButton({ children, ...props }: ButtonProps) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} aria-busy={pending} {...props}>
      {children}
    </Button>
  );
}
