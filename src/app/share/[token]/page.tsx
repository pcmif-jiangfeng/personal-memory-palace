import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getSharedMemory, shareTokenExists } from "@/data/share-repository";
import { ShareAccess } from "@/components/share-access";
import { MemoryExhibition } from "@/components/memory-exhibition";

export const dynamic = "force-dynamic";
export default async function SharedMemoryPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params; const configCookie = (await cookies()).get(`memory_palace_share_${token}`); const memory = getSharedMemory(token, undefined, configCookie?.value);
  if (!shareTokenExists(token)) notFound();
  if (memory) return <MemoryExhibition memory={memory} visitor />;
  if (!configCookie) return <section className="section-shell skeleton-page"><div className="login-panel"><p className="eyebrow">VISITOR ACCESS</p><h1>一场私人展览</h1><p>这场展览需要访问密码。</p><ShareAccess token={token} /></div></section>;
  notFound();
}
