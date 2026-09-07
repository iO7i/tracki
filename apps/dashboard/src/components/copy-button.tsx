"use client";

import { Button } from "@tracki/ui";
import { useTranslations } from "next-intl";
import { useState } from "react";

export function CopyButton({ text, label }: { text: string; label?: string }) {
  const t = useTranslations("common");
  const [copied, setCopied] = useState(false);

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? t("copied") : (label ?? t("copy"))}
    </Button>
  );
}
