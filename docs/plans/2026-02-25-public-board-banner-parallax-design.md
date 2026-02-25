# Design: Public Board Banner — Reduced Height + Parallax Scroll

**Date:** 2026-02-25
**Task:** Reduce banner height, add subtle parallax, increase bottom scroll buffer

## Problem

The public feedback board banner is too tall (`h-48 md:h-64` = 192/256px), leaving less room for the feedback list on first load. When few feedback items are present, the page has little scrollable range, so the parallax effect adds no depth. There is also no bottom padding buffer.

## Solution

**Approach A + C:** Shrink the banner and add a subtle parallax scroll effect.

### Changes

**Banner height:** `h-48 md:h-64` → `h-24 md:h-36` (96/144px)

**Parallax inner layer:**
- New inner `div` wraps the gradient/image, extending `-30px` beyond container top and bottom
- On scroll, `translateY(scrollY * 0.25)` capped at `30px` so the inner layer drifts at 25% of scroll speed
- `overflow-hidden` on the container clips the overflow
- `will-change: transform` for GPU compositing

**Scroll listener:**
- `handleScroll` method stored on the instance, added with `{ passive: true }` in `mounted`, removed in `beforeUnmount`

**Bottom scroll buffer:** Content container `py-8` → `pt-8 pb-32` (adds 128px below last item)

## Files Changed

- `components/public/PublicFeedbackBoard.vue`
- `TODO.md` (mark task done)
