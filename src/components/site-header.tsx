import Link from "next/link";
import { copy } from "@/i18n/zh-CN";

export function SiteHeader() {
  return (
    <header className="site-header">
      <Link className="brand" href="/">{copy.brand}</Link>
      <nav aria-label="主导航">
        <Link href="/">{copy.nav.gallery}</Link>
        <Link href="/workspace">{copy.nav.workspace}</Link>
        <Link href="/stages">{copy.nav.stages}</Link>
        <Link href="/search">{copy.nav.search}</Link>
        <Link href="/trash">{copy.nav.trash}</Link>
      </nav>
    </header>
  );
}
