import type { Metadata } from "next";
import CharacterEditor from "./CharacterEditor";

export const metadata: Metadata = {
  title: "캐릭터 설정실 · 캐릭터라이브",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <CharacterEditor token={token} />;
}

