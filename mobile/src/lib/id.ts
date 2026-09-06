/**
 * A random v4-shaped id for a new item. Unlike the extension's
 * `crypto.randomUUID()` (extension/src/background/vault.ts), Hermes/React
 * Native has no built-in Web Crypto -- rather than add a dependency for it,
 * this uses `Math.random()`. That's fine here: an item id isn't secret (it's
 * bound into the AEAD as associated data, never as key material), it only
 * needs to be unique, and 122 random bits make a collision practically
 * impossible even from a weak source.
 */
function randomItemId(): string {
  const hex = () => Math.floor(Math.random() * 16).toString(16);
  const block = (length: number) => Array.from({ length }, hex).join('');
  return `${block(8)}-${block(4)}-4${block(3)}-${((8 + Math.floor(Math.random() * 4)).toString(16))}${block(3)}-${block(12)}`;
}

export { randomItemId };
