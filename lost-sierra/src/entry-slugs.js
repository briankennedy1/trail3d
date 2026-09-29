export const publicSlug=entry=>entry.slug||entry.id;
export function entryForSlug(entries,slug,aliases={}){
  return entries.find(entry=>publicSlug(entry)===slug)
    ||entries.find(entry=>entry.id===slug)
    ||(Object.hasOwn(aliases,slug)?entries.find(entry=>entry.id===aliases[slug]):undefined);
}
