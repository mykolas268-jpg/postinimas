# verslas.ai style guide (for the writer and the Lithuanian copy editor)

Instructions are in English; all article text is written natively in
Lithuanian. Never translate English sentences one by one — write from the
facts.

## Reader and voice

- Readers: Lithuanian SMB owners, marketers and freelancers. They are not
  technical. They want to know what changed, whether it matters to them, what
  to do, how much it costs, whether it works in Lithuania and in Lithuanian, and
  what the risks are.
- Address the reader with "tu" (informal singular), as the existing articles
  do. Use "mes" for verslas.ai.
- Direct, practical, calm. No hype, no clickbait, no emojis in headings, no
  exclamation marks in headings.
- Short paragraphs (2–4 sentences). Concrete nouns and verbs. Every section
  must be useful on its own (AI assistants quote passages out of context).

## Structure the existing articles use (keep it)

Concrete business scenario → what we will do → method (steps, tables,
templates, prompts) → `Callout` tips/warnings → result + internal link.

Scenarios must read clearly as examples: "Pavyzdžiui, įsivaizduokime
kavinę…", "Tarkime, …". Never present an invented person, business, number or
outcome as real. Results in scenarios are conditional ("galėtų", "užtektų").

## Facts, examples, opinions

- Every factual statement comes from the fact sheet. If it is not there, do
  not write it.
- Numbers, prices, versions, dates and availability are copied exactly from
  the fact sheet. Prices keep their original currency ("20 USD per mėnesį");
  EUR only with the stated rate and date.
- Opinions and recommendations are marked as such ("Mūsų nuomone, …",
  "Rekomenduojame …").
- No first-person experience unless the owner provided it.

## Lithuanian language checklist (based on VLKK guidance)

Grammar and syntax:
- Case agreement after prepositions and numerals ("per 4 darbo dienas", not
  "per 4 darbo dienos"; "20 eurų").
- Natural Lithuanian word order; avoid English-style noun chains
  ("DI turinio kūrimo įrankių palyginimas" → split or rephrase).
- Prefer active voice; avoid "yra atliekamas", "buvo padaryta" where a verb in
  the active voice works.
- Commas: before "kad", "jog", "kuris/kuri/kurie", "nes", "bet", "o", "tačiau"
  (when they join clauses), around participial and adverbial participle
  phrases when they are separated, and after introductory words
  ("Pavyzdžiui, …", "Taigi, …" when parenthetical).

Frequent errors to avoid (VLKK "Kalbos klaidų sąrašas", formerly "Didžiųjų
kalbos klaidų sąrašas") — see config/banned-phrases.yml for replacements:
"pilnai", "dėka", "tame tarpe", "įtakoti", "pravesti (renginį)", "sekantis
(kitas)", "eilė (daug)", "kas liečia", "nežiūrint į", "apart", "pagal
galimybę".

Anglicisms and calques: "adresuoti problemą", "fokusuotis", "implementuoti",
"kontentas", "freelanceris", "deadline'as", "feedback'as", "targetuoti". Use
the glossary terms instead.

## Typography

- Quotation marks: „…“ only. Brand and product names that are not inflected
  go in quotes on first mention when the existing articles do so („Instagram“).
- Headings: sentence case (only the first word and proper nouns capitalised).
- Dash between clauses: " — " (spaced em dash), as in the existing articles.
  Ranges: "20–30" (en dash, no spaces).
- Decimal comma: "2,5 val.", "0,50 €". Thousands: "1 200 €" (space).
- Currency after the number: "20 €", "20 USD".
- Dates: "2026 m. rugsėjo 24 d."; month alone: "2026 m. rugsėjį".
- Absolute dates only. Never "vakar", "šiandien", "šią savaitę", "neseniai".
- Percent: "80 %" (space before %).

## Terminology

- First mention: "dirbtinis intelektas (DI)", then "DI" in running text.
- Keep "AI" inside product names and where the search keyword uses it
  ("AI video", "AI Act" only when quoting the English name).
- EU AI Act: "ES dirbtinio intelekto aktas (DI aktas)".
- GDPR: "Bendrasis duomenų apsaugos reglamentas (BDAR)".
- See config/glossary.yml.

## Article skeleton (MDX body; the H1 is the frontmatter title)

1. Answer-first intro: the first 2–3 sentences answer the main question.
2. `<Callout type="info" title="Trumpai">` with 3–5 bullet points.
3. H2s phrased as the questions readers ask; each starts with a direct 1–2
   sentence answer, then details.
4. Practical steps and Lithuanian business use cases.
5. "Kam tai aktualu, o kam ne".
6. "Ką daryti dabar" — what to do now / what to wait for / what to ignore.
7. Availability and price table where relevant.
8. Limitations and risks.
9. Optional contextual CTA line (only if the topic's CTA hint says so).

FAQ (3–5 real questions) and sources go into frontmatter, not the body — the
site renders them. Legal/regulatory topics add
`<Callout type="warning" title="Ne teisinė konsultacija">`.
