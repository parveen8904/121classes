import SiteNav from "@/app/components/SiteNav";
import SiteFooter from "@/app/components/SiteFooter";

export const dynamic = "force-dynamic";

export default function CoursesLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteNav />
      {children}
      <SiteFooter />
    </>
  );
}
