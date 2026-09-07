import { CopyButton } from "@/components/copy-button";
import { PageHeader } from "@/components/page-header";
import { VolumeChart } from "@/components/volume-chart";
import { requireProject } from "@/lib/tenancy";
import { Card, CardContent, CardHeader, CardTitle } from "@tracki/ui";
import { getFormatter, getTranslations } from "next-intl/server";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ locale: string; orgSlug: string; projectSlug: string }>;
}) {
  const { locale, orgSlug, projectSlug } = await params;
  const { org, project } = await requireProject(locale, orgSlug, projectSlug);
  const t = await getTranslations("project");
  const tChart = await getTranslations("chart");
  const format = await getFormatter();

  const snippetUrl = process.env.NEXT_PUBLIC_SNIPPET_URL ?? "https://cdn.tracki.app/tracki.js";
  const snippetTag = `<script async src="${snippetUrl}" data-key="${project.publicKey}"></script>`;

  return (
    <div className="space-y-6">
      <PageHeader
        title={project.name}
        subtitle={`${t("createdAt")}: ${format.dateTime(project.createdAt, { dateStyle: "medium" })}`}
      />

      <Card>
        <CardHeader>
          <CardTitle>{t("snippetTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("snippetHelp")}</p>
          {/* Code is always LTR, regardless of UI locale. */}
          <pre
            dir="ltr"
            className="overflow-x-auto rounded-lg bg-zinc-100 p-4 text-xs dark:bg-zinc-800"
          >
            <code>{snippetTag}</code>
          </pre>
          <div className="flex items-center gap-3">
            <CopyButton text={snippetTag} />
            <span className="text-xs text-zinc-500 dark:text-zinc-400" dir="ltr">
              {t("keyLabel")}: {project.publicKey}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{tChart("title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <VolumeChart orgId={org.id} projectId={project.id} />
        </CardContent>
      </Card>
    </div>
  );
}
