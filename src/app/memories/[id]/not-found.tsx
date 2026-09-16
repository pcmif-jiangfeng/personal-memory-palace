import Link from "next/link";
import { copy } from "@/i18n/zh-CN";

export default function MemoryNotFound() {
  return <section className="section-shell skeleton-page"><h1>{copy.common.notFound}</h1><Link className="text-link" href="/">返回人生长廊</Link></section>;
}
