import type {Metadata} from 'next';
import './style.css';
export const metadata:Metadata={title:'서재 · 캐릭터 이야기',description:'개인용 캐릭터 RP 공간'};
export default function RpLayout({children}:{children:React.ReactNode}){return children}
