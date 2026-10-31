# TORIM design notes

## Product read

TORIM is used by two people with very different days. The owner of a barbershop
or a clinic looks at it between customers, often standing, for a few seconds at
a time: who is in which chair, what is next, what needs a decision. The customer
opens it once, from a WhatsApp link, to pick a time and leave.

So the interface is a working tool: real names and times over illustrations,
and one question answered per screen.

## The idea: one day, one column per person

The provider app's home screen is the day calendar that salons and clinics
already know from paper and from the best booking tools: time runs down the
page, each staff member has a column, and a booking is a block in that person's
colour. Next to it sits the assistant, which says what needs the owner, and a
card for who is in the chair right now.

| Decision | Why |
|---|---|
| Sunset gradient (rose `#ff4d8d` to tangerine `#ff8a4c`) | One warm accent, used on the primary action, the assistant and the "AI booked" mark. It is how the owner tells what the assistant did from what people did. |
| Plum ink (`#2a1530`) instead of black | Keeps text calm and warm against the gradient. Primary buttons are plum pills. |
| Per-staff tints mixed from each person's colour into white | Every column stays in the same warm family while people remain easy to tell apart. |
| Glass panels over a soft blurred background | Depth without borders around every block. Panels stay opaque enough for text to hold contrast. |
| Pills for navigation, chips and buttons | One shape language; the top bar is a single floating pill. |
| DM Sans, 400 to 600 | One family, tabular figures for times and money. Hebrew names fall back to IBM Plex Sans Hebrew. |
| Free gaps drawn as dashed slots with a button | An open hour is something to act on: offer it to the waitlist, or book it. |

## Dials

- **Energy: medium.** The gradient is rare and always means something.
- **Rhythm: the hour grid.** 68px per hour on the day view, so a 45-minute
  booking still fits a name and a service.
- **Motion: functional.** One easing curve (`cubic-bezier(0.23, 1, 0.32, 1)`),
  150 to 300ms, entrances through `@starting-style`, press feedback by scale.
  Everything respects `prefers-reduced-motion`; with reduced motion the public
  page shows the finished day and lists every moment instead of animating it.

## The public page

The page for business owners is the product running one sample day, clearly
labelled as a demo with invented names. Scrolling advances the clock from
08:40 to 19:40, and the day list, the WhatsApp thread and the assistant's note
are all derived from the same list of moments. It ends with a real input:
describe the business in a sentence, and the setup endpoint writes services,
prices and hours that carry straight into signup. There are no invented
statistics or testimonials, and a short list says what the assistant does *not*
do without asking.

## Light only

TORIM ships a light theme only. It is used at a counter or a reception desk in
daylight, and the warm translucent surfaces depend on a light page. A dark
theme would need its own palette rather than inverted colours, so it is left
out rather than done halfway.

## Accessibility

- Text on the canvas: ink 15:1, secondary text 8:1, muted text (`#7d6577`)
  4.6:1. Text on the gradient is white at 600 weight or plum on white cards.
- Focus is a visible outline on every interactive element.
- Dialogs trap focus, set initial focus and restore it on close.
- Status changes (assistant writing, booking saved) are announced through
  `aria-live` regions.
- Voice dictation uses the browser's speech recognition where available and
  hides the microphone button where it is not.
