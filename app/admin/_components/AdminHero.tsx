import Link from "next/link";

// Consistent branded page header for admin pages.
export default function AdminHero({
  badge,
  title,
  subtitle,
  back,
}: {
  badge: string;
  title: string;
  subtitle?: string;
  back?: { href: string; label: string };
}) {
  return (
    <>
      {back && (
        <p className="crumb">
          <Link href={back.href}>← {back.label}</Link>
        </p>
      )}
      <div className="learn-hero">
        <span className="badge">{badge}</span>
        <h1>{title}</h1>
        {subtitle && <p className="meta">{subtitle}</p>}
      </div>
    </>
  );
}
