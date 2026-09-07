import {
  ChatIcon,
  RouteIcon,
  SparklesIcon,
  UsersIcon,
  WhatsappIcon,
} from "@/components/landing-icons";
import { ProductPage } from "@/components/marketing/product-page";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("mkt.connect");
  return { title: `${t("name")} — Tracki` };
}

export default function ConnectProductPage() {
  return (
    <ProductPage
      ns="connect"
      Icon={WhatsappIcon}
      featureIcons={[ChatIcon, UsersIcon, SparklesIcon, RouteIcon]}
      siblings={["agent", "voc", "web"]}
      metrics
    />
  );
}
