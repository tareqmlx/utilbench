export type CaseType =
  | "upper"
  | "lower"
  | "title"
  | "sentence"
  | "camel"
  | "pascal"
  | "snake"
  | "kebab"
  | "constant";

/**
 * Splits text into word tokens by detecting boundaries at:
 * - Whitespace, underscores, hyphens, dots
 * - camelCase transitions (lowercase -> uppercase)
 * - Letter-to-number and number-to-letter transitions
 * Strips punctuation from tokens.
 */
export function tokenize(text: string): string[] {
  // Split on whitespace, underscores, hyphens, dots first
  const rawParts = text.split(/[\s_\-.]+/);
  const tokens: string[] = [];

  for (const part of rawParts) {
    if (!part) continue;
    // Further split on camelCase and letter/number boundaries
    const subTokens = part.match(/[A-Z]?[a-z]+|[A-Z]+(?=[A-Z][a-z]|\d|\b)|[A-Z]|[0-9]+/g);
    if (subTokens) {
      tokens.push(...subTokens);
    }
  }

  return tokens;
}

export function toUpperCase(text: string): string {
  return text.toUpperCase();
}

export function toLowerCase(text: string): string {
  return text.toLowerCase();
}

export function toTitleCase(text: string): string {
  return text.replace(/\S+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

export function toSentenceCase(text: string): string {
  const lower = text.toLowerCase();
  let result = "";
  let capitalizeNext = true;

  for (let i = 0; i < lower.length; i++) {
    const char = lower.charAt(i);
    if (capitalizeNext && /[a-z]/.test(char)) {
      result += char.toUpperCase();
      capitalizeNext = false;
    } else {
      result += char;
      if (/[.!?]/.test(char)) {
        capitalizeNext = true;
      }
      if (char === "\n") {
        capitalizeNext = true;
      }
    }
  }

  return result;
}

export function toCamelCase(text: string): string {
  const tokens = tokenize(text);
  return tokens
    .map((token, i) =>
      i === 0 ? token.toLowerCase() : token.charAt(0).toUpperCase() + token.slice(1).toLowerCase(),
    )
    .join("");
}

export function toSnakeCase(text: string): string {
  return tokenize(text)
    .map((t) => t.toLowerCase())
    .join("_");
}

export function toKebabCase(text: string): string {
  return tokenize(text)
    .map((t) => t.toLowerCase())
    .join("-");
}

export function toPascalCase(text: string): string {
  return tokenize(text)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
    .join("");
}

export function toConstantCase(text: string): string {
  return tokenize(text)
    .map((t) => t.toUpperCase())
    .join("_");
}

const converters: Record<CaseType, (text: string) => string> = {
  upper: toUpperCase,
  lower: toLowerCase,
  title: toTitleCase,
  sentence: toSentenceCase,
  camel: toCamelCase,
  pascal: toPascalCase,
  snake: toSnakeCase,
  kebab: toKebabCase,
  constant: toConstantCase,
};

export function convert(text: string, caseType: CaseType): string {
  return converters[caseType](text);
}
