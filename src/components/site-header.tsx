"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isNavigationItemActive } from "@/components/site-navigation";
import { copy } from "@/i18n/zh-CN";

const ownerNavigationItems = [
  { href: "/", label: copy.nav.gallery, marker: "◇" },
  { href: "/workspace", label: copy.nav.workspace, marker: "▦" },
  { href: "/stages", label: copy.nav.stages, marker: "Ⅱ" },
  { href: "/search", label: copy.nav.search, marker: "⌕" },
  { href: "/trash", label: copy.nav.trash, marker: "○" },
] as const;

const visitorNavigationItems = [
  { href: "/", label: copy.nav.gallery, marker: "◇" },
  { href: "/stages", label: copy.nav.stages, marker: "Ⅱ" },
  { href: "/search", label: copy.nav.search, marker: "⌕" },
  { href: "/login", label: "馆长登录", marker: "○" },
] as const;

export function SiteHeader({ owner }: { owner: boolean }) {
  const pathname = usePathname();
  const navigationItems = owner ? ownerNavigationItems : visitorNavigationItems;
  return (
    <header className="site-header">
      <Link className="brand" href="/">
        {copy.brand}
      </Link>
      <nav aria-label={copy.common.mainNavigation}>
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
