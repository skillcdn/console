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
createConsole().mount(container);
