# Bibliography styles

Unmodified copies of BibTeX styles from TeX Live, interpreted by the BibTeX
emulator (`src/latex/bibtex/`). `scripts/make-bibtex-reference.sh` copies
them and records real bibtex's output for each, which the unit tests compare
against byte for byte. Do not edit these files: change the emulator instead.

| Style                                              | Source                                                      | Licence                                                                                       |
| -------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `plainnat.bst`, `unsrtnat.bst`, `abbrvnat.bst`     | natbib bundle, © 1993–2007 Patrick W. Daly                  | LaTeX Project Public License (LPPL)                                                           |
| `plain.bst`, `unsrt.bst`, `abbrv.bst`, `alpha.bst` | BibTeX 0.99b, © 1984–2010 Howard Trickey and Oren Patashnik | Unlimited copying and redistribution permitted as long as unmodified (see each file's header) |

Each file's own header is its licence notice and is kept intact.
