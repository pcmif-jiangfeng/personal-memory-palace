"use client";

import { usePathname } from "next/navigation";
import { currentSwitcherMuseum, type SwitcherMuseum } from "@/domain/museum-switcher";
import "@/styles/museum-switcher.css";

export function MuseumSwitcher({ museums }: { museums: SwitcherMuseum[] }) {
  const pathname = usePathname();
  // Legacy exhibition routes are not Museum-scoped until Phase F.
  if (!pathname.startsWith("/account") || museums.length === 0) return null;
  const current = currentSwitcherMuseum(museums, pathname);
  return (
    <label className="museum-switcher">
      <span>当前 Museum</span>
      <select
        aria-label="切换 Museum"
        value={current?.id ?? ""}
        onChange={(event) => {
          const selected = museums.find((museum) => museum.id === event.target.value);
          if (!selected) return;
          // Reload metadata so revoked relationships never become a remembered selection.
          window.location.assign(
            selected.role === "owner" ? "/account" : `/account/museums/${selected.id}`,
          );
        }}
      >
        {!current ? (
          <option value="" disabled>
            当前 Museum 不可用
          </option>
        ) : null}
        {museums.map((museum) => (
          <option key={museum.id} value={museum.id}>
            {museum.name} · {museum.role === "owner" ? "我的 Museum" : "协作者"}
          </option>
        ))}
      </select>
    </label>
  );
}
