// The marks of the brand come from the main repository's package, never from a copy here
// (ADR-0013); the build gives back their addresses. The pages are dark, so the wordmark is white.
import symbol from "@skillcdn/brand/symbol.svg";
import wordmark from "@skillcdn/brand/wordmark-white.svg";
import { createConsole } from "@skillcdn/console";
// The styles ship with the package; the build bundles them next to the script.
import "@skillcdn/console/console.css";

// The default UI the image serves: the package's composition, with the default configuration
// (docs/architecture.md, "The package and custom consoles"). A custom console is this file,
// with a configuration of its own, in a repository of its own.

const container = document.getElementById("root");
if (container === null) {
  throw new Error("the page has no #root element");
}
createConsole({ brand: { symbol, wordmark } }).mount(container);
