import type { Metadata, Viewport } from "next";
export const metadata: Metadata = {
  title: "도경LIVE", description: "도경과 음성으로 대화하기", applicationName: "도경LIVE",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "도경LIVE" },
  manifest: "/dokyeong-live.webmanifest",
};
export const viewport: Viewport = { themeColor: "#090a0d", width: "device-width", initialScale: 1, viewportFit: "cover" };
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
