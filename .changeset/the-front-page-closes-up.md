---
"@skillcdn/console": patch
---

The front page of someone who has arranged nothing is composed edge to edge (ADR-0082): the first widget leads, half the page wide, the next two widgets and the projects stand beside it as high as it, the projects in rows each as wide as their column, and the rest below; on 6 columns or fewer, one under the other. A composed tile may reach fractions of a cell, so that every edge meets another. A widget's frame is told the size of its own nearest the box it has, which may be another of its declared `sizes` than its `defaultSize`. Arranging starts from the composed page on the nearest cells, and a width nobody arranged, when another was, is closed up from the sizes the tiles come in. A width the person arranged stands as they left it; `HomeGrid`'s props, the classes and the tokens are those of before, and nothing stored changes shape.
