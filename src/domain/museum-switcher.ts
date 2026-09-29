export interface SwitcherMuseum {
  id: string;
  name: string;
  role: "owner" | "collaborator";
}

export function currentSwitcherMuseum(
  museums: SwitcherMuseum[],
  pathname: string,
  selectedId?: string | null,
) {
  const prefix = "/account/museums/";
  if (pathname.startsWith(prefix)) {
    const id = pathname.slice(prefix.length).split("/")[0];
    return museums.find((museum) => museum.id === id) ?? null;
  }
  if (selectedId != null) return museums.find((museum) => museum.id === selectedId) ?? null;
  return museums.find((museum) => museum.role === "owner") ?? null;
}
