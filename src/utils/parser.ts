/** Standalone unit tokens that may appear separately after a number */
const UNIT_ONLY_RE = /^(?:г(?:р(?:амм?)?)?|шт(?:ук)?|мл|g|ml)$/i;

/** Number with an optional attached unit: "200г", "150гр", "1шт", "300" */
const QUANTITY_RE = /^(\d+(?:[.,]\d+)?)(?:г(?:р(?:амм?)?)?|шт(?:ук)?|мл|g|ml)?$/i;

export interface ParsedFoodItem {
  name: string;
  grams: number;
}

/**
 * Parses free-text food input into (name, grams) pairs.
 *
 * Examples:
 *   "курица 200г рис 100"         → [{курица, 200}, {рис, 100}]
 *   "куриная грудка 180гр, гречка 150г" → [{куриная грудка, 180}, {гречка, 150}]
 *   "яблоко 1шт"                  → [{яблоко, 1}]
 */
export function parseFoodText(text: string): ParsedFoodItem[] {
  const tokens = text
    .trim()
    .split(/[\s,;]+/)
    .filter(Boolean);

  const items: ParsedFoodItem[] = [];
  let nameTokens: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const qMatch = token.match(QUANTITY_RE);

    if (qMatch && nameTokens.length > 0) {
      const grams = Number.parseFloat(qMatch[1].replace(',', '.'));
      // Peek: skip a following standalone unit token (e.g. "200 г" → skip "г")
      if (i + 1 < tokens.length && UNIT_ONLY_RE.test(tokens[i + 1])) {
        i++;
      }
      const name = nameTokens.join(' ').trim();
      if (grams > 0 && name) {
        items.push({ name, grams });
      }
      nameTokens = [];
    } else if (UNIT_ONLY_RE.test(token)) {
      // Standalone unit that already belongs to a consumed number — skip
    } else {
      nameTokens.push(token.toLowerCase());
    }
  }

  return items;
}

/** Formats parsed items as a markdown bullet list */
export function formatParsedItems(items: ParsedFoodItem[]): string {
  return items.map((item) => `• ${item.name} — ${item.grams}г`).join('\n');
}
