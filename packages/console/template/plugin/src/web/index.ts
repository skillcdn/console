// The web bundle: the page and the widget, in a frame the console serves. It speaks to the console
// through the bridge alone, and renders every word a person wrote as text, never as HTML.
import { connect, type PluginFrame, type PluginRecord } from "@skillcdn/console/plugin/web";

interface Greeting {
  readonly to: string;
  readonly text: string;
  readonly by: string;
}

const PREFIX = "pl-__key__-";

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = `${PREFIX}${className}`;
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

async function latestGreetings(
  frame: PluginFrame,
  limit: number,
): Promise<readonly PluginRecord<Greeting>[]> {
  return (await frame.query("latest", { limit })) as readonly PluginRecord<Greeting>[];
}

function greetingItem(record: PluginRecord<Greeting>): HTMLLIElement {
  const item = element("li", "greeting");
  item.append(
    element("span", "text", record.data.text),
    element("span", "by", `by ${record.data.by}`),
  );
  return item;
}

async function renderPage(root: HTMLElement, frame: PluginFrame): Promise<void> {
  const page = element("div", "page");
  const form = element("form", "form");
  const input = document.createElement("input");
  input.className = "sc-input";
  input.placeholder = "Who to greet";
  input.maxLength = 80;
  input.required = true;
  const button = document.createElement("button");
  button.className = "sc-button";
  button.type = "submit";
  button.textContent = "Greet";
  form.append(input, button);
  const list = element("ul", "list");
  const status = element("p", "empty");
  page.append(form, list, status);
  root.replaceChildren(page);

  const refresh = async () => {
    const records = await latestGreetings(frame, 20);
    list.replaceChildren(...records.map(greetingItem));
    status.textContent = records.length === 0 ? "Nobody has been greeted yet." : "";
    status.className = `${PREFIX}empty`;
  };
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    button.disabled = true;
    frame
      .command("greet", { to: input.value.trim() })
      .then(() => {
        input.value = "";
        return refresh();
      })
      .catch((error: unknown) => {
        status.textContent = error instanceof Error ? error.message : "The greeting was refused.";
        status.className = `${PREFIX}error`;
      })
      .finally(() => {
        button.disabled = false;
      });
  });
  frame.onEvent(["records", "command"], () => {
    void refresh();
  });
  frame.setTitle("Greetings");
  await refresh();
}

async function renderWidget(root: HTMLElement, frame: PluginFrame): Promise<void> {
  const widget = element("div", "widget");
  root.replaceChildren(widget);
  const refresh = async () => {
    const [record] = await latestGreetings(frame, 1);
    widget.replaceChildren(
      record === undefined
        ? element("p", "empty", "Nobody has been greeted yet.")
        : element("p", "text", record.data.text),
    );
  };
  frame.onEvent(["records"], () => {
    void refresh();
  });
  await refresh();
}

const root = document.getElementById("root");
if (root !== null) {
  const frame = await connect();
  if (frame.context.widget !== undefined) {
    await renderWidget(root, frame);
  } else {
    await renderPage(root, frame);
  }
}
