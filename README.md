# Make It Count

A Chrome extension that tracks time spent on Substack and nudges you toward active engagement.

## The Problem

Reading online is deceptively passive. You open an article, scroll through it, maybe nod along, and close the tab. Twenty minutes gone. You might remember the headline tomorrow, but the argument? The details? Unlikely.

This isn't a failure of willpower. It's a design problem. Reading platforms are optimized for consumption, not comprehension. There's no friction between finishing one article and starting the next. The result is a kind of intellectual grazing — you cover a lot of ground without digesting anything.

## The Theory

Retention and understanding come from engagement, not exposure. Decades of research on learning back this up:

- **The generation effect**: producing your own words about material strengthens memory far more than re-reading it.
- **Elaborative interrogation**: asking "why?" and "how?" while reading forces deeper processing.
- **The testing effect**: retrieving information (even informally, like writing a comment) consolidates it better than passive review.

The common thread is that *doing something* with what you read — reacting, questioning, restating, disagreeing — transforms reading from input into understanding.

## What It Does

Make It Count runs quietly while you read Substack. After a configurable amount of time (default: 15 minutes), it asks a simple question: *"Make it count?"*

You get three options:

- **Take notes** — opens a sidebar where you can jot down thoughts while you read. When you're done, you can push those notes into a Substack comment or send them to Obsidian.
- **Share** — copies the article URL to your clipboard.
- **Dismiss** — closes the prompt for this session.

The timer tracks cumulative active reading time across your entire Substack session — not per article. It only counts time when you're actively engaged (tab focused, scrolling or moving the mouse). It resets when you leave Substack or close the browser.

## Features

- Works on custom-domain Substacks (not just `*.substack.com`)
- Configurable threshold from 30 seconds to 30 minutes
- Session-scoped timer that persists across article navigation
- Notes sidebar for capturing thoughts while reading
- Obsidian integration via `obsidian://` URI scheme
- Non-blocking — never interrupts your reading

## Install

1. Clone this repo
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the project folder

## File Structure

```
make-it-count/
├── manifest.json       # Manifest V3 configuration
├── background.js       # Service worker — session timer, Substack detection
├── content.js          # Injected into Substack pages — activity tracking, toast, notes sidebar
├── popup.html          # Extension popup UI
├── popup.js            # Popup logic — timer display, settings
├── styles.css          # Toast and notes sidebar styling
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## Configuration

Open the extension popup to:

- See your current session time
- Adjust the trigger threshold (presets: 30s, 5m, 15m, 30m)
- Enable/disable the extension
- Open the notes sidebar manually
- Reset the session timer
