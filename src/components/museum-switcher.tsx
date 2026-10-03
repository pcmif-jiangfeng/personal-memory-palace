"use client";

import { usePathname } from "next/navigation";
import { currentSwitcherMuseum, type SwitcherMuseum } from "@/domain/museum-switcher";
import "@/styles/museum-switcher.css";

export function MuseumSwitcher({
  museums,
  selectedMuseumId,
}: {
  museums: SwitcherMuseum[];
  selectedMuseumId?: string | null;
}) {
  const pathname = usePathname();
  const contentRoute =
    pathname === "/" ||
    ["/workspace", "/stages", "/memories", "/search", "/trash"].some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
  if ((!pathname.startsWith("/account") && !contentRoute) || museums.length === 0) return null;
  const current = currentSwitcherMuseum(museums, pathname, selectedMuseumId);
  return (
    <label className="museum-switcher">
      <span>当前宫殿</span>
      <select
        aria-label="切换宫殿"
        value={current?.id ?? ""}
        onChange={(event) => {
          const selected = museums.find((museum) => museum.id === event.target.value);
          if (!selected) return;
          // Reload metadata so revoked relationships never become a remembered selection.
          const destination = new URL(
            pathname.startsWith("/account") ? "/account" : "/",
            window.location.origin,
          );
          destination.searchParams.set("museumId", selected.id);
          window.location.assign(destination.href);
        }}
      >
        {!current ? (
          <option value="" disabled>
            当前宫殿不可用
          </option>
        ) : null}
        {museums.map((museum) => (
          <option key={museum.id} value={museum.id}>
            {museum.name} · {museum.museumType === "private" ? "私人宫殿" : "共同宫殿"} ·{" "}
            {museum.role === "owner" ? "馆长" : "协作者"}
          </option>
        ))}
      </select>
    </label>
  );
}
