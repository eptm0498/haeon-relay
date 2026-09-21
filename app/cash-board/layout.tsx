import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CASH BOARD",
  description: "Cash balance and keep management",
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
