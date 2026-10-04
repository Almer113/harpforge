// Small line icons for the editor bar's switches (16px, drawn in the text colour).

const svg = (children: React.ReactNode) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);

/** Visual: an eye (the music shown, rather than its text). */
export const VisualIcon = svg(
  <>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </>,
);

/** Text: lines of a document. */
export const TextIcon = svg(
  <>
    <path d="M4 6h16" />
    <path d="M4 10.5h16" />
    <path d="M4 15h11" />
    <path d="M4 19.5h14" />
  </>,
);

/** Split: a page divided down the middle (text and preview). */
export const SplitIcon = svg(
  <>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M12 4v16" />
    <path d="M6 9h3M6 13h3" />
  </>,
);

/** Holes: a harmonica, a bar with a row of holes. */
export const HolesIcon = svg(
  <>
    <rect x="2" y="7" width="20" height="10" rx="2.5" />
    <path d="M6 12h.01M10 12h.01M14 12h.01M18 12h.01" strokeWidth="3" />
  </>,
);

/** Notes: a music note. */
export const NotesIcon = svg(
  <>
    <circle cx="8" cy="17.5" r="2.5" fill="currentColor" />
    <path d="M10.5 17.5V4.5l7 2.5" />
  </>,
);

/** Overwrite: the middle card filled in, as the one a new note replaces. */
export const OverwriteIcon = svg(
  <>
    <rect x="3" y="6" width="5" height="12" rx="1.5" />
    <rect x="10" y="6" width="5" height="12" rx="1.5" fill="currentColor" />
    <rect x="17" y="6" width="4" height="12" rx="1.5" />
  </>,
);

/** Insert: a text cursor between two cards, where a new note squeezes in. */
export const InsertIcon = svg(
  <>
    <rect x="2" y="6" width="5" height="12" rx="1.5" />
    <path d="M12 4v16M10 4h4M10 20h4" />
    <rect x="17" y="6" width="5" height="12" rx="1.5" />
  </>,
);
