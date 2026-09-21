import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "캐시 보드",
  description: "캐시와 킵 관리",
  robots: {
    index: false,
    follow: false,
  },
};

export default function CashBoardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
