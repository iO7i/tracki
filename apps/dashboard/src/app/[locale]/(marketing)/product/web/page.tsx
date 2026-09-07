import { AlertIcon, CursorIcon, SparklesIcon, UsersIcon } from "@/components/landing-icons";
import { ProductPage } from "@/components/marketing/product-page";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("mkt.web");
  return { title: `${t("name")} — Tracki` };
}

export default function WebProductPage() {
  return (
    <ProductPage
      ns="web"
      Icon={CursorIcon}
      featureIcons={[AlertIcon, UsersIcon, CursorIcon, SparklesIcon]}
      siblings={["agent", "connect", "platform"]}
      metrics
    />
  );
}
