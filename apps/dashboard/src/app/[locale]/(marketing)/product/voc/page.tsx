import {
  ActivityIcon,
  ChartIcon,
  ClipboardIcon,
  EyeOffIcon,
  SparklesIcon,
} from "@/components/landing-icons";
import { ProductPage } from "@/components/marketing/product-page";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("mkt.voc");
  return { title: `${t("name")} — Tracki` };
}

export default function VocProductPage() {
  return (
    <ProductPage
      ns="voc"
      Icon={ClipboardIcon}
      featureIcons={[EyeOffIcon, SparklesIcon, ChartIcon, ClipboardIcon]}
      siblings={["connect", "knowledge", "agent"]}
      metrics
    />
  );
}
