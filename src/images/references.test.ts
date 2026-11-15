import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { graphicReferences } from './references.ts';

describe('graphicReferences', () => {
  test('every \\includegraphics name and the \\graphicspath, in order', () => {
    const src = String.raw`\documentclass{article}
\usepackage{graphicx}
\graphicspath{{figs/}{./more/}}
\begin{document}
\includegraphics[width=3cm]{plot}
\begin{figure}[h]
  \centering\includegraphics{sub/energy.png}
  \caption{A figure with \includegraphics{inner}}
\end{figure}
\includegraphics{plot}
% \includegraphics{commented}
\end{document}`;
    assert.deepEqual(graphicReferences(src), {
      names: ['plot', 'sub/energy.png', 'inner'],
      graphicsPath: ['figs/', './more/'],
    });
  });

  test('none in a document without images', () => {
    assert.deepEqual(graphicReferences('Hello.'), {
      names: [],
      graphicsPath: [],
    });
  });
});
