// Search-input sanitiser for PostgREST .or(...ilike...) filters.
//
// PostgREST parses the .or() argument as a logic tree, so a raw comma or
// parenthesis in user input doesn't just miss — it makes the whole request
// 400 with `failed to parse logic tree`, and the user sees a raw error
// (hit live: typing a question with "?," into the header search). Wildcards
// % and _ are stripped too: an operator searching "Chan" never means SQL
// wildcards, and a stray % turns a name search into match-everything.
export function sanitizeSearch(raw: string): string {
  return raw
    .replace(/[,()%_\\"']/g, " ") // logic-tree breakers + wildcards + quotes
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64);
}
