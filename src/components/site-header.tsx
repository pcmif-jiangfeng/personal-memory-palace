"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isNavigationItemActive } from "@/components/site-navigation";
import { copy } from "@/i18n/zh-CN";

const navigationItems = [
  { href: "/", label: copy.nav.gallery, marker: "◇" },
  { href: "/workspace", label: copy.nav.workspace, marker: "▦" },
  { href: "/stages", label: copy.nav.stages, marker: "Ⅱ" },
  { href: "/search", label: copy.nav.search, marker: "⌕" },
  { href: "/trash", label: copy.nav.trash, marker: "○" },
] as const;

export function SiteHeader() {
  const pathname = usePathname();
  return (
    <header className="site-header">
      <Link className="brand" href="/">
        {copy.brand}
      </Link>
      <nav aria-label="主导航">
        {navigationItems.map((item) => {
          const active = isNavigationItemActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              className={active ? "is-active" : undefined}
              href={item.href}
              aria-current={active ? "page" : undefined}
            >
              <span className="site-nav-marker" aria-hidden="true">
                {item.marker}
              </span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
