export interface SwitcherMuseum {
  id: string;
  name: string;
  role: "owner" | "collaborator";
}

export function currentSwitcherMuseum(museums: SwitcherMuseum[], pathname: string) {
  const prefix = "/account/museums/";
  if (pathname.startsWith(prefix)) {
    const id = pathname.slice(prefix.length).split("/")[0];
    return museums.find((museum) => museum.id === id) ?? null;
  }
  return museums.find((museum) => museum.role === "owner") ?? null;
}
