# Regret log

One line each time something that worked breaks. Format:

`- YYYY-MM-DD HH:MM: what broke, why`

- 2026-11-25 10:45: distract/lure towers permanently pinned guests (Wine Tasting froze the lead guest ~200 s; a 0-damage lure could soft-lock a wave), because every shot re-armed the stall and once balance numbers made fireRate x effectDuration >= 1 the stall never lapsed; fixed with a post-stall immunity window
