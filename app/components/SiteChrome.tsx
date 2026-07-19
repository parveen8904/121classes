"use client";

import { usePathname } from "next/navigation";

// ONE consistent header + footer across every page of the site.
// Public pages get the marketing SiteNav + SiteFooter (passed in as server-
// rendered slots); portal areas keep their own PortalHeader (rendered by their
// segment layouts) so we skip the marketing chrome there.
const PORTAL_PREFIXES = [
  "/dashboard", "/learn", "/admin", "/examiner", "/inbox", "/planner",
  "/live", "/discuss", "/community", "/amendments", "/career",
];

export default function SiteChrome({
  nav,
  footer,
  children,
}: {
  nav: React.ReactNode;
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "/";
  const isPortal = PORTAL_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
  if (isPortal) return <>{children}</>;
  return (
    <>
      {nav}
      {children}
      {footer}
    </>
  );
}
