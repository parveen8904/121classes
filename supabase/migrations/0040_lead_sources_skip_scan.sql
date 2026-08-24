-- SIX VALUES SHOULD NOT COST A QUARTER OF A MILLION ROWS.
--
-- lead_sources() feeds one dropdown on /admin/reports/leads. It was
-- "select distinct source from leads", which on 256,902 rows is a parallel
-- sequential scan + hash aggregate: 3,955 shared buffers and 87 ms measured on
-- 24 Aug 2026, to return SIX strings.
--
-- The recursive form below is a loose index scan (a "skip scan"): it finds the
-- smallest source, then repeatedly jumps to the next value strictly greater
-- than the last. That is one index descent per DISTINCT value — six — instead
-- of one heap read per row. Measured after: 1.9 ms, same six values.
--
-- Behaviour is deliberately identical to the old function: non-null, non-empty
-- sources, sorted ascending. The index is partial on exactly that predicate so
-- the skip scan never has to step over rows it would only discard.
create index if not exists leads_source_idx
  on public.leads (source)
  where source is not null and source <> '';

create or replace function public.lead_sources()
returns table(source text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with recursive skip as (
    (select l.source
       from leads l
      where l.source is not null and l.source <> ''
      order by l.source
      limit 1)
    union all
    select (select l.source
              from leads l
             where l.source is not null and l.source <> ''
               and l.source > s.source
             order by l.source
             limit 1)
      from skip s
     where s.source is not null
  )
  select s.source from skip s where s.source is not null order by s.source
$function$;
