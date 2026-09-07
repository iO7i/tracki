import { BookIcon, GlobeIcon, LightbulbIcon, SparklesIcon } from "@/components/landing-icons";
import { ProductPage } from "@/components/marketing/product-page";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("mkt.knowledge");
  return { title: `${t("name")} — Tracki` };
}

export default function KnowledgeProductPage() {
  return (
    <ProductPage
      ns="knowledge"
      Icon={BookIcon}
      featureIcons={[BookIcon, GlobeIcon, LightbulbIcon, SparklesIcon]}
      siblings={["agent", "voc", "web"]}
    />
  );
}
