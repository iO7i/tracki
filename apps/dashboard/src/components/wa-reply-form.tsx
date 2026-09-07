"use client";

import { sendWaReplyAction } from "@/lib/actions/inbox";
import { Button } from "@tracki/ui";
import { useTranslations } from "next-intl";
import { useRef } from "react";
import { SubmitButton } from "./submit-button";

export function WaReplyForm({
  locale,
  orgSlug,
  projectSlug,
  conversationId,
}: {
  locale: string;
  orgSlug: string;
  projectSlug: string;
  conversationId: string;
}) {
  const t = useTranslations("inbox");
  const ref = useRef<HTMLTextAreaElement>(null);
  const canned = [t("canned1"), t("canned2"), t("canned3")];

  return (
    <form action={sendWaReplyAction} className="space-y-2">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <input type="hidden" name="projectSlug" value={projectSlug} />
      <input type="hidden" name="conversationId" value={conversationId} />
      <div className="flex flex-wrap gap-1.5">
        {canned.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => {
              if (ref.current) ref.current.value = c;
            }}
            className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"
          >
            {c}
          </button>
        ))}
      </div>
      <textarea
        ref={ref}
        name="text"
        rows={2}
        required
        placeholder={t("reply")}
        className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      />
      <SubmitButton size="sm">{t("send")}</SubmitButton>
    </form>
  );
}
