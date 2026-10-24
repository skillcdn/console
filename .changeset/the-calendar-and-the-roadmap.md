---
"@skillcdn/console": patch
---

The calendar's month, who has what, and the roadmap's months.

- A day's number on the month is a button: pressed, the day's tasks, those on it and those lying across it, are listed under the month with their badges (the words `calendar.onDay`, `calendar.nothingOnDay`, `calendar.close`), and pressed again or closed, the list goes. A day with more than four tasks of its own shows three and the way to the rest (`.sc-calendar-more`, the words `calendar.more` and `calendar.fewer`), so that a busy week is as tall as the others until a day is opened.
- Who has what, under the month, is a table on a sheet of its own, titled "담당자별 작업 현황" in Korean: a quiet band for the headings, a hairline between people, the numbers in columns of their own on the right in the display size, the one due this week and the one late with a dot of their colour, and the row under the pointer lit a little. It sits on the left under what is late, and what has no day yet runs down the right, so that the page under the month fills evenly.
- A bar of a task that is over is paler in its own colour instead of see-through, so that every piece of it is one shade whatever lies under it, and the card of the task under the pointer is solid on the raised white.
- A goal's label on the roadmap's months keeps to one line beside its bar, so that every row is as tall as its bar and the labels line up with the bars: a long title is cut short and said in full on hover (`title`), and the goal's state stays beside it or, on a narrow screen, is left to its card below the months.
