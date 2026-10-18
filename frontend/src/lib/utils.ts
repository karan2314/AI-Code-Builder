// ponytail: plain join, no tailwind-merge. Conflicting utilities aren't deduped; add tailwind-merge if that bites.
export const cn = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");
