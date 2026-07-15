-- Public articles & notes: the SEO engine. AI writes ORIGINAL educational
-- articles (never copied from the web) from a seeded topic queue; they publish
-- at /articles/[slug] with schema markup and appear in the sitemap.

create table if not exists public.articles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  description text,
  body_md text not null,
  category text,                        -- fr | advanced-accounting | strategy | career
  keywords text,
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists articles_pub_idx on public.articles(is_published, created_at desc);

-- The generation queue: one row per planned article.
create table if not exists public.article_topics (
  id uuid primary key default gen_random_uuid(),
  topic text not null,
  category text,
  keywords text,
  status text not null default 'pending',    -- pending | done | failed
  article_id uuid references public.articles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists article_topics_status_idx on public.article_topics(status);

-- Server-rendered only (service client); deny-all like other content tables.
alter table public.articles enable row level security;
alter table public.article_topics enable row level security;
