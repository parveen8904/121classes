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
          background: "#0d9488",
          color: "#fff",
          fontSize: 88,
          fontWeight: 800,
        }}
      >
        121
      </div>
    ),
    { ...size },
  );
}
