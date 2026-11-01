---
name: __key__
description: "Greets someone through the __name__ plugin and reads the latest greetings. Use when a person asks to greet someone on the board, or asks who was greeted lately: console plugin __key__ greet <who>, and console plugin __key__ latest."
license: MIT
metadata:
  author: __key__
---
# Greeting through __name__

The plugin keeps greetings as records of the console. An agent greets as the person whose token it holds; the greeting carries that person's login.

## Commands

| Do | Command |
|---|---|
| Greet someone | `console plugin __key__ greet <who> [--text <words>]`: the words are the greeting setting's word and the name unless said |
| Read the latest greetings | `console plugin __key__ latest [--limit <n>]`, ten unless said, newest first; `--json` for the records |
| Read the records | `console plugin __key__ records greetings` |

## Rules

- Greet when asked, once; a greeting repeated is noise on the board.
- Say what was done in the run's report, with the id the command printed.
