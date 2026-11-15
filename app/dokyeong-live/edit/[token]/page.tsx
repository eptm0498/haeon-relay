import type { Metadata } from "next";
import { verifyEditor } from "@/lib/dokyeong/settings";
import CharacterEditor from "./CharacterEditor";
import styles from "./editor.module.css";

export const preferredRegion = "sin1";

export const metadata: Metadata = {
  title: "캐릭터 설정실 · 카카오톡",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const access = await verifyEditor(token).catch(() => null);
  if (!access) {
    return (
      <main className={styles.centerState}>
        <h1>캐릭터 설정실</h1>
        <p role="alert">{access === null ? "설정실 연결이 잠시 끊겼어. 새로고침해서 다시 시도해 줘." : "편집 링크를 확인해 줘."}</p>
      </main>
    );
  }
  return <CharacterEditor token={token} />;
}

