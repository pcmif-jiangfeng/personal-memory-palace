"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { accountDisplayLabel } from "@/domain/user-profile";
import { UserLogoutButton } from "@/components/user-logout-button";
import { copy } from "@/i18n/zh-CN";

export function AccountMenu({
  user,
  museumId,
}: {
  user: { displayName: string; email: string };
  museumId?: string | null;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const label = accountDisplayLabel(user);
  useEffect(() => {
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !menu.current?.contains(event.target) && menu.current)
        menu.current.open = false;
    }
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);
  return (
    <details
      className="account-menu"
      ref={menu}
      onKeyDown={(event) => {
        if (event.key === "Escape" && menu.current) {
          menu.current.open = false;
          menu.current.querySelector("summary")?.focus();
        }
      }}
    >
      <summary title={label}>
        <span>{label}</span>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none">
          <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </summary>
      <div className="account-menu-panel">
        <Link
          href={museumId ? `/account?museumId=${encodeURIComponent(museumId)}` : "/account"}
          prefetch={false}
          onClick={() => {
            if (menu.current) menu.current.open = false;
          }}
        >
          宫殿设置
        </Link>
        <Link
          href="/account/settings"
          prefetch={false}
          onClick={() => {
            if (menu.current) menu.current.open = false;
          }}
        >
          {copy.account.title}
        </Link>
        <UserLogoutButton label={copy.account.logout} className="text-button" />
        <Link
          href="/account/invites"
          prefetch={false}
          onClick={() => {
            if (menu.current) menu.current.open = false;
          }}
        >
          收到的邀请
        </Link>
      </div>
    </details>
  );
}
