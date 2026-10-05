-- 语义检索 RPC。基于 pgvector cosine distance 对 knowledge_chunks 做 top-K 召回。
-- 被 Worker 的 onboarding 当日引导与后续知识检索使用。

create or replace function match_knowledge_chunks(
  query_embedding vector(1536),
  match_threshold float default 0.3,
  match_count int default 5
)
returns table (
  id uuid,
  document_id uuid,
  content text,
  similarity float
)
language sql stable
as $$
  select
    kc.id,
    kc.document_id,
    kc.content,
    1 - (kc.embedding <=> query_embedding) as similarity
  from knowledge_chunks kc
  where kc.embedding is not null
    and 1 - (kc.embedding <=> query_embedding) > match_threshold
  order by kc.embedding <=> query_embedding
  limit match_count;
$$;
