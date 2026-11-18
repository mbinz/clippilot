// Minimal FCPXML reader for tests: tiny XML tree + exact rational time values.

export interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export function parseXml(xml: string): XmlNode {
  const root: XmlNode = { tag: '#root', attrs: {}, children: [] };
  const stack: XmlNode[] = [root];
  const tagRe = /<(\/?)([A-Za-z][\w-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g;
  for (const m of xml.matchAll(tagRe)) {
    const [, closing, tag, attrText, selfClose] = m;
    if (closing) {
      stack.pop();
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of attrText.matchAll(/([\w:-]+)="([^"]*)"/g)) attrs[a[1]] = decodeEntities(a[2]);
    const node: XmlNode = { tag, attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!selfClose) stack.push(node);
  }
  return root.children[0];
}

export function findAll(node: XmlNode, tag: string): XmlNode[] {
  const out: XmlNode[] = [];
  for (const c of node.children) {
    if (c.tag === tag) out.push(c);
    out.push(...findAll(c, tag));
  }
  return out;
}

export function child(node: XmlNode, tag: string): XmlNode | undefined {
  return node.children.find(c => c.tag === tag);
}

// ---------------------------------------------------------------------------
// Exact rational seconds (BigInt) — never compare raw time strings.
// ---------------------------------------------------------------------------

export class Rat {
  readonly n: bigint;
  readonly d: bigint;
  constructor(n: bigint, d: bigint = 1n) {
    if (d === 0n) throw new Error('zero denominator');
    if (d < 0n) { n = -n; d = -d; }
    const g = gcd(n < 0n ? -n : n, d) || 1n;
    this.n = n / g;
    this.d = d / g;
  }
  static parse(attr: string): Rat {
    const m = attr.match(/^(-?\d+)(?:\/(\d+))?s$/);
    if (!m) throw new Error(`not an FCPXML time value: ${attr}`);
    return new Rat(BigInt(m[1]), BigInt(m[2] ?? '1'));
  }
  add(o: Rat): Rat { return new Rat(this.n * o.d + o.n * this.d, this.d * o.d); }
  sub(o: Rat): Rat { return new Rat(this.n * o.d - o.n * this.d, this.d * o.d); }
  mul(o: Rat): Rat { return new Rat(this.n * o.n, this.d * o.d); }
  div(o: Rat): Rat { return new Rat(this.n * o.d, this.d * o.n); }
  eq(o: Rat): boolean { return this.n === o.n && this.d === o.d; }
  toNumber(): number { return Number(this.n) / Number(this.d); }
  toString(): string { return `${this.n}/${this.d}`; }
}

function gcd(a: bigint, b: bigint): bigint {
  while (b) [a, b] = [b, a % b];
  return a;
}

export const rat = (attr: string): Rat => Rat.parse(attr);
