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
        <input name="q" defaultValue={q} placeholder={copy.search.placeholder} />
        <button className="button-primary">{copy.search.submit}</button>
      </form>
      {q ? (
        <>
          <p className="search-result-label">{copy.search.result(q, memories.length)}</p>
          <div className="memory-grid">
            {memories.map((memory) => (
              <MemoryCard key={memory.id} memory={memory} />
            ))}
          </div>
          {memories.length === 0 ? <p className="empty-state">{copy.search.empty}</p> : null}
        </>
      ) : (
        <p className="quiet-empty">{copy.search.prompt}</p>
      )}
    </section>
  );
}
