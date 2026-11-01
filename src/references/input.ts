/** What the user typed into "Add reference": a DOI, an arXiv ID, or a URL. */

export type ReferenceInput =
  | { kind: 'doi'; doi: string }
  | { kind: 'url'; url: string }
  | { kind: 'invalid' };

/** DOI syntax (Crossref's recommended pattern, slightly relaxed). */
const DOI = /\b(10\.\d{4,9}\/\S+)/;
/** New-style (2101.00001) and old-style (hep-th/9901001) arXiv IDs. */
const ARXIV =
  /(?:arxiv:\s*|arxiv\.org\/(?:abs|pdf)\/)([a-z-]+(?:\.[a-z]{2})?\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?/i;

const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

export function parseReferenceInput(input: string): ReferenceInput {
  const s = input.trim();
  const arxiv = ARXIV.exec(s);
  if (arxiv) return { kind: 'doi', doi: `10.48550/arXiv.${arxiv[1]}` };
  const doi = DOI.exec(safeDecode(s));
  if (doi) {
    // Trailing sentence punctuation, and an unmatched closing bracket.
    let value = doi[1].replace(/[.,;:'"]+$/, '');
    const unbalanced = (open: string, close: string) =>
      value.endsWith(close) &&
      value.split(open).length < value.split(close).length;
    while (unbalanced('(', ')') || unbalanced('[', ']'))
      value = value.slice(0, -1);
    return { kind: 'doi', doi: value };
  }
  try {
    const url = new URL(s);
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname)
      return { kind: 'url', url: s };
  } catch {
    // not a URL
  }
  return { kind: 'invalid' };
}
