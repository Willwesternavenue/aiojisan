# AI Oji-san Blog System — Design Brief

## Design Goal
Design a modern editorial-style AI/media site and private admin dashboard for a Japanese content creator.

The product has two faces:
1. A **public-facing blog/media site**
2. A **private editorial dashboard/news app**

The public site should feel intelligent, clean, trustworthy, and editorial.
The admin dashboard should feel practical, dense, efficient, and easy to operate.

---

## Desired Brand Impression
- intelligent
- editorial
- modern
- clean
- credible
- calm
- slightly warm
- not corporate-soulless
- not overdesigned
- not startup-gimmicky

---

## Impressions to Avoid
- cheap AI content farm
- crypto-bro aesthetic
- overly glossy SaaS landing page
- information product / guru vibe
- noisy dashboard clutter
- aggressive neon cyberpunk
- generic AI-generated design feel

---

## Public Site Direction
The public site should feel like a hybrid of:
- an editorial technology publication
- a personal analysis blog
- a lightweight modern magazine

It should support:
- article discovery
- thoughtful reading
- strong readability
- a sense of point of view

---

## Dashboard Direction
The admin dashboard is a private working tool.
Prioritize:
- speed
- clarity
- information density
- quick actions
- filtering
- usability

It should feel closer to a calm editorial workspace than a flashy SaaS dashboard.

---

## Visual Style
### Public Site
- minimal but not sterile
- editorial typography
- clear hierarchy
- lots of whitespace
- strong article list rhythm
- tasteful category labels
- subtle card styling
- light borders
- restrained use of accent color

### Dashboard
- practical layout
- clean table/list patterns
- badges for scores/status
- strong quick-action buttons
- clear filtering controls
- modular reusable components

---

## Typography Direction
Use typography carefully.
The site should feel readable and serious.

Suggested direction:
- clean sans-serif for UI and body
- optionally a more characterful serif or editorial-style heading font
- article pages should prioritize comfortable reading width and line-height
- Japanese text readability is critical

Avoid novelty fonts.

---

## Color Direction
Use a restrained palette.

Suggested structure:
- 1 background color
- 1 text color
- 1 muted text color
- 1 border color
- 1 accent color
- optional soft highlight color for editorial tags or cards

Overall tone:
- calm
- intelligent
- modern
- slightly warm, if possible

Avoid strong gradients, heavy glows, and overused futuristic blue-purple AI color schemes.

---

## Layout Guidance
### Public Site
Must support:
- homepage hero
- featured articles
- latest article list
- category/tag sections
- article detail page

Article list should be easy to scan.
Article detail should be highly readable.

### Dashboard
Must support:
- sidebar navigation
- main content area
- filters
- lists or tables
- detail pane or detail page
- action buttons
- status badges

---

## Component Suggestions
### Public Site
- article cards
- tag pills
- category labels
- simple hero block
- author/about block
- featured article section
- related articles section

### Dashboard
- source cards
- source edit form
- article rows/cards
- score badges
- action buttons
- tabs for summaries / extracted text / AI output
- run logs
- sync status indicators

---

## Design References
Use inspiration from English-language editorial / tech sites.

Strong references:
- Simon Willison
- Benedict Evans
- Every
- Anthropic Engineering
- OpenAI Developer Blog
- Vercel Blog

Do not copy directly.
Instead, capture:
- editorial calm
- typography discipline
- clean hierarchy
- modern but restrained UI

---

## UX Priorities
### Public Site
1. Readability
2. Trust
3. Clarity
4. Editorial tone
5. Lightweight performance

### Dashboard
1. Speed of use
2. Fast scanning
3. Clear actions
4. Low friction workflow
5. Good visibility into AI outputs and source quality

---

## Motion
Keep motion minimal.
Use subtle hover states and small transitions only.
No heavy animation.

---

## Responsiveness
- Public site must work elegantly on mobile
- Dashboard can be desktop-first but should still be usable on tablet
- Mobile admin support is nice but not the main priority for MVP

---

## Design System Guidance
Please establish a lightweight design system with:
- spacing scale
- border radius scale
- type scale
- color tokens
- button variants
- badge variants
- card styles
- form styles
- table/list styles

Keep it simple and extensible.

---

## Output Expectations
Please provide:
1. A design direction summary
2. Suggested UI architecture
3. Reusable component list
4. Styling tokens
5. Initial implementation approach for Astro
6. A clean first-pass dashboard UI
7. A clean first-pass public blog UI
