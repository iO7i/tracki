import { AuthFooterLink } from "@/components/auth-footer-link";
import { SignupForm } from "@/components/auth-forms";
import { safeNextPath } from "@/lib/action-state";
import { Card, CardContent, CardHeader, CardTitle } from "@tracki/ui";
import { getTranslations } from "next-intl/server";

export default async function SignupPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { locale } = await params;
  const next = safeNextPath((await searchParams).next) ?? undefined;
  const t = await getTranslations("auth");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("signupTitle")}</CardTitle>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{t("signupSubtitle")}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <SignupForm locale={locale} next={next} />
        <AuthFooterLink
          prompt={t("haveAccount")}
          linkLabel={t("loginLink")}
          pathname="/login"
          next={next}
        />
      </CardContent>
    </Card>
  );
}
