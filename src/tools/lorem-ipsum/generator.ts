export interface GenerateOptions {
  mode: "paragraphs" | "words" | "bytes";
  amount: number;
  startWithLorem: boolean;
  htmlTags: boolean;
}

const LOREM_OPENING = "Lorem ipsum dolor sit amet, consectetur adipiscing elit.";

const SENTENCES = [
  "Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
  "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.",
  "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.",
  "Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.",
  "Curabitur pretium tincidunt lacus nulla gravida orci a odio.",
  "Nullam varius turpis et commodo pharetra est eros bibendum elit.",
  "Nec luctus magna felis sollicitudin mauris integer in mauris eu nibh euismod gravida.",
  "Duis ac tellus et risus vulputate vehicula donec lobortis risus a elit.",
  "Etiam tempor ut ullamcorper ligula eu tempor congue eros est euismod turpis.",
  "Id tincidunt sapien risus a quam maecenas fermentum consequat mi.",
  "Donec fermentum pellentesque venenatis cras sodales consequat nunc.",
  "Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae.",
  "Praesent eget semper magna in bibendum dolor sollicitudin lectus.",
  "Fusce vel dui sed est accumsan porta at vel tortor.",
  "Morbi tempus iaculis urna id volutpat lacus laoreet non curabitur gravida.",
  "Arcu ac tortor dignissim convallis aenean et tortor at risus viverra.",
  "Adipiscing at in tellus integer feugiat scelerisque varius morbi enim nunc.",
  "Faucibus pulvinar elementum integer enim neque volutpat ac tincidunt vitae.",
  "Semper auctor neque vitae tempus quam pellentesque nec nam aliquam sem.",
  "Et tortor at risus viverra adipiscing at in tellus integer feugiat.",
  "Scelerisque varius morbi enim nunc faucibus a pellentesque sit amet porttitor.",
  "Lectus magna fringilla urna porttitor rhoncus dolor purus non enim praesent.",
  "Elementum tempus egestas sed sed risus pretium quam vulputate dignissim.",
  "Suspendisse ultrices gravida dictum fusce ut placerat orci nulla pellentesque.",
  "Dignissim enim sit amet venenatis urna cursus eget nunc scelerisque viverra.",
  "Mauris augue neque gravida in fermentum et sollicitudin ac orci phasellus.",
  "Egestas integer eget aliquet nibh praesent tristique magna sit amet purus.",
  "Gravida cum sociis natoque penatibus et magnis dis parturient montes nascetur.",
  "Ridiculus mus mauris vitae ultricies leo integer malesuada nunc vel risus.",
  "Commodo viverra maecenas accumsan lacus vel facilisis volutpat est velit.",
  "Egestas dui id ornare arcu odio ut sem nulla pharetra diam.",
  "Sit amet nisl suscipit adipiscing bibendum est ultricies integer quis.",
  "Auctor elit sed vulputate mi sit amet mauris commodo quis imperdiet.",
  "Massa tincidunt nunc pulvinar sapien et ligula ullamcorper malesuada proin.",
  "Libero nunc consequat interdum varius sit amet mattis vulputate enim nulla.",
  "Aliquet porttitor lacus luctus accumsan tortor posuere ac ut consequat.",
  "Semper quis lectus nulla at volutpat diam ut venenatis tellus in metus.",
  "Vulputate dignissim suspendisse in est ante in nibh mauris cursus mattis.",
  "Molestie at elementum eu facilisis sed odio morbi quis commodo odio.",
  "Aenean sed adipiscing diam donec adipiscing tristique risus nec feugiat in.",
  "Fermentum posuere urna nec tincidunt praesent semper feugiat nibh sed.",
  "Pulvinar proin gravida hendrerit lectus a molestie aliquam id diam maecenas.",
  "Ultricies mi quis hendrerit dolor magna eget est lorem ipsum dolor.",
  "Sit amet consectetur adipiscing elit pellentesque habitant morbi tristique senectus.",
  "Et netus et malesuada fames ac turpis egestas sed tempus urna.",
  "Condimentum lacinia quis vel eros donec ac odio tempor orci dapibus.",
  "Ultrices in iaculis nunc sed augue lacus viverra vitae congue eu.",
  "Consequat ac felis donec et odio pellentesque diam volutpat commodo sed.",
  "Egestas congue quisque egestas diam in arcu cursus euismod quis viverra.",
  "Nibh cras pulvinar mattis nunc sed blandit libero volutpat sed cras.",
];

// prettier-ignore
const WORDS: readonly string[] = [
  "lorem",
  "ipsum",
  "dolor",
  "sit",
  "amet",
  "consectetur",
  "adipiscing",
  "elit",
  "sed",
  "do",
  "eiusmod",
  "tempor",
  "incididunt",
  "ut",
  "labore",
  "et",
  "dolore",
  "magna",
  "aliqua",
  "enim",
  "ad",
  "minim",
  "veniam",
  "quis",
  "nostrud",
  "exercitation",
  "ullamco",
  "laboris",
  "nisi",
  "aliquip",
  "ex",
  "ea",
  "commodo",
  "consequat",
  "duis",
  "aute",
  "irure",
  "reprehenderit",
  "voluptate",
  "velit",
  "esse",
  "cillum",
  "fugiat",
  "nulla",
  "pariatur",
  "excepteur",
  "sint",
  "occaecat",
  "cupidatat",
  "non",
  "proident",
  "sunt",
  "culpa",
  "officia",
  "deserunt",
  "mollit",
  "anim",
  "id",
  "est",
  "laborum",
  "curabitur",
  "pretium",
  "tincidunt",
  "lacus",
  "gravida",
  "orci",
  "odio",
  "nullam",
  "varius",
  "turpis",
  "pharetra",
  "eros",
  "bibendum",
  "luctus",
  "felis",
  "sollicitudin",
  "mauris",
  "integer",
  "nibh",
  "euismod",
  "tellus",
  "risus",
  "vulputate",
  "vehicula",
  "donec",
  "lobortis",
  "etiam",
  "ullamcorper",
  "ligula",
  "congue",
  "sapien",
  "quam",
  "maecenas",
  "fermentum",
  "pellentesque",
  "venenatis",
  "cras",
  "sodales",
  "nunc",
  "vestibulum",
  "ante",
  "primis",
  "faucibus",
  "ultrices",
  "posuere",
  "cubilia",
  "curae",
  "praesent",
  "eget",
  "semper",
  "fusce",
  "vel",
  "dui",
  "accumsan",
  "porta",
  "tortor",
  "morbi",
  "tempus",
  "iaculis",
  "urna",
  "volutpat",
  "laoreet",
  "arcu",
  "dignissim",
  "convallis",
  "aenean",
  "viverra",
  "neque",
  "vitae",
  "scelerisque",
  "elementum",
  "auctor",
  "nam",
  "aliquam",
  "sem",
  "feugiat",
  "porttitor",
  "rhoncus",
  "purus",
  "lectus",
  "fringilla",
  "egestas",
  "pretium",
  "suspendisse",
  "dictum",
  "placerat",
  "ornare",
  "nisl",
  "suscipit",
  "imperdiet",
  "massa",
  "pulvinar",
  "libero",
  "interdum",
  "mattis",
  "aliquet",
  "metus",
  "molestie",
  "facilisis",
  "tristique",
  "habitant",
  "senectus",
  "netus",
  "malesuada",
  "fames",
  "condimentum",
  "lacinia",
  "dapibus",
  "augue",
  "quisque",
  "cursus",
  "blandit",
];

type RngFn = () => number;

function createRng(seed?: number): RngFn {
  if (seed === undefined) {
    return Math.random;
  }
  // Simple mulberry32 PRNG for determinism
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickRandom<T>(arr: readonly T[], rng: RngFn): T {
  return arr[Math.floor(rng() * arr.length)] as T;
}

function randomInt(min: number, max: number, rng: RngFn): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function capitalize(s: string): string {
  if (s.length === 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function generateParagraph(rng: RngFn, startWithLorem: boolean): string {
  const sentenceCount = randomInt(4, 8, rng);
  const sentences: string[] = [];

  if (startWithLorem) {
    sentences.push(LOREM_OPENING);
  }

  const remaining = startWithLorem ? sentenceCount - 1 : sentenceCount;
  for (let i = 0; i < remaining; i++) {
    sentences.push(pickRandom(SENTENCES, rng));
  }

  return sentences.join(" ");
}

function generateParagraphs(
  amount: number,
  startWithLorem: boolean,
  htmlTags: boolean,
  rng: RngFn,
): string {
  const paragraphs: string[] = [];
  for (let i = 0; i < amount; i++) {
    const useLoremStart = startWithLorem && i === 0;
    const text = generateParagraph(rng, useLoremStart);
    paragraphs.push(htmlTags ? `<p>${text}</p>` : text);
  }
  return paragraphs.join(htmlTags ? "\n" : "\n\n");
}

function generateWords(
  amount: number,
  startWithLorem: boolean,
  htmlTags: boolean,
  rng: RngFn,
): string {
  const result: string[] = [];

  if (startWithLorem) {
    const loremWords = LOREM_OPENING.replace(".", "").toLowerCase().split(" ");
    const take = Math.min(loremWords.length, amount);
    for (let i = 0; i < take; i++) {
      result.push(loremWords[i] as string);
    }
  }

  while (result.length < amount) {
    result.push(pickRandom(WORDS, rng));
  }

  // Capitalize the first word
  if (result.length > 0) {
    result[0] = capitalize(result[0] as string);
  }

  const text = result.join(" ");
  return htmlTags ? `<p>${text}</p>` : text;
}

function generateBytes(
  amount: number,
  startWithLorem: boolean,
  htmlTags: boolean,
  rng: RngFn,
): string {
  // Generate enough raw text, then truncate/pad to exact byte count
  const encoder = new TextEncoder();

  // Build a large pool of text
  let pool = "";
  if (startWithLorem) {
    pool = `${LOREM_OPENING} `;
  }

  // Keep adding sentences until we have enough bytes
  while (encoder.encode(pool).length < amount + 200) {
    pool += `${pickRandom(SENTENCES, rng)} `;
  }

  // Trim to exact byte count
  let text = pool;
  while (encoder.encode(text).length > amount) {
    text = text.slice(0, -1);
  }

  // Trim trailing whitespace for cleanliness
  text = text.trimEnd();

  if (htmlTags) {
    // Ensure the <p> tags fit within the byte limit
    const tagOverhead = "<p></p>".length;
    if (amount <= tagOverhead) {
      return "<p></p>".slice(0, amount);
    }
    // Regenerate content to fit inside tags
    const contentBudget = amount - tagOverhead;
    let content = pool;
    while (encoder.encode(content).length > contentBudget) {
      content = content.slice(0, -1);
    }
    content = content.trimEnd();
    text = `<p>${content}</p>`;
  }

  return text;
}

export function generateLoremIpsum(options: GenerateOptions, seed?: number): string {
  const { mode, amount, startWithLorem, htmlTags } = options;

  if (amount <= 0) {
    return "";
  }

  const rng = createRng(seed);

  switch (mode) {
    case "paragraphs":
      return generateParagraphs(amount, startWithLorem, htmlTags, rng);
    case "words":
      return generateWords(amount, startWithLorem, htmlTags, rng);
    case "bytes":
      return generateBytes(amount, startWithLorem, htmlTags, rng);
  }
}
