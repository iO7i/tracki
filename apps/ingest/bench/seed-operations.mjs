import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL ?? "postgres://tracki:tracki@localhost:5432/tracki");
const tenants = [
  { slug: "ops-a", name: "Operations A", key: "pk_ops_a" },
  { slug: "ops-b", name: "Operations B", key: "pk_ops_b" },
];

try {
  const projects = [];
  for (const tenant of tenants) {
    const [org] = await sql`
      INSERT INTO organizations (name, slug)
      VALUES (${tenant.name}, ${tenant.slug})
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
      RETURNING id, slug`;
    const [project] = await sql`
      INSERT INTO projects (org_id, name, slug, public_key)
      VALUES (${org.id}, ${tenant.name}, 'benchmark', ${tenant.key})
      ON CONFLICT (org_id, slug) DO UPDATE SET public_key = EXCLUDED.public_key
      RETURNING id, org_id, public_key`;
    projects.push({ orgId: org.id, projectId: project.id, publicKey: project.public_key });
  }
  console.log(JSON.stringify({ status: "seeded", projects }, null, 2));
} finally {
  await sql.end();
}
