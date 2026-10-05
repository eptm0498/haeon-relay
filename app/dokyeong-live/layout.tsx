import type { Metadata, Viewport } from "next";
export const metadata: Metadata = {
  title: "캐릭터라이브", description: "캐릭터와 문자 또는 음성으로 대화하기", applicationName: "캐릭터라이브",
  appleWebApp: { capable: true, statusBarStyle: "black", title: "캐릭터라이브" },
  manifest: "/dokyeong-live.webmanifest",
};
export const viewport: Viewport = { themeColor: "#111111", width: "device-width", initialScale: 1, viewportFit: "cover" };
export default function Layout({ children }: { children: React.ReactNode }) { return children; }

