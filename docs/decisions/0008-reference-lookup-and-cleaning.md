# 0008: Reference lookup, cleaning and citation keys

## Context

The rest of roadmap step 6: add references by DOI or URL, clean messy
`.bib` files (typically Zotero or publisher exports), and give new entries
keys in the `author_topic_year` form. Documents must stay standard LaTeX +
BibTeX (§14), and nothing may send document content off the device (§9).

## Decision

- **DOI lookup through doi.org content negotiation**
  (`Accept: application/vnd.citationstyles.csl+json`). One endpoint serves
  every registration agency (Crossref, DataCite, mEDRA …), and it supports
  CORS, so no server is needed. Accepted input:
  - a DOI;
  - a `doi.org` link, or any URL containing a DOI;
  - an arXiv ID or arXiv URL, mapped to its DataCite DOI
    `10.48550/arXiv.<id>`.

  Only that identifier is sent, on an explicit "Add" by the user.
- **CSP relaxation:** `connect-src` gains `https://doi.org` and the hosts it
  redirects content negotiation to: `api.crossref.org`, `data.crossref.org`,
  `api.datacite.org`, `data.datacite.org`, `data.crosscite.org` and
  `data.medra.org`. Nothing else is allowed.
- **Other URLs are not scraped.** Browsers can't read arbitrary pages across
  origins without a proxy server, which we don't have. A plain URL becomes
  a `@misc` entry with `url` and an "Accessed <date>" note, and the app says
  to add the author and title.
- **CSL-JSON → BibTeX** (`src/references/csl.ts`):
  - Fields go where the entry type expects them: `journal` for articles,
    `booktitle` for chapters and papers, `institution` for reports and
    `school` for theses.
  - Months are written as macros (`month = oct`).
  - LaTeX specials are escaped.
  - Crossref's title markup becomes `\emph`, `\textsubscript` and similar.
  - In titles only, words with an inner capital (EROI, H.T., iPhone) are
    brace-protected, because only titles get lower-cased by BibTeX styles.
  - A `url` that just repeats the DOI is dropped.
- **Keys** (`src/references/keys.ts`) follow Zotero/Better BibTeX's legacy
  `[auth:lower]_[veryshorttitle:lower]_[year]`:
  - the first author's last name without particles (`waals`), folded to
    ASCII from LaTeX accents or Unicode;
  - the first title word that is not a stop word;
  - the year.

  Collisions anywhere in the library get `a`, `b`, … suffixes.
- **Cleaning is conservative** (`src/references/clean.ts`):
  - It rewrites only the entries BibTeX reads, using source spans from the
    parser, and keeps all other text byte for byte.
  - Macros and `#` concatenations stay as written.
  - Keys are never renamed, so existing `\cite`s keep working.
  - Fixes: canonical layout, quoted values braced, empty fields dropped, the
    URL prefix removed from `doi`, a `url` that duplicates the DOI removed,
    `-`/`–` ranges in `pages`/`number` changed to `--`, month names and
    numbers changed to macros.

  Every fix is reported.

## Consequences

- The CSL fixture (`fixtures/references/brown-2004.csl.json`) was built from
  the CSL schema and Crossref's documented output, not recorded: the
  development sandbox could not reach doi.org. The converter accepts both
  string and array forms of `title`, `container-title` and `ISBN` to be
  robust. Recording real responses is a follow-up (see
  `fixtures/references/README.md`).
- E2E tests intercept doi.org with `page.route`, so CI never depends on the
  network. That also proves the CSP lets the request through in both builds.
- Offline, DOI lookup fails with a clear message; everything else works.
- Zotero (step 7) can reuse the same converter: Zotero's APIs also speak
  CSL-JSON.
