// READING MORE THAN A THOUSAND ROWS, AND ASKING ABOUT MORE THAN A FEW HUNDRED.
//
// PostgREST answers a plain select with at most 1,000 rows and says nothing
// about the rest. No error, no flag — just a shorter answer that looks like
// the whole truth. It has now caused four separate wrong numbers here: two
// thirds of the AI bill went missing, a class list looked complete when it was
// not, the sales report counted a thousand of 1,599 subscriptions, and the
// subscriber report left six hundred people out.
//
// The second trap is its mirror image. Collect a thousand ids and pass them to
// .in() and the query string grows past what the server will accept — roughly
// thirty-seven thousand characters for a thousand UUIDs. That request does not
// come back short; it does not come back at all, so a whole column reads as
// zero. Two students who had paid appeared to have paid nothing.
//
// Both are one-line mistakes that produce plausible answers, which is what
// makes them dangerous. These two helpers are the antidote.

type Page<T> = { data: T[] | null; error?: unknown };

/**
 * Every row, however many there are.
 *
 * Pass a function that applies `.range(from, to)` to your query. It is called
 * repeatedly until a short page arrives.
 *
 *   const all = await selectAll<Sub>((from, to) =>
 *     svc.from("subscriptions").select("id, ends_at").eq("status", "active").range(from, to));
 *
 * `cap` is a seatbelt, not a limit you should reach: it stops a runaway loop on
 * a table nobody expected to be enormous. It is generous on purpose.
 */
export async function selectAll<T>(
  page: (from: number, to: number) => PromiseLike<Page<T>>,
  { size = 1000, cap = 200_000 }: { size?: number; cap?: number } = {},
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < cap; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) {
      // A REFUSED QUERY IS NOT AN EMPTY TABLE.
      //
      // This used to break quietly and hand back whatever had been collected so
      // far, which for a failure on the first page is nothing at all. The
      // Notify page then reported nobody registered for push on either
      // platform while eleven phones sat in the table — the query had asked
      // PostgREST to embed a relationship that does not exist, and the refusal
      // read exactly like "no devices".
      //
      // Still returns what it has, because half an answer beats a crashed page.
      // But it says so, loudly, where somebody will see it.
      console.error(
        `[pageAll] selectAll failed at row ${from} after ${out.length} rows — ` +
          `the answer below is INCOMPLETE: ${
            typeof error === "object" && error && "message" in error
              ? String((error as { message: unknown }).message)
              : String(error)
          }`,
      );
      break;
    }
    const rows = data ?? [];
    out.push(...rows);
    // A short page means the end. Anything else and we would loop for ever on
    // a table that keeps answering.
    if (rows.length < size) break;
  }
  return out;
}

/**
 * Ask about a long list of ids without building a URL nobody will accept.
 *
 *   const orders = await inChunks(ids, (batch) =>
 *     svc.from("orders").select("student_id, amount_inr").in("student_id", batch));
 *
 * Two hundred at a time keeps the query string well inside every limit while
 * still being a handful of round trips rather than hundreds.
 */
export async function inChunks<T>(
  ids: string[],
  query: (batch: string[]) => PromiseLike<Page<T>>,
  size = 200,
): Promise<T[]> {
  const out: T[] = [];
  const unique = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < unique.length; i += size) {
    const { data } = await query(unique.slice(i, i + size));
    out.push(...(data ?? []));
  }
  return out;
}
