/**
 * Starter document shown on first load (until persistence lands in M8).
 * Same text as fixtures/article-basic/input.tex, so what you see on first
 * load is what the print-fidelity test checks against pdflatex. The date is
 * fixed (not \\today) so visual snapshots are stable.
 */
export const SAMPLE_DOCUMENT = `\\documentclass[11pt,a4paper]{article}

\\title{A Short Example}
\\author{Ada Lovelace}
\\date{31 October 2026}

\\begin{document}
\\maketitle

\\section{Introduction}
This document is written in the LaTeX Emulator. The editor is on the left
and the preview is on the right. Paragraphs are separated by a blank line,
exactly as in \\LaTeX, and the first paragraph after a heading is not
indented.

Later paragraphs are indented by \\verb|\\parindent|. Text can be
\\emph{emphasised}, \\textbf{bold}, \\textit{italic}, \\texttt{monospaced} or
\\textsc{small caps}. Quotes use \`\`double'' and \`single' marks, ranges use
an en-dash as in 1--10, and a pause uses an em-dash---like this.

\\subsection{Lists}
Lists come in three kinds:
\\begin{itemize}
  \\item an itemised list,
  \\item an enumerated list, and
  \\item a description list.
\\end{itemize}
Enumerated lists are numbered:
\\begin{enumerate}
  \\item First.
  \\item Second.
\\end{enumerate}

\\section{Conclusion}
That is all for now.

\\end{document}
`;
