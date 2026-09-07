import { updateRevenueSettingsAction } from "@/lib/actions/revenue";
import { CURRENCIES } from "@tracki/shared";
import { Button, Input, Label } from "@tracki/ui";
import { getTranslations } from "next-intl/server";

const fieldCls =
  "h-9 w-full rounded-lg border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";

/** MANAGER-only: set currency / average order value / conversion event. */
export async function RevenueSettingsForm({
  locale,
  orgSlug,
  projectSlug,
  currency,
  avgOrderValue,
  conversionEvent,
}: {
  locale: string;
  orgSlug: string;
  projectSlug: string;
  currency: string;
  avgOrderValue: number;
  conversionEvent: string;
}) {
  const t = await getTranslations("revenue");
  return (
    <form action={updateRevenueSettingsAction} className="grid items-end gap-4 sm:grid-cols-4">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <input type="hidden" name="projectSlug" value={projectSlug} />

      <div className="space-y-1.5">
        <Label>{t("currency")}</Label>
        <select name="currency" defaultValue={currency} className={fieldCls}>
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="aov">{t("aov")}</Label>
        <Input
          id="aov"
          name="avgOrderValue"
          type="number"
          min={0}
          defaultValue={avgOrderValue}
          dir="ltr"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="conv">{t("conversionEvent")}</Label>
        <Input id="conv" name="conversionEvent" defaultValue={conversionEvent} dir="ltr" />
      </div>

      <Button type="submit">{t("saveSettings")}</Button>
    </form>
  );
}
