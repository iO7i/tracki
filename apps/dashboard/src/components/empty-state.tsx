import { Badge, Card, CardContent } from "@tracki/ui";

export function EmptyState({
  title,
  description,
  badge,
}: {
  title: string;
  description: string;
  badge?: string;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="max-w-md text-sm text-zinc-500 dark:text-zinc-400">{description}</p>
        {badge ? <Badge tone="warning">{badge}</Badge> : null}
      </CardContent>
    </Card>
  );
}
