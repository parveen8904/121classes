// The brand logo (CA Parveen Sharma) — hardcoded from the trimmed Canva export
// at /public/logo-cps.png, so it shows consistently everywhere.
export default function Logo() {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/logo-cps.png" alt="CA Parveen Sharma" className="brand-logo" />;
}
