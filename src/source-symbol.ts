/** A searchable source name: "Gateway.relay()" -> "relay"; CSS selectors stay intact. */
export function landingSearchName(raw: string): string {
  const name = raw.trim().replace(/\(.*\)\s*$/, '').trim();
  if (/^[.#]/.test(name)) return name;
  return name.split(/::|\./).filter(Boolean).at(-1) ?? name;
}

/** Preserve an authored owner: Other.parse() and Expected.parse() are distinct. */
export function sourceSymbolKey(raw: string): string {
  const name = raw.trim().replace(/\(.*\)\s*$/, '').trim();
  return /^[.#]/.test(name) ? name : name.split(/::|\./).map(part => part.trim()).filter(Boolean).join('.');
}
