// The brand logo (CA Parveen Sharma), hardcoded from the trimmed Canva export.
// Two versions swap by theme (CSS .logo-on-dark / .logo-on-light): a white-text
// version on dark backgrounds, the normal black-text version on light.
export default function Logo() {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-cps-dark.png" alt="CA Parveen Sharma" className="brand-logo logo-on-dark" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-cps.png" alt="CA Parveen Sharma" className="brand-logo logo-on-light" />
    </>
  );
}
