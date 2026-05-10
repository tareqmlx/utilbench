import { describe, expect, it } from "vitest";
import {
  toCamelCase,
  toKebabCase,
  toLowerCase,
  toSentenceCase,
  toSnakeCase,
  toTitleCase,
  toUpperCase,
  tokenize,
} from "../conversions";

describe("tokenize", () => {
  it("splits on spaces", () => {
    expect(tokenize("hello world")).toEqual(["hello", "world"]);
  });

  it("splits on underscores", () => {
    expect(tokenize("hello_world")).toEqual(["hello", "world"]);
  });

  it("splits on hyphens", () => {
    expect(tokenize("hello-world")).toEqual(["hello", "world"]);
  });

  it("splits on dots", () => {
    expect(tokenize("hello.world")).toEqual(["hello", "world"]);
  });

  it("splits on camelCase transitions", () => {
    expect(tokenize("helloWorld")).toEqual(["hello", "World"]);
  });

  it("splits on letter-to-number transitions", () => {
    expect(tokenize("test123")).toEqual(["test", "123"]);
  });

  it("splits on number-to-letter transitions", () => {
    expect(tokenize("123test")).toEqual(["123", "test"]);
  });

  it("handles mixed delimiters", () => {
    expect(tokenize("hello_world-foo.bar")).toEqual(["hello", "world", "foo", "bar"]);
  });

  it("handles acronyms followed by words", () => {
    expect(tokenize("HTMLParser")).toEqual(["HTML", "Parser"]);
  });

  it("returns empty array for empty string", () => {
    expect(tokenize("")).toEqual([]);
  });

  it("handles single word", () => {
    expect(tokenize("hello")).toEqual(["hello"]);
  });

  it("splits camelCase with numbers", () => {
    expect(tokenize("myVar2Name")).toEqual(["my", "Var", "2", "Name"]);
  });
});

describe("toUpperCase", () => {
  it("converts to uppercase", () => {
    expect(toUpperCase("hello world")).toBe("HELLO WORLD");
  });

  it("handles empty string", () => {
    expect(toUpperCase("")).toBe("");
  });
});

describe("toLowerCase", () => {
  it("converts to lowercase", () => {
    expect(toLowerCase("HELLO WORLD")).toBe("hello world");
  });

  it("handles empty string", () => {
    expect(toLowerCase("")).toBe("");
  });
});

describe("toTitleCase", () => {
  it("capitalizes first letter of each word", () => {
    expect(toTitleCase("hello world foo")).toBe("Hello World Foo");
  });

  it("preserves whitespace structure", () => {
    expect(toTitleCase("hello  world")).toBe("Hello  World");
  });

  it("preserves line breaks", () => {
    expect(toTitleCase("hello\nworld")).toBe("Hello\nWorld");
  });

  it("handles single word", () => {
    expect(toTitleCase("hello")).toBe("Hello");
  });

  it("handles empty string", () => {
    expect(toTitleCase("")).toBe("");
  });
});

describe("toSentenceCase", () => {
  it("capitalizes first letter of each sentence", () => {
    expect(toSentenceCase("hello world. foo bar")).toBe("Hello world. Foo bar");
  });

  it("handles exclamation marks", () => {
    expect(toSentenceCase("wow! great")).toBe("Wow! Great");
  });

  it("handles question marks", () => {
    expect(toSentenceCase("really? yes")).toBe("Really? Yes");
  });

  it("capitalizes after line breaks", () => {
    expect(toSentenceCase("hello\nworld")).toBe("Hello\nWorld");
  });

  it("handles empty string", () => {
    expect(toSentenceCase("")).toBe("");
  });

  it("handles multiple sentences", () => {
    expect(toSentenceCase("first sentence. second one. third here")).toBe(
      "First sentence. Second one. Third here",
    );
  });
});

describe("toCamelCase", () => {
  it("converts space-separated words", () => {
    expect(toCamelCase("hello world")).toBe("helloWorld");
  });

  it("converts snake_case", () => {
    expect(toCamelCase("hello_world")).toBe("helloWorld");
  });

  it("converts kebab-case", () => {
    expect(toCamelCase("hello-world")).toBe("helloWorld");
  });

  it("re-tokenizes existing camelCase", () => {
    expect(toCamelCase("helloWorld")).toBe("helloWorld");
  });

  it("handles single word", () => {
    expect(toCamelCase("hello")).toBe("hello");
  });

  it("handles empty string", () => {
    expect(toCamelCase("")).toBe("");
  });
});

describe("toSnakeCase", () => {
  it("converts space-separated words", () => {
    expect(toSnakeCase("hello world")).toBe("hello_world");
  });

  it("converts camelCase", () => {
    expect(toSnakeCase("helloWorld")).toBe("hello_world");
  });

  it("converts kebab-case", () => {
    expect(toSnakeCase("hello-world")).toBe("hello_world");
  });

  it("re-tokenizes existing snake_case", () => {
    expect(toSnakeCase("hello_world")).toBe("hello_world");
  });

  it("handles empty string", () => {
    expect(toSnakeCase("")).toBe("");
  });
});

describe("toKebabCase", () => {
  it("converts space-separated words", () => {
    expect(toKebabCase("hello world")).toBe("hello-world");
  });

  it("converts camelCase", () => {
    expect(toKebabCase("helloWorld")).toBe("hello-world");
  });

  it("converts snake_case", () => {
    expect(toKebabCase("hello_world")).toBe("hello-world");
  });

  it("re-tokenizes existing kebab-case", () => {
    expect(toKebabCase("hello-world")).toBe("hello-world");
  });

  it("handles empty string", () => {
    expect(toKebabCase("")).toBe("");
  });
});
