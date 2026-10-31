% Probe style: writes raw results of BibTeX builtins for every entry, so the
% emulator's builtins can be checked one by one against real bibtex.
ENTRY { author editor title } {} {}
STRINGS { s }
INTEGERS { n i }
FUNCTION {probe.names}
{ 's :=
  s num.names$ 'n :=
  #1 'i :=
  { i n #1 + < }
  { "NAME " i int.to.str$ * write$ newline$
    "  full=" s i "{ff~}{vv~}{ll}{, jj}" format.name$ * write$ newline$
    "  short=" s i "{vv~}{ll}" format.name$ * write$ newline$
    "  init=" s i "{f.~}{vv~}{ll}{, jj}" format.name$ * write$ newline$
    "  sort=" s i "{vv{ } }{ll{ }}{  f{ }}{  jj{ }}" format.name$ * write$ newline$
    "  last.first=" s i "{vv~}{ll}{, jj}{, f}" format.name$ * write$ newline$
    i #1 + 'i :=
  }
  while$
}
FUNCTION {probe}
{ "ENTRY " cite$ * " " * type$ * write$ newline$
  author empty$ 'skip$ { "author num.names=" author num.names$ int.to.str$ * write$ newline$ author probe.names } if$
  editor empty$ 'skip$ { "editor:" write$ newline$ editor probe.names } if$
  title empty$ 'skip$
  { "  title.t=" title "t" change.case$ * write$ newline$
    "  title.l=" title "l" change.case$ * write$ newline$
    "  title.u=" title "u" change.case$ * write$ newline$
    "  title.purify=" title purify$ * write$ newline$
    "  title.prefix3=" title #3 text.prefix$ * write$ newline$
    "  title.length=" title text.length$ int.to.str$ * write$ newline$
    "  title.sub2_5=" title #2 #5 substring$ * write$ newline$
    "  title.sub-1_3=" title #-1 #3 substring$ * write$ newline$
    "  title.period=" title add.period$ * write$ newline$
  } if$
}
READ
ITERATE {probe}
