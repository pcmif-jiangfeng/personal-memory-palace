"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { isNavigationItemActive } from "@/components/site-navigation";
import { publicSiteUrl } from "@/domain/share-links";
import { copy } from "@/i18n/zh-CN";
import { MuseumSwitcher } from "@/components/museum-switcher";
import type { SwitcherMuseum } from "@/domain/museum-switcher";

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

export function SiteHeader({
  owner,
  museums = [],
}: {
  owner: boolean;
  museums?: SwitcherMuseum[];
}) {
  const pathname = usePathname();
  const museumId = useSearchParams().get("museumId");
  const member = museums.length > 0;
  const navigationItems = member || owner ? ownerNavigationItems : visitorNavigationItems;
  const scopedHref = (href: string) =>
    member && museumId ? `${href}?museumId=${encodeURIComponent(museumId)}` : href;
  const [shareMessage, setShareMessage] = useState("");
  const [manualCopy, setManualCopy] = useState(false);

  async function shareSite() {
    try {
      await navigator.clipboard.writeText(publicSiteUrl);
      setManualCopy(false);
      setShareMessage("网站链接已复制，可以直接发送给访客。");
    } catch {
      setManualCopy(true);
      setShareMessage("自动复制失败，请手动复制下面的网址。");
    }
  }

  return (
    <header className="site-header">
      <Link className="brand" href={scopedHref("/")}>
        {copy.brand}
      </Link>
      <MuseumSwitcher museums={museums} />
      <nav aria-label={copy.common.mainNavigation}>
        <button className="site-share-button" type="button" onClick={() => void shareSite()}>
          <span className="site-nav-marker" aria-hidden="true">
            ↗
          </span>
          <span>分享网站</span>
        </button>
        {navigationItems.map((item) => {
          const active = isNavigationItemActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              className={active ? "is-active" : undefined}
              href={scopedHref(item.href)}
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
      {shareMessage ? (
        <div className="site-share-feedback" role="status">
          <span>{shareMessage}</span>
          {manualCopy ? (
            <input
              aria-label="网站网址"
              readOnly
              value={publicSiteUrl}
              onFocus={(event) => event.currentTarget.select()}
            />
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
