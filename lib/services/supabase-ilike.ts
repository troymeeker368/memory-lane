export function escapeSupabaseLikeTerm(value: string) {
  return value.replace(/[%,_]/g, (match) => `\\${match}`);
}

export function buildSupabaseIlikePattern(value: string) {
  return `%${escapeSupabaseLikeTerm(value)}%`;
}
