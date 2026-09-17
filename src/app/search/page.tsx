import { PageIntro } from "@/components/page-intro";
import { copy } from "@/i18n/zh-CN";
import { searchActiveMemories } from "@/data/memory-repository";
import { MemoryCard } from "@/components/memory-card";
import { isOwner } from "@/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  if (!(await isOwner())) redirect("/login");
  const q = (await searchParams).q?.trim() ?? "";
  const memories = q ? searchActiveMemories(q) : [];
  return (
    <section className="section-shell skeleton-page">
      <PageIntro title={copy.search.title} description={copy.search.description} />
      <form className="search-form" action="/search">
        <input name="q" defaultValue={q} placeholder="搜索标题或 Story" />
        <button className="button-primary">搜索</button>
      </form>
      {q ? (
        <>
          <p className="search-result-label">
            “{q}” 找到 {memories.length} 段记忆
          </p>
          <div className="memory-grid">
            {memories.map((memory) => (
              <MemoryCard key={memory.id} memory={memory} />
            ))}
          </div>
          {memories.length === 0 ? <p className="empty-state">没有找到匹配的 Memory。</p> : null}
        </>
      ) : (
        <p className="quiet-empty">输入关键词，寻找标题或 Story 中出现过的片段。</p>
      )}
    </section>
  );
}
