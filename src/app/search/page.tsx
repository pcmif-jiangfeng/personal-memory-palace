import { PageIntro } from "@/components/page-intro";
import { copy } from "@/i18n/zh-CN";
import { searchActiveMemories } from "@/data/memory-repository";
import { MemoryCard } from "@/components/memory-card";
import { memoryPageScope } from "@/memory-page-scope";
import { getDatabase } from "@/data/database";
import { listScopedMemories } from "@/data/scoped-memory";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; museumId?: string }>;
}) {
  const params = await searchParams;
  let scope;
  try {
    scope = await memoryPageScope(params.museumId);
  } catch {
    notFound();
  }
  const q = params.q?.trim() ?? "";
  const memories = q
    ? scope
      ? listScopedMemories(getDatabase(), scope, false, q)
      : searchActiveMemories(q, true)
    : [];
  return (
    <section className="section-shell skeleton-page">
      <PageIntro title={copy.search.title} description={copy.search.description} />
      <form className="search-form" action="/search">
        {scope ? <input type="hidden" name="museumId" value={scope.museumId} /> : null}
        <input name="q" defaultValue={q} placeholder={copy.search.placeholder} />
        <button className="button-primary">{copy.search.submit}</button>
      </form>
      {q ? (
        <>
          <p className="search-result-label">{copy.search.result(q, memories.length)}</p>
          <div className="memory-grid">
            {memories.map((memory) => (
              <MemoryCard key={memory.id} memory={memory} museumId={scope?.museumId} />
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
