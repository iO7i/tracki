import {
  ActivityIcon,
  ChartIcon,
  MobileIcon,
  ShieldIcon,
  SparklesIcon,
} from "@/components/landing-icons";
import { ProductPage } from "@/components/marketing/product-page";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("mkt.mobile");
  return { title: `${t("name")} — Tracki` };
}

export default function MobileProductPage() {
  return (
    <ProductPage
      ns="mobile"
      Icon={MobileIcon}
      featureIcons={[ActivityIcon, SparklesIcon, ChartIcon, ShieldIcon]}
      siblings={["web", "connect", "agent"]}
    />
  );
}
