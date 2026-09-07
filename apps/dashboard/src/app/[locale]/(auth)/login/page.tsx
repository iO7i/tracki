import { AuthFooterLink } from "@/components/auth-footer-link";
import { LoginForm } from "@/components/auth-forms";
import { safeNextPath } from "@/lib/action-state";
import { Card, CardContent, CardHeader, CardTitle } from "@tracki/ui";
import { getTranslations } from "next-intl/server";

export default async function LoginPage({
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
        <CardTitle>{t("loginTitle")}</CardTitle>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{t("loginSubtitle")}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <LoginForm locale={locale} next={next} />
        <AuthFooterLink
          prompt={t("noAccount")}
          linkLabel={t("signupLink")}
          pathname="/signup"
          next={next}
        />
      </CardContent>
    </Card>
  );
}
