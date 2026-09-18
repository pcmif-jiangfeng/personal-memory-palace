export function isNavigationItemActive(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/" || pathname === "/memories" || pathname.startsWith("/memories/");
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}
