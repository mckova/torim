# TORIM design notes

## Product read

TORIM is used by two people with very different days. The owner of a barbershop
or a clinic looks at it between customers, often standing, for a few seconds at a
time: what is next, who has not confirmed, what changed since this morning. The
customer opens it once, from a WhatsApp link, to pick a time and leave.

So the interface is a working tool, not a showcase. Dense rows over cards, real
names and times over illustrations, and one question answered per screen.

## The idea: an appointment book

Small businesses in Israel still keep a paper appointment book next to the
register. TORIM borrows its grammar instead of a generic dashboard:

| Decision | Why |
|---|---|
| Paper background (`#f3f3ef`) and an off-white sheet (`#fcfcfa`) | The day reads as one page, not as a grid of floating boxes. |
| Ink (`#16181d`) for everything a person wrote | Most of the screen is plain text, so it has to be calm. |
| **Cobalt (`#2340c8`) only for what the assistant wrote** | This is the one accent, and it carries meaning: a booking the assistant made, a note it left, a message it drafted. The owner can always see what the assistant did versus what people did. |
| Red pen (`#b8321f`) for cancellations and no-shows, struck through | It is what people already do on paper. A cancelled row stays visible, crossed out, so the owner knows the time was freed. |
| Amber, dashed, for "waiting for your approval" | Pending items are drawn unfinished on purpose. |
| Hairline rules and a 2px ink rule under each page heading | Structure comes from the page, not from shadows or borders around every block. |
| IBM Plex Sans Hebrew for text, IBM Plex Mono for clock times only | Times line up in a column like a timetable. Large numbers (the date, the clock, totals) use the sans at a light weight with tabular figures, never a monospace display face. |
| Small radii (4/6/10px), no glow, no glass, no gradients | The product should look like it was made for a counter, not a launch video. |

Staff colors are muted (`#2f6f62`, `#9a6a16`, `#7a3e5c`, ...) and only appear as a
thin edge on calendar entries and a small dot next to a name. In the week view
each staff member gets a fixed lane inside the day column, so one person's day
reads top to bottom.

## Dials

- **Energy: low.** The owner opens the app dozens of times a day. Nothing
  competes for attention except what needs a decision.
- **Rhythm: dense, even rows.** Ledger rows of 56 to 64px, tabular numbers,
  `min-width: 0` on every flexible column so long Hebrew names truncate instead
  of pushing actions off screen. Button labels are never truncated.
- **Motion: functional.** One easing curve (`cubic-bezier(0.23, 1, 0.32, 1)`),
  150 to 300ms, entrances through `@starting-style`, press feedback by scale.
  On the public page, assistant entries are revealed right to left like a pen
  writing Hebrew, and a cancellation is struck through. Everything respects
  `prefers-reduced-motion`; with reduced motion the public page shows the
  finished day and lists every moment instead of animating it.

## The public page

The page for business owners is the product running one sample day, clearly
labelled as a demo with invented names. Scrolling advances the clock from
08:40 to 19:40, and the book, the WhatsApp thread and the assistant's note are
all derived from the same list of moments. It ends with a real input: describe
the business in a sentence, and the setup endpoint writes services, prices and
hours that carry straight into signup. There are no invented statistics or
testimonials, and a short ruled list says what the assistant does *not* do
without asking.

## Light only

TORIM ships a light theme only. It is used at a counter or a reception desk in
daylight, and the appointment-book metaphor (paper, ink, red pen) depends on a
light page. A dark theme would need its own metaphor rather than inverted
colors, so it is left out rather than done halfway.

## Accessibility

- Contrast on the paper background: ink 16:1, muted text (`#666a72`) 4.9:1,
  cobalt 7.1:1, red pen 5.4:1, amber 5.3:1.
- Focus is a 2px cobalt outline on every interactive element.
- Dialogs trap focus, set initial focus and restore it on close.
- Status changes (assistant writing, booking saved) are announced through
  `aria-live` regions.
- Voice dictation uses the browser's Hebrew speech recognition where available
  and hides the microphone button where it is not.
