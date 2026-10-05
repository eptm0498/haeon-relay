import type { Metadata, Viewport } from "next";
export const metadata: Metadata = {
  title: "도경LIVE", description: "캐릭터와 문자 또는 음성으로 대화하기", applicationName: "도경LIVE",
  appleWebApp: { capable: true, statusBarStyle: "black", title: "도경LIVE" },
  manifest: "/dokyeong-live.webmanifest",
};
export const viewport: Viewport = { themeColor: "#111111", width: "device-width", initialScale: 1, viewportFit: "cover" };
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
