import PortalHeader from "@/app/components/PortalHeader";
import PortalFooter from "@/app/components/PortalFooter";

export const dynamic = "force-dynamic";

export default function LearnLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PortalHeader />
      {children}
      <PortalFooter />
    </>
  );
}
