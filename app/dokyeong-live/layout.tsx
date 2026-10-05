import type { Metadata, Viewport } from "next";
export const metadata: Metadata = {
  title: "LIVE", description: "캐릭터와 문자 또는 음성으로 대화하기", applicationName: "LIVE",
  appleWebApp: { capable: true, statusBarStyle: "black", title: "LIVE" },
  manifest: "/dokyeong-live.webmanifest",
  icons:{icon:"/live-chat-icon-192.png",apple:"/live-chat-icon-180.png"},
  other: { google: "notranslate" },
};
export const viewport: Viewport = { themeColor: "#111111", width: "device-width", initialScale: 1, viewportFit: "cover" };
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
