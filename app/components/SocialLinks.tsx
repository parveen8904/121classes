// Brand-accurate social icons (correct colours + official glyphs) for the footer.
type Props = { youtube?: string; instagram?: string; twitter?: string; facebook?: string; size?: number };

const YouTube = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="#fff" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
);
const Instagram = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#fff" strokeWidth="2" aria-hidden="true">
    <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
    <circle cx="12" cy="12" r="3.6" />
    <circle cx="17.4" cy="6.6" r="1.1" fill="#fff" stroke="none" />
  </svg>
);
const X = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="#fff" aria-hidden="true">
    <path d="M18.9 2H22l-7.6 8.7L23 22h-6.8l-5.3-6.9L4.8 22H1.6l8.2-9.4L1 2h7l4.8 6.3L18.9 2zm-1.2 18h1.9L7.1 4H5.1l12.6 16z" />
  </svg>
);
const Facebook = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="#fff" aria-hidden="true">
    <path d="M15 8h-2c-.6 0-1 .4-1 1v2h3l-.5 3H12v7H9v-7H7v-3h2V9a4 4 0 0 1 4-4h2v3z" />
  </svg>
);

export default function SocialLinks({ youtube, instagram, twitter, facebook, size = 34 }: Props) {
  const items = [
    { key: "YouTube", href: youtube, bg: "#FF0000", icon: YouTube },
    { key: "Instagram", href: instagram, bg: "linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)", icon: Instagram },
    { key: "X", href: twitter, bg: "#000000", icon: X },
    { key: "Facebook", href: facebook, bg: "#1877F2", icon: Facebook },
  ].filter((i) => i.href);
  if (!items.length) return null;
  return (
    <>
      {items.map((i) => (
        <a key={i.key} href={i.href} target="_blank" rel="noopener noreferrer" aria-label={i.key} title={i.key}
          style={{ width: size, height: size, borderRadius: "50%", background: i.bg, display: "inline-flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}>
          {i.icon}
        </a>
      ))}
    </>
  );
}
