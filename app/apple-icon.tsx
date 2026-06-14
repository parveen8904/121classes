import { ImageResponse } from "next/og";

// iOS home-screen icon (PNG) for the installed PWA.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg,#0d9488,#10b981)",
          color: "#fff",
          fontSize: 74,
          fontWeight: 800,
        }}
      >
        1:1
      </div>
    ),
    { ...size },
  );
}
