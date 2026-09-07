import {
  ActivityIcon,
  ChatIcon,
  GlobeIcon,
  ShieldIcon,
  SparklesIcon,
} from "@/components/landing-icons";
import { ProductPage } from "@/components/marketing/product-page";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("mkt.agent");
  return { title: `${t("name")} — Tracki` };
}

export default function AgentProductPage() {
  return (
    <ProductPage
      ns="agent"
      Icon={ChatIcon}
      featureIcons={[SparklesIcon, ActivityIcon, GlobeIcon, ShieldIcon]}
      siblings={["knowledge", "connect", "web"]}
    />
  );
}
